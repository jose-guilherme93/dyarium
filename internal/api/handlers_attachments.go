package api

import (
	"database/sql"
	"errors"
	"fmt"
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
	// An attachment id always points at the same immutable ciphertext. A long
	// cache is safe: rotating the token changes the URL, and a re-upload creates
	// a new id.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Accept-Ranges", "bytes")
	etag := `"` + att.ID + `"`
	if att.SHA256 != "" {
		etag = `"` + att.SHA256 + `"`
	}
	w.Header().Set("ETag", etag)
	if r.Header.Get("Range") == "" && etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	size := att.SizeBytes
	if size <= 0 {
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
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
	// HEAD asks for metadata only: never decrypt the object to discard the body.
	if r.Method == http.MethodHead {
		return
	}

	var err error
	if partial {
		// Decrypt only the requested window instead of the whole object.
		_, err = s.deps.Ingest.DecryptAttachmentRange(r.Context(), att, start, end, w)
	} else {
		_, err = s.deps.Ingest.DecryptAttachment(r.Context(), att, w)
	}
	if err != nil && s.deps.Logger != nil {
		s.deps.Logger.Error("api: transmitir anexo", "erro", err)
	}
}

// etagMatches reports whether an If-None-Match header value matches etag. An
// absent header (or absent ETag) never matches: otherwise every response
// without a validator would be turned into a 304.
func etagMatches(header, etag string) bool {
	if header == "" || etag == "" {
		return false
	}
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || candidate == etag || strings.TrimPrefix(candidate, "W/") == etag {
			return true
		}
	}
	return false
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
	// A transcricao e os segmentos caem junto (FK ON DELETE CASCADE). A duracao
	// da nota e a soma dos audios que sobraram, nao a do audio que saiu.
	if err := s.deps.Store.SyncEntryDuration(ctx, att.EntryID); err != nil && s.deps.Logger != nil {
		s.deps.Logger.Error("api: sincronizar duracao da entrada", "entry_id", att.EntryID, "erro", err)
	}
	if err := s.deps.Ingest.DeleteAttachmentObject(att); err != nil && s.deps.Logger != nil {
		s.deps.Logger.Error("api: remover objeto de anexo", "erro", err)
	}
	w.WriteHeader(http.StatusNoContent)
}
