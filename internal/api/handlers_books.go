package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/joseti/dyarium/internal/store"
)

// handleReorderChapters rewrites the whole live chapter list of a book in one
// transaction. The client sends every chapter because dragging one changes the
// position of the others.
func (s *Server) handleReorderChapters(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Chapters []struct {
			EntryID       string  `json:"entry_id"`
			ChapterKind   string  `json:"chapter_kind"`
			ChapterStatus string  `json:"chapter_status"`
			Position      float64 `json:"position"`
		} `json:"chapters"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	chapters := make([]store.ChapterOrder, 0, len(req.Chapters))
	for _, item := range req.Chapters {
		chapters = append(chapters, store.ChapterOrder{
			EntryID:       strings.TrimSpace(item.EntryID),
			ChapterKind:   strings.TrimSpace(item.ChapterKind),
			ChapterStatus: strings.TrimSpace(item.ChapterStatus),
			Position:      item.Position,
		})
	}
	err := s.deps.Store.ReorderChapters(r.Context(), r.PathValue("id"), chapters)
	if errors.Is(err, store.ErrNotABook) {
		writeError(w, http.StatusUnprocessableEntity, "not_a_book", "caderno nao e um livro")
		return
	}
	if errors.Is(err, store.ErrChapterNotInBook) {
		writeError(w, http.StatusUnprocessableEntity, "chapter_not_in_book", "capitulo nao pertence ao livro")
		return
	}
	if errors.Is(err, store.ErrInvalidChapter) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_chapter", "capitulo invalido")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "caderno inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("notebook.changed", map[string]string{"notebook_id": r.PathValue("id")})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
