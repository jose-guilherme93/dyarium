package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
)

type createUploadRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	SHA256      string `json:"sha256"`
	Title       string `json:"title"`
	RecordedAt  string `json:"recorded_at"`
	ClientKey   string `json:"client_key"`
}

func (s *Server) handleCreateUpload(w http.ResponseWriter, r *http.Request) {
	var req createUploadRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	var recordedAt *time.Time
	if req.RecordedAt != "" {
		if t, err := time.Parse(time.RFC3339, req.RecordedAt); err == nil {
			recordedAt = &t
		}
	}
	up, err := s.deps.Ingest.Start(r.Context(), ingest.Meta{
		Filename:    req.Filename,
		ContentType: req.ContentType,
		SizeBytes:   req.SizeBytes,
		SHA256:      req.SHA256,
		Title:       req.Title,
		RecordedAt:  recordedAt,
		ClientKey:   req.ClientKey,
	})
	if err != nil {
		s.writeIngestError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         up.ID,
		"offset":     up.ReceivedBytes,
		"expires_at": up.ExpiresAt,
	})
}

func (s *Server) handleGetUpload(w http.ResponseWriter, r *http.Request) {
	up, err := s.deps.Ingest.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeIngestError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":         up.ID,
		"status":     up.Status,
		"offset":     up.ReceivedBytes,
		"size_bytes": up.SizeBytes,
		"expires_at": up.ExpiresAt,
	})
}

func (s *Server) handlePutUpload(w http.ResponseWriter, r *http.Request) {
	offset, err := parseOffset(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_offset", err.Error())
		return
	}
	id := r.PathValue("id")
	up, gerr := s.deps.Ingest.Get(r.Context(), id)
	if gerr != nil {
		s.writeIngestError(w, gerr)
		return
	}
	newOffset, aerr := s.deps.Ingest.Append(r.Context(), id, offset, r.Body)
	if aerr != nil {
		var apiErr *ingest.Error
		if errors.As(aerr, &apiErr) && apiErr.Status == http.StatusConflict {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":  map[string]string{"code": apiErr.Code, "message": apiErr.Message},
				"offset": up.ReceivedBytes,
			})
			return
		}
		s.writeIngestError(w, aerr)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":             id,
		"offset":         newOffset,
		"received_bytes": newOffset,
	})
}

func (s *Server) handleCompleteUpload(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	res, err := s.deps.Ingest.Complete(ctx, r.PathValue("id"))
	if err != nil {
		s.writeIngestError(w, err)
		return
	}
	entry := res.Entry
	if res.Duplicate {
		// Conteudo ja existia: nenhuma entrada nova foi criada. O app vincula o
		// item local a entrada existente e nao ha transcricao nova a enfileirar.
		writeJSON(w, http.StatusCreated, map[string]any{
			"entry_id":  entry.ID,
			"status":    entry.Status,
			"duplicate": true,
		})
		return
	}
	if _, err := s.deps.Queue.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:"+entry.ID, jobs.TranscribePayload{EntryID: entry.ID}); err != nil {
		s.deps.Logger.Error("filtrar: enfileirar transcricao", "erro", err)
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, entry.ID, store.EntryQueued)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": entry.ID, "status": store.EntryQueued})
	writeJSON(w, http.StatusCreated, map[string]any{
		"entry_id": entry.ID,
		"status":   store.EntryQueued,
	})
}

func (s *Server) writeIngestError(w http.ResponseWriter, err error) {
	var apiErr *ingest.Error
	if errors.As(err, &apiErr) {
		writeError(w, apiErr.Status, apiErr.Code, apiErr.Message)
		return
	}
	writeError(w, http.StatusInternalServerError, "internal", "erro interno")
}

func parseOffset(r *http.Request) (int64, error) {
	if v := r.Header.Get("X-Upload-Offset"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("X-Upload-Offset invalido")
		}
		return n, nil
	}
	if v := r.Header.Get("Content-Range"); v != "" {
		// Format: bytes start-end/total
		v = strings.TrimPrefix(v, "bytes ")
		parts := strings.SplitN(v, "-", 2)
		n, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("Content-Range invalido")
		}
		return n, nil
	}
	return -1, fmt.Errorf("informe X-Upload-Offset ou Content-Range")
}
