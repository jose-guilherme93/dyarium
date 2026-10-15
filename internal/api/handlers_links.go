package api

import (
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

func linkJSON(l store.Link) map[string]any {
	return map[string]any{
		"id":            l.ID,
		"from_entry_id": l.FromEntryID,
		"to_entry_id":   l.ToEntryID,
		"url":           l.URL,
		"label":         l.Label,
		"title":         l.Title,
		"created_at":    l.CreatedAt,
	}
}

func (s *Server) handleListLinks(w http.ResponseWriter, r *http.Request) {
	links, err := s.deps.Store.ListLinks(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(links))
	for _, link := range links {
		out = append(out, linkJSON(link))
	}
	writeJSON(w, http.StatusOK, map[string]any{"links": out})
}

// handleCreateLink creates a link from an entry to another entry (to_entry_id)
// or to an external URL (url). Exactly one of them must be provided.
func (s *Server) handleCreateLink(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	entryID := r.PathValue("id")
	if _, err := s.deps.Store.GetEntry(ctx, entryID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var req struct {
		ToEntryID string `json:"to_entry_id"`
		URL       string `json:"url"`
		Label     string `json:"label"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	to := strings.TrimSpace(req.ToEntryID)
	rawURL := strings.TrimSpace(req.URL)
	switch {
	case to == "" && rawURL == "":
		writeError(w, http.StatusBadRequest, "invalid_link", "informe to_entry_id ou url")
		return
	case to != "" && rawURL != "":
		writeError(w, http.StatusBadRequest, "invalid_link", "informe to_entry_id ou url, nao ambos")
		return
	}
	link := store.Link{
		ID:          id.New(),
		FromEntryID: entryID,
		Label:       strings.TrimSpace(req.Label),
		CreatedAt:   time.Now().UTC(),
	}
	if to != "" {
		if to == entryID {
			writeError(w, http.StatusBadRequest, "invalid_link", "uma nota nao pode apontar para si mesma")
			return
		}
		if _, err := s.deps.Store.GetEntry(ctx, to); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeError(w, http.StatusUnprocessableEntity, "invalid_target", "nota de destino inexistente")
				return
			}
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		link.ToEntryID = to
	} else {
		if !validExternalURL(rawURL) {
			writeError(w, http.StatusBadRequest, "invalid_url", "url deve ser http ou https")
			return
		}
		link.URL = rawURL
	}
	if err := s.deps.Store.CreateLink(ctx, link); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, linkJSON(link))
}

func (s *Server) handleDeleteLink(w http.ResponseWriter, r *http.Request) {
	if err := s.deps.Store.DeleteLink(r.Context(), r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "link inexistente")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// validExternalURL accepts absolute http/https URLs only.
func validExternalURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
