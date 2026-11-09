package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func entitySummaryJSON(s store.EntitySummary) map[string]any {
	aliases := s.Aliases
	if aliases == nil {
		aliases = []string{}
	}
	return map[string]any{
		"id":         s.ID,
		"kind":       s.Kind,
		"name":       s.Name,
		"label":      s.Label,
		"icon":       s.Icon,
		"entries":    s.Entries,
		"mentions":   s.Mentions,
		"sentiment":  s.Sentiment,
		"last_seen":  nullTime(s.LastSeen),
		"updated_at": nullTime(s.UpdatedAt),
		"aliases":    aliases,
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
		NotebookID:   notebookID,
		ExcludeBooks: truthy(query.Get("exclude_books")),
		From:         parseDateParam(query.Get("from"), false),
		To:           parseDateParam(query.Get("to"), true),
		Focus:        query.Get("focus"),
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
	// As grafias "sou eu" viajam junto: sem elas o app nao sabe que uma pessoa
	// reivindicada no painel saiu do mapa e virou o dono.
	ownerAliases, err := s.deps.Store.ListOwnerAliases(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// A memoria de rejeicoes viaja junto: o app precisa dela para filtrar a
	// extracao local com a mesma curadoria do servidor.
	rejections, err := s.deps.Store.ListEntityRejections(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(entities))
	for _, e := range entities {
		out = append(out, entitySummaryJSON(e))
	}
	rejected := make([]map[string]any, 0, len(rejections))
	for _, item := range rejections {
		rejected = append(rejected, entityRejectionJSON(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"entities":      out,
		"owner_aliases": ownerAliases,
		"rejections":    rejected,
	})
}

// entityRejectionJSON is the wire shape of one rejected name.
func entityRejectionJSON(item store.EntityRejection) map[string]any {
	return map[string]any{
		"kind":       item.Kind,
		"name":       item.Name,
		"name_key":   item.NameKey,
		"updated_at": nullTime(item.UpdatedAt),
	}
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
	oldName := strings.TrimSpace(r.PathValue("name"))
	newName := strings.TrimSpace(req.Name)
	editID := s.prepareEntityEdit(r, "rename", oldName+" -> "+newName, kind, oldName, newName)
	summary, err := s.deps.Store.RenameEntity(r.Context(), kind, oldName, req.Name)
	if err != nil && editID != "" {
		_ = s.deps.Store.DiscardEntityEdit(r.Context(), editID)
	}
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
	body := entitySummaryJSON(summary)
	if editID != "" {
		body["edit_id"] = editID
	}
	writeJSON(w, http.StatusOK, body)
}

// handleClaimSelf folds a person into the diarist. The person stops being a
// node; its name and aliases become owner spellings, so every analysis resolves
// them to the owner name from settings. Used by the "sou eu" check on the map.
func (s *Server) handleClaimSelf(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.PathValue("name"))
	editID := s.prepareEntityEdit(r, "self", name, store.EntityPerson, name)
	owner, err := s.deps.Store.ClaimPersonAsOwner(r.Context(), r.PathValue("name"))
	if err != nil && editID != "" {
		_ = s.deps.Store.DiscardEntityEdit(r.Context(), editID)
	}
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
	body := map[string]any{"status": "ok", "owner": owner}
	if editID != "" {
		body["edit_id"] = editID
	}
	writeJSON(w, http.StatusOK, body)
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
	name := strings.TrimSpace(r.PathValue("name"))
	editID := s.prepareEntityEdit(r, "icon", name, kind, name)
	summary, err := s.deps.Store.SetEntityIcon(r.Context(), kind, r.PathValue("name"), req.Icon)
	if err != nil && editID != "" {
		_ = s.deps.Store.DiscardEntityEdit(r.Context(), editID)
	}
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
	body := entitySummaryJSON(summary)
	if editID != "" {
		body["edit_id"] = editID
	}
	writeJSON(w, http.StatusOK, body)
}

// handleSetEntityLabel stores the free display label of one entity. Empty
// clears it. The label is display-only: it does not change kind, metrics or
// the sync key.
func (s *Server) handleSetEntityLabel(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
		return
	}
	var req struct {
		Label string `json:"label"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	editID := s.prepareEntityEdit(r, "label", name+" = "+strings.TrimSpace(req.Label), kind, name)
	summary, err := s.deps.Store.SetEntityLabel(r.Context(), kind, name, req.Label)
	if err != nil && editID != "" {
		_ = s.deps.Store.DiscardEntityEdit(r.Context(), editID)
	}
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "entidade inexistente")
		return
	case errors.Is(err, store.ErrInvalidEntity):
		writeError(w, http.StatusBadRequest, "invalid_label", "rotulo invalido")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	body := entitySummaryJSON(summary)
	if editID != "" {
		body["edit_id"] = editID
	}
	writeJSON(w, http.StatusOK, body)
}

// handleChangeEntityKind moves an entity to another kind. When the target kind
// already has the same name (or an alias), the two are merged; otherwise the
// links follow the entity. The old kind is recorded as a rejection.
func (s *Server) handleChangeEntityKind(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
		return
	}
	var req struct {
		Kind string `json:"kind"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	newKind := strings.TrimSpace(req.Kind)
	if !store.ValidEntityKind(newKind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind de destino invalido")
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	}
	if newKind == kind {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind de destino deve ser diferente")
		return
	}
	// O alvo da mescla tambem entra na foto: se ja existir, o desfazer precisa
	// restaurar as duas entidades e as contagens originais.
	editID := s.prepareEntityEditPairs(r, "kind", name+" -> "+newKind,
		store.EntityPair{Kind: kind, Name: name},
		store.EntityPair{Kind: newKind, Name: name})
	summary, err := s.deps.Store.ChangeEntityKind(r.Context(), kind, name, newKind)
	if err != nil && editID != "" {
		_ = s.deps.Store.DiscardEntityEdit(r.Context(), editID)
	}
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "entidade inexistente")
		return
	case errors.Is(err, store.ErrInvalidEntity):
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind invalido")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	body := entitySummaryJSON(summary)
	if editID != "" {
		body["edit_id"] = editID
	}
	writeJSON(w, http.StatusOK, body)
}

// handleDeleteEntity removes an entity (links and aliases cascade) and records
// a rejection of its kind. The response carries the edit id for the undo.
func (s *Server) handleDeleteEntity(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	}
	editID := s.prepareEntityEdit(r, "delete", name, kind, name)
	err := s.deps.Store.DeleteEntity(r.Context(), kind, name)
	if err != nil && editID != "" {
		_ = s.deps.Store.DiscardEntityEdit(r.Context(), editID)
	}
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "entidade inexistente")
		return
	case errors.Is(err, store.ErrInvalidEntity):
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	rejection := map[string]any{
		"kind":     kind,
		"name":     name,
		"name_key": store.EntityRejectionKey(name),
	}
	if saved, ok := s.findEntityRejection(r, kind, name); ok {
		rejection = entityRejectionJSON(saved)
	}
	body := map[string]any{"status": "ok", "rejection": rejection}
	if editID != "" {
		body["edit_id"] = editID
	}
	writeJSON(w, http.StatusOK, body)
}

// findEntityRejection reads back the rejection a mutation just wrote, so the
// response carries the canonical name and the sync timestamp.
func (s *Server) findEntityRejection(r *http.Request, kind, name string) (store.EntityRejection, bool) {
	items, err := s.deps.Store.ListEntityRejections(r.Context())
	if err != nil {
		return store.EntityRejection{}, false
	}
	key := store.EntityRejectionKey(name)
	for _, item := range items {
		if item.Kind == kind && item.NameKey == key {
			return item, true
		}
	}
	return store.EntityRejection{}, false
}

// handleAddEntityRejection records that a name is never an entity of a kind.
// The next analysis discards that link before persisting it.
func (s *Server) handleAddEntityRejection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	kind := strings.TrimSpace(req.Kind)
	name := strings.TrimSpace(req.Name)
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
		return
	}
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	}
	editID := s.prepareEntityEdit(r, "reject", kind+" "+name, kind, name)
	err := s.deps.Store.AddEntityRejection(r.Context(), kind, name)
	if err != nil && editID != "" {
		_ = s.deps.Store.DiscardEntityEdit(r.Context(), editID)
	}
	if errors.Is(err, store.ErrInvalidEntity) {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	rejection := map[string]any{
		"kind":     kind,
		"name":     name,
		"name_key": store.EntityRejectionKey(name),
	}
	if saved, ok := s.findEntityRejection(r, kind, name); ok {
		rejection = entityRejectionJSON(saved)
	}
	body := map[string]any{"status": "ok", "rejection": rejection}
	if editID != "" {
		body["edit_id"] = editID
	}
	writeJSON(w, http.StatusOK, body)
}

// handleRemoveEntityRejection releases a rejected name so a future analysis may
// extract it again.
func (s *Server) handleRemoveEntityRejection(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	}
	editID := s.prepareEntityEdit(r, "unreject", kind+" "+name, kind, name)
	err := s.deps.Store.RemoveEntityRejection(r.Context(), kind, name)
	if err != nil && editID != "" {
		_ = s.deps.Store.DiscardEntityEdit(r.Context(), editID)
	}
	if errors.Is(err, store.ErrInvalidEntity) {
		writeError(w, http.StatusBadRequest, "invalid_name", "nome invalido")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	body := map[string]any{"status": "ok"}
	if editID != "" {
		body["edit_id"] = editID
	}
	writeJSON(w, http.StatusOK, body)
}

// prepareEntityEdit snapshots what a mutation is about to change. A snapshot
// failure is logged and does not block the write: the edit only loses undo.
func (s *Server) prepareEntityEdit(r *http.Request, action, label, kind string, names ...string) string {
	id, err := s.deps.Store.PrepareEntityEdit(r.Context(), action, label, kind, names...)
	if err != nil {
		s.deps.Logger.Error("entidade: guardar desfazer", "erro", err)
		return ""
	}
	return id
}

// prepareEntityEditPairs is prepareEntityEdit for a mutation that touches more
// than one kind (a kind change snapshots the source and the merge target).
func (s *Server) prepareEntityEditPairs(r *http.Request, action, label string, pairs ...store.EntityPair) string {
	id, err := s.deps.Store.PrepareEntityEditPairs(r.Context(), action, label, pairs...)
	if err != nil {
		s.deps.Logger.Error("entidade: guardar desfazer", "erro", err)
		return ""
	}
	return id
}

// handleUndoEntityEdit restores the state captured before the latest entity
// edit (rename, merge, icon or "sou eu").
func (s *Server) handleUndoEntityEdit(w http.ResponseWriter, r *http.Request) {
	edit, err := s.deps.Store.UndoEntityEdit(r.Context(), r.PathValue("id"))
	switch {
	case errors.Is(err, store.ErrEntityEditNotFound):
		writeError(w, http.StatusNotFound, "not_found", "edicao inexistente")
		return
	case errors.Is(err, store.ErrEditNotLatest):
		writeError(w, http.StatusConflict, "edit_not_latest", "ha uma edicao mais nova")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"action": edit.Action,
		"label":  edit.Label,
	})
}

func (s *Server) handleMood(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	from := parseDateParam(query.Get("from"), false)
	to := parseDateParam(query.Get("to"), true)
	points, err := s.deps.Store.MoodSeriesExcludingBooks(r.Context(), from, to,
		truthy(query.Get("exclude_books")))
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
