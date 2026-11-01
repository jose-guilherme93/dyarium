package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/joseti/dyarium/internal/store"
)

// handleGetWriting returns the writing rhythm of a book: the last days, today's
// net words, the daily goal and the deadline. The dashboard shows "hoje" in the
// chapter topbar and the pace in the book home.
func (s *Server) handleGetWriting(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	days := 7
	if raw := r.URL.Query().Get("days"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 90 {
			days = parsed
		}
	}
	notebook, err := s.deps.Store.GetNotebook(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "caderno inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	items, err := s.deps.Store.WritingDays(r.Context(), id, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(items))
	today := 0
	for _, item := range items {
		out = append(out, map[string]any{"day": item.Day, "words": item.Words})
		today = item.Words
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"today":      today,
		"days":       out,
		"daily_goal": notebook.DailyGoalWords,
		"deadline":   notebook.Deadline,
		"goal_words": notebook.GoalWords,
	})
}

// handleBookEntities lists the entities already found in the book chapters.
func (s *Server) handleBookEntities(w http.ResponseWriter, r *http.Request) {
	items, err := s.deps.Store.BookEntities(r.Context(), r.PathValue("id"), 30)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"kind": item.Kind, "name": item.Name,
			"mentions": item.Mentions, "chapters": item.Chapters,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"entities": out})
}
