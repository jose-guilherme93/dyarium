package api

import (
	"net/http"
	"strconv"
)

// handleListActivities lists the processes that finished for a note, newest
// first. The web notifications menu uses it to show transcriptions and
// analyses; opening an item opens the note.
func (s *Server) handleListActivities(w http.ResponseWriter, r *http.Request) {
	limit := 30
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil {
			limit = value
		}
	}
	activities, err := s.deps.Store.ListActivities(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"activities": activities})
}
