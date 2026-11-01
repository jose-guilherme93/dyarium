package api

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// maxCoverBytes bounds the cropped cover uploaded by the dashboard.
const maxCoverBytes = 8 << 20

func (s *Server) handleGetBookCover(w http.ResponseWriter, r *http.Request) {
	notebookID := r.PathValue("id")
	cover, err := s.deps.Store.GetBookCover(r.Context(), notebookID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "capa inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	etag := `"` + cover.UpdatedAt.UTC().Format(time.RFC3339Nano) + `"`
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", cover.ContentType)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("Content-Length", strconv.Itoa(len(cover.Image)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(cover.Image)
}

func (s *Server) handlePutBookCover(w http.ResponseWriter, r *http.Request) {
	notebookID := r.PathValue("id")
	notebook, err := s.deps.Store.GetNotebook(r.Context(), notebookID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "caderno inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !notebook.IsBook() {
		writeError(w, http.StatusUnprocessableEntity, "not_a_book", "caderno nao e um livro")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxCoverBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "empty_cover", "imagem vazia")
		return
	}
	if len(body) > maxCoverBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "capa grande demais")
		return
	}
	contentType := strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])
	if contentType != "image/jpeg" && contentType != "image/png" && contentType != "image/webp" {
		writeError(w, http.StatusUnsupportedMediaType, "invalid_image", "formato de imagem invalido")
		return
	}
	detected := http.DetectContentType(body)
	if !strings.HasPrefix(detected, contentType) {
		writeError(w, http.StatusUnsupportedMediaType, "invalid_image", "imagem nao confere com o tipo")
		return
	}
	cover := store.BookCover{
		NotebookID:  notebookID,
		ContentType: contentType,
		Image:       body,
		UpdatedAt:   time.Now().UTC(),
	}
	if err := s.deps.Store.SetBookCover(r.Context(), cover); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("notebook.changed", map[string]string{"notebook_id": notebookID})
	writeJSON(w, http.StatusOK, map[string]any{
		"notebook_id":      notebookID,
		"cover_updated_at": cover.UpdatedAt,
		"size_bytes":       len(body),
	})
}

func (s *Server) handleDeleteBookCover(w http.ResponseWriter, r *http.Request) {
	notebookID := r.PathValue("id")
	if err := s.deps.Store.DeleteBookCover(r.Context(), notebookID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("notebook.changed", map[string]string{"notebook_id": notebookID})
	w.WriteHeader(http.StatusNoContent)
}
