package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

type noteRequest struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// ContentMarkdown is the note body in markdown (the canonical format).
	// Ponteiro para separar "nao veio no corpo" (400) de "veio vazio" (limpar a
	// nota e uma gravacao legitima).
	ContentMarkdown *string `json:"content_markdown"`
	// BaseVersion is the body version the client last read. Empty means the
	// client has no version yet and the write is applied as-is.
	BaseVersion string `json:"base_version"`
}

func noteJSON(n store.Note) map[string]any {
	body := map[string]any{
		"id":               n.ID,
		"entry_id":         n.EntryID,
		"title":            n.Title,
		"content_markdown": n.ContentMarkdown,
		"created_at":       n.CreatedAt,
		"updated_at":       n.UpdatedAt,
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
	contentMarkdown := ""
	if req.ContentMarkdown != nil {
		contentMarkdown = *req.ContentMarkdown
	}
	n := store.Note{
		ID:              id.New(),
		EntryID:         entryID,
		Title:           req.Title,
		ContentMarkdown: contentMarkdown,
		CreatedAt:       now,
		UpdatedAt:       now,
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

	// Caminho novo: corpo em markdown, com a versao que o cliente leu. O campo
	// pode vir vazio: limpar a nota e uma gravacao como outra qualquer.
	if req.ContentMarkdown != nil {
		version, conflict, err := s.deps.Store.UpdateNoteBody(r.Context(), id, *req.ContentMarkdown, req.BaseVersion)
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

	// Sem `content_markdown` nao ha o que gravar: o corpo da nota e markdown
	// (ver docs/api.md). Aceitar documento JSON aqui era o caminho que fazia o
	// app sobrescrever o markdown sem querer.
	writeError(w, http.StatusBadRequest, "missing_markdown", "content_markdown obrigatorio")
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	if err := s.deps.Store.DeleteNote(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListRevisions(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	offset := 0
	if raw := strings.TrimSpace(query.Get("cursor")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			offset = n
		}
	}
	limit := 50
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 200 {
		limit = 200
	}
	revs, more, err := s.deps.Store.ListRevisionsPage(r.Context(), r.PathValue("id"), offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(revs))
	for _, rev := range revs {
		// O corpo anterior em markdown. A coluna se chama `document` por heranca
		// dos tempos do JSON do BlockNote, mas o conteudo gravado e markdown: a
		// revisao e escrita antes de cada troca de corpo.
		out = append(out, map[string]any{
			"id":               rev.ID,
			"content_markdown": rev.Document,
			"created_at":       rev.CreatedAt,
		})
	}
	body := map[string]any{"revisions": out}
	if more {
		body["next_cursor"] = strconv.Itoa(offset + len(out))
	}
	writeJSON(w, http.StatusOK, body)
}
