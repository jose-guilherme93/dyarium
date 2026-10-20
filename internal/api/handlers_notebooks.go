package api

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

const maxNotebookName = 80

// validColor aceita vazio (neutro) ou um hex #RGB/#RRGGBB. A cor e renderizada
// direto no app e no dashboard; nada de string livre vinda do cliente.
func validColor(raw string) bool {
	value := strings.TrimSpace(raw)
	if value == "" {
		return true
	}
	if len(value) != 4 && len(value) != 7 {
		return false
	}
	if value[0] != '#' {
		return false
	}
	for _, c := range value[1:] {
		switch {
		case c >= '0' && c <= '9', c >= 'a' && c <= 'f', c >= 'A' && c <= 'F':
		default:
			return false
		}
	}
	return true
}

func notebookJSON(n store.Notebook) map[string]any {
	body := map[string]any{
		"id":          n.ID,
		"name":        n.Name,
		"color":       n.Color,
		"is_default":  n.IsDefault,
		"entry_count": n.EntryCount,
		"created_at":  n.CreatedAt,
		"updated_at":  n.UpdatedAt,
	}
	if n.LastEntryAt != nil {
		body["last_entry_at"] = n.LastEntryAt
	}
	return body
}

func (s *Server) handleListNotebooks(w http.ResponseWriter, r *http.Request) {
	notebooks, err := s.deps.Store.ListNotebooks(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(notebooks))
	for _, n := range notebooks {
		out = append(out, notebookJSON(n))
	}
	writeJSON(w, http.StatusOK, map[string]any{"notebooks": out})
}

type notebookRequest struct {
	// ID opcional: o app cria cadernos offline e quer manter o mesmo id nos dois
	// lados. Sem ele, o servidor gera um.
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (s *Server) handleCreateNotebook(w http.ResponseWriter, r *http.Request) {
	var req notebookRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome obrigatorio")
		return
	}
	if utf8.RuneCountInString(name) > maxNotebookName {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome longo demais")
		return
	}
	if !validColor(req.Color) {
		writeError(w, http.StatusBadRequest, "invalid_color", "cor invalida")
		return
	}
	notebookID := strings.TrimSpace(req.ID)
	if notebookID != "" {
		if !id.Valid(notebookID) {
			writeError(w, http.StatusBadRequest, "invalid_id", "id invalido")
			return
		}
		if existing, err := s.deps.Store.GetNotebook(r.Context(), notebookID); err == nil {
			writeJSON(w, http.StatusOK, notebookJSON(existing))
			return
		}
	}
	now := time.Now().UTC()
	if notebookID == "" {
		notebookID = id.New()
	}
	notebook := store.Notebook{
		ID:        notebookID,
		Name:      name,
		Color:     strings.TrimSpace(req.Color),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.deps.Store.CreateNotebook(r.Context(), notebook); err != nil {
		if errors.Is(err, store.ErrNotebookExists) {
			writeError(w, http.StatusConflict, "conflict", "caderno ja existe")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	notebook, err := s.deps.Store.GetNotebook(r.Context(), notebook.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("notebook.changed", map[string]string{"notebook_id": notebook.ID})
	writeJSON(w, http.StatusCreated, notebookJSON(notebook))
}

func (s *Server) handleUpdateNotebook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name  *string `json:"name"`
		Color *string `json:"color"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if req.Name == nil && req.Color == nil {
		writeError(w, http.StatusBadRequest, "empty_patch", "nada para atualizar")
		return
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "invalid_name", "nome obrigatorio")
			return
		}
		if utf8.RuneCountInString(name) > maxNotebookName {
			writeError(w, http.StatusBadRequest, "invalid_name", "nome longo demais")
			return
		}
	}
	if req.Color != nil && !validColor(*req.Color) {
		writeError(w, http.StatusBadRequest, "invalid_color", "cor invalida")
		return
	}
	notebook, err := s.deps.Store.UpdateNotebook(r.Context(), r.PathValue("id"), req.Name, req.Color)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "caderno inexistente")
		return
	}
	if errors.Is(err, store.ErrProtected) {
		writeError(w, http.StatusConflict, "protected", "caderno padrao protegido")
		return
	}
	if errors.Is(err, store.ErrNotebookExists) {
		writeError(w, http.StatusConflict, "conflict", "caderno ja existe")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("notebook.changed", map[string]string{"notebook_id": notebook.ID})
	writeJSON(w, http.StatusOK, notebookJSON(notebook))
}

func (s *Server) handleDeleteNotebook(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	err := s.deps.Store.DeleteNotebook(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "caderno inexistente")
		return
	}
	if errors.Is(err, store.ErrProtected) {
		writeError(w, http.StatusConflict, "protected", "caderno padrao protegido")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("notebook.changed", map[string]string{"notebook_id": id})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpdateTag(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name  *string `json:"name"`
		Color *string `json:"color"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if req.Name == nil && req.Color == nil {
		writeError(w, http.StatusBadRequest, "empty_patch", "nada para atualizar")
		return
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome obrigatorio")
		return
	}
	if req.Color != nil && !validColor(*req.Color) {
		writeError(w, http.StatusBadRequest, "invalid_color", "cor invalida")
		return
	}
	tag, merged, err := s.deps.Store.UpdateTag(r.Context(), r.PathValue("id"), req.Name, req.Color)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "tag inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	body := map[string]any{
		"id":          tag.ID,
		"name":        tag.Name,
		"color":       tag.Color,
		"entry_count": tag.EntryCount,
		"merged":      merged,
	}
	writeJSON(w, http.StatusOK, body)
}
