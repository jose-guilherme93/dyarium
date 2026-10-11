package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/jose-guilherme93/dyarium/internal/store"
)

func entitySummaryJSON(s store.EntitySummary) map[string]any {
	return map[string]any{
		"kind":      s.Kind,
		"name":      s.Name,
		"entries":   s.Entries,
		"mentions":  s.Mentions,
		"sentiment": s.Sentiment,
		"last_seen": nullTime(s.LastSeen),
	}
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

func (s *Server) handleListEntities(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if kind != "" && kind != store.EntityPerson && kind != store.EntityPlace && kind != store.EntityTheme {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place ou theme")
		return
	}
	entities, err := s.deps.Store.ListEntities(r.Context(), kind)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(entities))
	for _, e := range entities {
		out = append(out, entitySummaryJSON(e))
	}
	writeJSON(w, http.StatusOK, map[string]any{"entities": out})
}

func (s *Server) handleGetEntity(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if kind != store.EntityPerson && kind != store.EntityPlace && kind != store.EntityTheme {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place ou theme")
		return
	}
	summary, entries, ok, err := s.deps.Store.GetEntity(r.Context(), kind, r.PathValue("name"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "entidade inexistente")
		return
	}
	list := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		list = append(list, map[string]any{
			"id":    e.EntryID,
			"title": e.Title,
			"date":  nullTime(e.Date),
			"count": e.Count,
		})
	}
	body := entitySummaryJSON(summary)
	body["entry_list"] = list
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleMood(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	from := parseDateParam(query.Get("from"), false)
	to := parseDateParam(query.Get("to"), true)
	points, err := s.deps.Store.MoodSeries(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(points))
	for _, p := range points {
		out = append(out, map[string]any{
			"date":      p.Date,
			"sentiment": p.Sentiment,
			"entries":   p.Entries,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"mood": out})
}

// parseDateParam accepts RFC3339 or YYYY-MM-DD. Empty or invalid values yield
// the zero time (unbounded).
func parseDateParam(value string, endOfDay bool) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02", value); err == nil {
		if endOfDay {
			return t.Add(24*time.Hour - time.Second)
		}
		return t
	}
	return time.Time{}
}
