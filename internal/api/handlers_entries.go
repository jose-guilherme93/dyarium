package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
)

// entryTagNames returns the tag names attached to an entry.
func (s *Server) entryTagNames(ctx context.Context, entryID string) ([]string, error) {
	tags, err := s.deps.Store.ListEntryTags(ctx, entryID)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(tags))
	for _, tag := range tags {
		names = append(names, tag.Name)
	}
	return names, nil
}

func entryJSON(e store.Entry) map[string]any {
	return map[string]any{
		"id":                e.ID,
		"title":             e.Title,
		"status":            e.Status,
		"source":            e.Source,
		"original_filename": e.OriginalFilename,
		"content_type":      e.ContentType,
		"size_bytes":        e.SizeBytes,
		"duration_seconds":  e.DurationSeconds,
		"sha256":            e.SHA256,
		"recorded_at":       e.RecordedAt,
		"created_at":        e.CreatedAt,
		"updated_at":        e.UpdatedAt,
	}
}

func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	entries, err := s.deps.Store.ListEntriesFiltered(r.Context(), 100,
		query.Get("person"), query.Get("place"), query.Get("theme"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		item := entryJSON(e)
		if names, err := s.entryTagNames(r.Context(), e.ID); err == nil {
			item["tags"] = names
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

// handleCreateEntry creates a written note (no audio). The body is stored as a
// note document, like the written part of an audio note.
func (s *Server) handleCreateEntry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title string `json:"title"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	now := time.Now().UTC()
	entry := store.Entry{
		ID:        id.New(),
		Title:     strings.TrimSpace(req.Title),
		Status:    store.EntryReady,
		Source:    "text",
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.deps.Store.CreateEntry(r.Context(), entry); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entryJSON(entry))
}

func (s *Server) handleGetEntry(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	entry, err := s.deps.Store.GetEntry(ctx, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	body := entryJSON(entry)
	if names, err := s.entryTagNames(ctx, entry.ID); err == nil {
		body["tags"] = names
	}
	if m, ok, err := s.deps.Store.GetMetrics(ctx, entry.ID); err == nil && ok {
		body["metrics"] = map[string]any{
			"duration_ms":         m.DurationMS,
			"loudness_lufs":       m.LoudnessLUFS,
			"true_peak":           m.TruePeak,
			"silence_count":       m.SilenceCount,
			"silence_total_ms":    m.SilenceTotalMS,
			"sample_rate":         m.SampleRate,
			"channels":            m.Channels,
			"whisper_peak_rss_mb": m.WhisperPeakRSSMB,
		}
	}
	writeJSON(w, http.StatusOK, body)
}

type patchEntryRequest struct {
	Title      *string `json:"title"`
	RecordedAt *string `json:"recorded_at"`
}

func (s *Server) handlePatchEntry(w http.ResponseWriter, r *http.Request) {
	var req patchEntryRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	id := r.PathValue("id")
	if req.Title != nil {
		if err := s.deps.Store.UpdateEntryTitle(r.Context(), id, *req.Title); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	if req.RecordedAt != nil {
		if t, err := time.Parse(time.RFC3339, *req.RecordedAt); err == nil {
			_ = s.deps.Store.UpdateEntryRecordedAt(r.Context(), id, t)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleDeleteEntry(w http.ResponseWriter, r *http.Request) {
	if err := s.deps.Store.SoftDeleteEntry(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetTranscript(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	t, segs, err := s.deps.Store.GetTranscript(ctx, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "transcricao indisponivel")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	segments := make([]map[string]any, 0, len(segs))
	for _, seg := range segs {
		segments = append(segments, map[string]any{
			"start_ms": seg.StartMS,
			"end_ms":   seg.EndMS,
			"text":     seg.Text,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"model":            t.Model,
		"language":         t.Language,
		"text":             t.Text,
		"trim_silence":     t.TrimSilence,
		"duration_seconds": t.DurationSeconds,
		"segments":         segments,
	})
}

func (s *Server) handleRetranscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")
	if _, err := s.deps.Queue.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:"+id, jobs.TranscribePayload{EntryID: id}); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, id, store.EntryQueued)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": id, "status": store.EntryQueued})
	writeJSON(w, http.StatusAccepted, map[string]string{"status": store.EntryQueued})
}

// handleCancelEntry stops any running or queued transcription/analysis of an
// entry and resets its status.
func (s *Server) handleCancelEntry(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")
	ids, err := s.deps.Queue.CancelEntry(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if s.deps.Canceller != nil {
		for _, jobID := range ids {
			s.deps.Canceller.Cancel(jobID)
		}
	}
	status := store.EntryStored
	if _, _, err := s.deps.Store.GetTranscript(ctx, id); err == nil {
		status = store.EntryTranscribed
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, id, status)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": id, "status": status})
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "cancelled": ids})
}
