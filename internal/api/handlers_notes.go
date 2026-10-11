package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jose-guilherme93/dyarium/internal/id"
	"github.com/jose-guilherme93/dyarium/internal/store"
)

type noteRequest struct {
	Title    string          `json:"title"`
	Document json.RawMessage `json:"document"`
}

func noteJSON(n store.Note) map[string]any {
	return map[string]any{
		"id":         n.ID,
		"entry_id":   n.EntryID,
		"title":      n.Title,
		"document":   json.RawMessage(n.Document),
		"created_at": n.CreatedAt,
		"updated_at": n.UpdatedAt,
	}
}

func (s *Server) handleListNotes(w http.ResponseWriter, r *http.Request) {
	notes, err := s.deps.Store.ListNotes(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(notes))
	for _, n := range notes {
		out = append(out, noteJSON(n))
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": out})
}

func (s *Server) handleCreateNote(w http.ResponseWriter, r *http.Request) {
	var req noteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	entryID := r.PathValue("id")
	if _, err := s.deps.Store.GetEntry(r.Context(), entryID); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	now := time.Now().UTC()
	doc := req.Document
	if len(doc) == 0 {
		doc = json.RawMessage("{}")
	}
	n := store.Note{
		ID:        id.New(),
		EntryID:   entryID,
		Title:     req.Title,
		Document:  string(doc),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.deps.Store.CreateNote(r.Context(), n); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, noteJSON(n))
}

func (s *Server) handleGetNote(w http.ResponseWriter, r *http.Request) {
	n, err := s.deps.Store.GetNote(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "nota inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, noteJSON(n))
}

func (s *Server) handleUpdateNote(w http.ResponseWriter, r *http.Request) {
	var req noteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	doc := string(req.Document)
	if len(req.Document) == 0 {
		doc = ""
	}
	if err := s.deps.Store.UpdateNote(r.Context(), r.PathValue("id"), req.Title, doc); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	if err := s.deps.Store.DeleteNote(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListRevisions(w http.ResponseWriter, r *http.Request) {
	revs, err := s.deps.Store.ListRevisions(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(revs))
	for _, rev := range revs {
		out = append(out, map[string]any{
			"id":         rev.ID,
			"document":   json.RawMessage(rev.Document),
			"created_at": rev.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": out})
}
