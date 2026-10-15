package api

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/store"
)

// maxImageBytes bounds an uploaded image attachment.
const maxImageBytes = 25 << 20 // 25 MiB

func attachmentJSON(a store.Attachment) map[string]any {
	return map[string]any{
		"id":           a.ID,
		"entry_id":     a.EntryID,
		"kind":         a.Kind,
		"content_type": a.ContentType,
		"size_bytes":   a.SizeBytes,
		"created_at":   a.CreatedAt,
	}
}

func (s *Server) serveAttachment(w http.ResponseWriter, r *http.Request, att store.Attachment) {
	contentType := att.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Accept-Ranges", "bytes")

	size := att.SizeBytes
	if size <= 0 {
		w.WriteHeader(http.StatusOK)
		if _, err := s.deps.Ingest.DecryptAttachment(r.Context(), att, w); err != nil && s.deps.Logger != nil {
			s.deps.Logger.Error("api: transmitir anexo", "erro", err)
		}
		return
	}

	start, end, partial := parseRange(r.Header.Get("Range"), size)
	if partial {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		w.WriteHeader(http.StatusOK)
	}

	var dst io.Writer = w
	if partial {
		dst = &windowWriter{dst: w, start: start, end: end}
	}
	if _, err := s.deps.Ingest.DecryptAttachment(r.Context(), att, dst); err != nil && s.deps.Logger != nil {
		s.deps.Logger.Error("api: transmitir anexo", "erro", err)
	}
}

// windowWriter discards decrypted bytes outside [start, end], so a byte range
// can be served even though the ciphertext must be decrypted from the start.
type windowWriter struct {
	dst   io.Writer
	start int64
	end   int64
	pos   int64
}

func (w *windowWriter) Write(p []byte) (int, error) {
	n := int64(len(p))
	from := w.pos
	to := w.pos + n - 1
	w.pos += n
	if from > w.end {
		return len(p), nil
	}
	lo := from
	if lo < w.start {
		lo = w.start
	}
	hi := to
	if hi > w.end {
		hi = w.end
	}
	if lo > hi {
		return len(p), nil
	}
	if _, err := w.dst.Write(p[lo-from : hi-from+1]); err != nil {
		return len(p), err
	}
	return len(p), nil
}

// parseRange parses a single-range "bytes=start-end" header. It returns the
// inclusive window and whether the request is partial.
func parseRange(header string, size int64) (int64, int64, bool) {
	header = strings.TrimSpace(header)
	if header == "" || size <= 0 || !strings.HasPrefix(header, "bytes=") {
		return 0, size - 1, false
	}
	spec := strings.TrimPrefix(header, "bytes=")
	if i := strings.IndexByte(spec, ','); i >= 0 {
		spec = spec[:i]
	}
	parts := strings.SplitN(spec, "-", 2)
	if len(parts) != 2 {
		return 0, size - 1, false
	}
	startStr := strings.TrimSpace(parts[0])
	endStr := strings.TrimSpace(parts[1])
	if startStr == "" {
		n, err := strconv.ParseInt(endStr, 10, 64)
		if err != nil || n <= 0 {
			return 0, size - 1, false
		}
		if n > size {
			n = size
		}
		return size - n, size - 1, true
	}
	start, err := strconv.ParseInt(startStr, 10, 64)
	if err != nil || start < 0 || start >= size {
		return 0, size - 1, false
	}
	end := size - 1
	if endStr != "" {
		if parsed, err := strconv.ParseInt(endStr, 10, 64); err == nil {
			end = parsed
		}
	}
	if end >= size {
		end = size - 1
	}
	if end < start {
		return 0, size - 1, false
	}
	return start, end, true
}

// handleGetEntryAudio streams the decrypted audio of an entry (its first audio)
// so the dashboard can play it. Prefer GET /attachments/{id} for a specific
// audio. Plaintext never touches disk.
func (s *Server) handleGetEntryAudio(w http.ResponseWriter, r *http.Request) {
	att, err := s.deps.Store.GetAttachmentByKind(r.Context(), r.PathValue("id"), store.AttachmentOriginal)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "audio indisponivel")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.serveAttachment(w, r, att)
}

// handleListAttachments returns the non-audio attachments (images) of an entry.
func (s *Server) handleListAttachments(w http.ResponseWriter, r *http.Request) {
	attachments, err := s.deps.Store.ListAttachments(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(attachments))
	for _, a := range attachments {
		if a.Kind == store.AttachmentOriginal || a.Kind == store.AttachmentDerived16k {
			continue
		}
		out = append(out, attachmentJSON(a))
	}
	writeJSON(w, http.StatusOK, map[string]any{"attachments": out})
}

// handleCreateAttachment stores an image attached to an entry.
func (s *Server) handleCreateAttachment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	entryID := r.PathValue("id")
	if _, err := s.deps.Store.GetEntry(ctx, entryID); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	contentType := strings.TrimSpace(r.Header.Get("Content-Type"))
	if !strings.HasPrefix(contentType, "image/") {
		writeError(w, http.StatusBadRequest, "invalid_type", "envie uma imagem (Content-Type image/*)")
		return
	}
	att, err := s.deps.Ingest.PutAttachment(ctx, entryID, "image", contentType, r.Body, maxImageBytes)
	if err != nil {
		var ingestErr *ingest.Error
		if errors.As(err, &ingestErr) {
			writeError(w, ingestErr.Status, ingestErr.Code, ingestErr.Message)
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, attachmentJSON(att))
}

// handleGetAttachment streams a stored attachment (used for images).
func (s *Server) handleGetAttachment(w http.ResponseWriter, r *http.Request) {
	att, err := s.deps.Store.GetAttachment(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "anexo inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.serveAttachment(w, r, att)
}

// handleDeleteAttachment removes an attachment row and its ciphertext file.
func (s *Server) handleDeleteAttachment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	att, err := s.deps.Store.GetAttachment(ctx, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "anexo inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := s.deps.Store.DeleteAttachment(ctx, att.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := s.deps.Ingest.DeleteAttachmentObject(att); err != nil && s.deps.Logger != nil {
		s.deps.Logger.Error("api: remover objeto de anexo", "erro", err)
	}
	w.WriteHeader(http.StatusNoContent)
}
