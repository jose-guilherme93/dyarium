package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

type noteRequest struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Document is the legacy BlockNote JSON body, accepted only while old notes
	// are being converted.
	Document json.RawMessage `json:"document"`
	// ContentMarkdown is the note body in markdown (the canonical format).
	ContentMarkdown string `json:"content_markdown"`
	// BaseVersion is the body version the client last read. Empty means the
	// client has no version yet and the write is applied as-is.
	BaseVersion string `json:"base_version"`
}

func noteJSON(n store.Note) map[string]any {
	body := map[string]any{
		"id":         n.ID,
		"entry_id":   n.EntryID,
		"title":      n.Title,
		"created_at": n.CreatedAt,
		"updated_at": n.UpdatedAt,
	}
	if n.ContentMarkdown != "" || n.Document == "" {
		body["content_markdown"] = n.ContentMarkdown
	} else {
		// Nota ainda nao convertida: o cliente ainda precisa do documento antigo.
		body["document"] = json.RawMessage(n.Document)
	}
	if n.BodyUpdatedAt != nil {
		body["body_version"] = *n.BodyUpdatedAt
	}
	return body
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
	n := store.Note{
		ID:              id.New(),
		EntryID:         entryID,
		Title:           req.Title,
		ContentMarkdown: req.ContentMarkdown,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if len(req.Document) > 0 {
		n.Document = string(req.Document)
	}
	if clientID := strings.TrimSpace(req.ID); clientID != "" {
		if !id.Valid(clientID) {
			writeError(w, http.StatusBadRequest, "invalid_id", "id invalido")
			return
		}
		// Idempotente: reenvio offline da mesma nota.
		existing, err := s.deps.Store.GetNote(r.Context(), clientID)
		if err == nil {
			writeJSON(w, http.StatusOK, noteJSON(existing))
			return
		}
		if !errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		n.ID = clientID
	}
	if err := s.deps.Store.CreateNote(r.Context(), n); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// Relê para devolver a versão do corpo gravada (o cliente precisa dela para
	// a próxima gravação não virar conflito consigo mesmo).
	created, err := s.deps.Store.GetNote(r.Context(), n.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, noteJSON(created))
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
	id := r.PathValue("id")

	// Caminho novo: corpo em markdown, com a versao que o cliente leu.
	if req.ContentMarkdown != "" {
		version, conflict, err := s.deps.Store.UpdateNoteBody(r.Context(), id, req.ContentMarkdown, req.BaseVersion)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "nota inexistente")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if conflict {
			// O corpo mudou depois que este cliente leu: perguntar em vez de
			// sobrescrever em silencio.
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":    map[string]string{"code": "conflict", "message": "a nota mudou no outro lugar"},
				"conflict": []string{store.FieldBody},
				"versions": map[string]string{store.FieldBody: version},
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":   "ok",
			"versions": map[string]string{store.FieldBody: version},
		})
		return
	}

	// Caminho legado: documento JSON (so enquanto as notas antigas nao virarem
	// markdown).
	doc := string(req.Document)
	if len(req.Document) == 0 {
		doc = ""
	}
	if err := s.deps.Store.UpdateNote(r.Context(), id, req.Title, doc); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "nota inexistente")
			return
		}
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
