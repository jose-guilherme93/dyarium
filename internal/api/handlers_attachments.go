package api

import (
	"database/sql"
	"errors"
	"net/http"
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
	w.WriteHeader(http.StatusOK)
	if _, err := s.deps.Ingest.DecryptAttachment(r.Context(), att, w); err != nil && s.deps.Logger != nil {
		s.deps.Logger.Error("api: transmitir anexo", "erro", err)
	}
}

// handleGetEntryAudio streams the decrypted original audio so the dashboard can
// play it. The plaintext is never written to disk.
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
