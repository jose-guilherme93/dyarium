package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

func (s *Server) handleListTags(w http.ResponseWriter, r *http.Request) {
	tags, err := s.deps.Store.ListTags(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(tags))
	for _, t := range tags {
		out = append(out, map[string]any{
			"id":          t.ID,
			"name":        t.Name,
			"color":       t.Color,
			"entry_count": t.EntryCount,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": out})
}

type tagRequest struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (s *Server) handleCreateTag(w http.ResponseWriter, r *http.Request) {
	var req tagRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome obrigatorio")
		return
	}
	tag := store.Tag{ID: id.New(), Name: name, Color: req.Color, CreatedAt: time.Now().UTC()}
	if err := s.deps.Store.CreateTag(r.Context(), tag); err != nil {
		writeError(w, http.StatusConflict, "conflict", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": tag.ID, "name": tag.Name, "color": tag.Color})
}

func (s *Server) handleDeleteTag(w http.ResponseWriter, r *http.Request) {
	if err := s.deps.Store.DeleteTag(r.Context(), r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "tag inexistente")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
