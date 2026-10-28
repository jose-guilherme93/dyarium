package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func entitySummaryJSON(s store.EntitySummary) map[string]any {
	return map[string]any{
		"id":        s.ID,
		"kind":      s.Kind,
		"name":      s.Name,
		"icon":      s.Icon,
		"entries":   s.Entries,
		"mentions":  s.Mentions,
		"sentiment": s.Sentiment,
		"last_seen": nullTime(s.LastSeen),
	}
}

// handleGraph returns the relationship map centered on the diarist. The
// default view is the ego network of entities; `focus` opens one entity with
// its notes. The center label comes from the owner name, never from the notes:
// the map is the diarist's, even when a note was recorded by someone else.
func (s *Server) handleGraph(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	query := r.URL.Query()
	notebookID := strings.TrimSpace(query.Get("notebook_id"))
	if notebookID != "" {
		if err := s.deps.Store.NotebookExists(ctx, notebookID); err != nil {
			if errors.Is(err, store.ErrNotebookNotFound) {
				writeError(w, http.StatusNotFound, "notebook_not_found", "caderno inexistente")
				return
			}
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	settings, err := s.deps.Store.ListSettings(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	owner := strings.TrimSpace(settings["owner_name"])
	if owner == "" {
		owner = "Você"
	}
	data, err := s.deps.Store.Graph(ctx, store.GraphOptions{
		NotebookID: notebookID,
		From:       parseDateParam(query.Get("from"), false),
		To:         parseDateParam(query.Get("to"), true),
		Focus:      query.Get("focus"),
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "entidade inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	nodes := make([]map[string]any, 0, len(data.Nodes))
	for _, node := range data.Nodes {
		item := map[string]any{
			"id":       node.ID,
			"kind":     node.Kind,
			"label":    node.Label,
			"mentions": node.Mentions,
			"notes":    node.Notes,
		}
		switch node.Kind {
		case store.GraphNote:
			item["date"] = nullTime(node.Date)
			item["author"] = node.Author
		default:
			item["sentiment"] = node.Sentiment
			item["last_seen"] = nullTime(node.LastSeen)
			item["icon"] = node.Icon
		}
		nodes = append(nodes, item)
	}
	edges := make([]map[string]any, 0, len(data.Edges))
	for _, edge := range data.Edges {
		edges = append(edges, map[string]any{
			"source": edge.Source,
			"target": edge.Target,
			"kind":   edge.Kind,
			"weight": edge.Weight,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"center":      map[string]any{"id": "user", "kind": "user", "label": owner},
		"nodes":       nodes,
		"edges":       edges,
		"total_nodes": data.TotalNodes,
		"total_edges": data.TotalEdges,
		"truncated":   data.Truncated,
	})
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

func (s *Server) handleListEntities(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if kind != "" && !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
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
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
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

// handleRenameEntity changes the display name of a person, place, theme or
// decision. The old name becomes an alias, so the next analysis still resolves
// to the same entity; when the new name already exists, the two are merged.
func (s *Server) handleRenameEntity(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	summary, err := s.deps.Store.RenameEntity(r.Context(), kind, r.PathValue("name"), req.Name)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "entidade inexistente")
		return
	}
	if errors.Is(err, store.ErrInvalidEntity) {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entitySummaryJSON(summary))
}

// handleClaimSelf folds a person into the diarist. The person stops being a
// node; its name and aliases become owner spellings, so every analysis resolves
// them to the owner name from settings. Used by the "sou eu" check on the map.
func (s *Server) handleClaimSelf(w http.ResponseWriter, r *http.Request) {
	owner, err := s.deps.Store.ClaimPersonAsOwner(r.Context(), r.PathValue("name"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "pessoa inexistente")
		return
	}
	if errors.Is(err, store.ErrInvalidEntity) {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "owner": owner})
}

// handleSetEntityIcon stores the monochrome glyph the map draws inside one
// entity. Empty returns to the icon of the kind. The key list is shared with
// the clients and validated here so the database never keeps an unknown glyph.
func (s *Server) handleSetEntityIcon(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
		return
	}
	var req struct {
		Icon string `json:"icon"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	summary, err := s.deps.Store.SetEntityIcon(r.Context(), kind, r.PathValue("name"), req.Icon)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "entidade inexistente")
		return
	}
	if errors.Is(err, store.ErrInvalidEntity) {
		writeError(w, http.StatusBadRequest, "invalid_icon", "icone invalido")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entitySummaryJSON(summary))
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
