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

// validBookPage accepts the zero value as "use the safe default" and rejects a
// page outside the contract. The ranges are wide enough for a real book page
// and narrow enough to keep a typo from breaking the sheet.
func validBookPage(size string, margin, body, leading int) bool {
	if trimmed := strings.TrimSpace(size); trimmed != "" && !store.ValidPageSize(trimmed) {
		return false
	}
	if margin != 0 && (margin < 10 || margin > 60) {
		return false
	}
	if body != 0 && (body < 12 || body > 26) {
		return false
	}
	if leading != 0 && (leading < 100 || leading > 220) {
		return false
	}
	return true
}

// validBookFont accepts an empty value (use the default) or a self-hosted book
// face. The list is the same used by the editor and the PDF.
func validBookFont(raw string) bool {
	value := strings.TrimSpace(raw)
	return value == "" || store.ValidBookFont(value)
}

// validDeadline accepts an empty date (no deadline) or a calendar day.
func validDeadline(raw string) bool {
	value := strings.TrimSpace(raw)
	if value == "" {
		return true
	}
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func notebookJSON(n store.Notebook) map[string]any {
	body := map[string]any{
		"id":               n.ID,
		"name":             n.Name,
		"color":            n.Color,
		"is_default":       n.IsDefault,
		"kind":             n.Kind,
		"subtitle":         n.Subtitle,
		"author":           n.Author,
		"synopsis":         n.Synopsis,
		"language":         n.Language,
		"goal_words":       n.GoalWords,
		"book_status":      n.BookStatus,
		"page_size":        n.PageSize,
		"page_margin_mm":   n.PageMarginMM,
		"body_px":          n.BodyPX,
		"body_leading":     n.BodyLeading,
		"body_font":        n.BodyFont,
		"daily_goal_words": n.DailyGoalWords,
		"deadline":         n.Deadline,
		"has_cover":        n.HasCover,
		"cover_updated_at": n.CoverUpdatedAt,
		"entry_count":      n.EntryCount,
		"chapter_count":    n.ChapterCount,
		"created_at":       n.CreatedAt,
		"updated_at":       n.UpdatedAt,
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
	includeWords := truthy(r.URL.Query().Get("include_words"))
	if includeWords {
		counts, err := s.deps.Store.BookWordCounts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		for i := range notebooks {
			if notebooks[i].IsBook() {
				notebooks[i].Words = counts[notebooks[i].ID]
			}
		}
	}
	out := make([]map[string]any, 0, len(notebooks))
	for _, n := range notebooks {
		item := notebookJSON(n)
		if includeWords && n.IsBook() {
			item["words"] = n.Words
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"notebooks": out})
}

type notebookRequest struct {
	// ID opcional: o app cria cadernos offline e quer manter o mesmo id nos dois
	// lados. Sem ele, o servidor gera um.
	ID         string `json:"id"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Kind       string `json:"kind"`
	Subtitle   string `json:"subtitle"`
	Author     string `json:"author"`
	Synopsis   string `json:"synopsis"`
	Language   string `json:"language"`
	GoalWords  int    `json:"goal_words"`
	BookStatus string `json:"book_status"`
	// Pagina e ritmo do livro. Vazio segue o padrao seguro do modo escritor.
	PageSize       string `json:"page_size"`
	PageMarginMM   int    `json:"page_margin_mm"`
	BodyPX         int    `json:"body_px"`
	BodyLeading    int    `json:"body_leading"`
	BodyFont       string `json:"body_font"`
	DailyGoalWords int    `json:"daily_goal_words"`
	Deadline       string `json:"deadline"`
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
	kind := strings.TrimSpace(req.Kind)
	if kind == "" {
		kind = store.NotebookKindNotes
	}
	if !store.ValidNotebookKind(kind) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_kind", "kind deve ser notes ou book")
		return
	}
	bookStatus := strings.TrimSpace(req.BookStatus)
	if bookStatus == "" {
		bookStatus = store.BookDrafting
	}
	if !store.ValidBookStatus(bookStatus) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_book_status", "book_status invalido")
		return
	}
	if req.GoalWords < 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_goal", "meta invalida")
		return
	}
	if !validBookPage(req.PageSize, req.PageMarginMM, req.BodyPX, req.BodyLeading) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_page", "pagina invalida")
		return
	}
	if !validBookFont(req.BodyFont) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_font", "fonte invalida")
		return
	}
	if req.DailyGoalWords < 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_goal", "meta diaria invalida")
		return
	}
	if !validDeadline(req.Deadline) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_deadline", "prazo invalido")
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
		ID:             notebookID,
		Name:           name,
		Color:          strings.TrimSpace(req.Color),
		Kind:           kind,
		Subtitle:       strings.TrimSpace(req.Subtitle),
		Author:         strings.TrimSpace(req.Author),
		Synopsis:       strings.TrimSpace(req.Synopsis),
		Language:       strings.TrimSpace(req.Language),
		GoalWords:      req.GoalWords,
		BookStatus:     bookStatus,
		PageSize:       strings.TrimSpace(req.PageSize),
		PageMarginMM:   req.PageMarginMM,
		BodyPX:         req.BodyPX,
		BodyLeading:    req.BodyLeading,
		BodyFont:       strings.TrimSpace(req.BodyFont),
		DailyGoalWords: req.DailyGoalWords,
		Deadline:       strings.TrimSpace(req.Deadline),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.deps.Store.CreateNotebook(r.Context(), notebook); err != nil {
		if errors.Is(err, store.ErrNotebookExists) {
			writeError(w, http.StatusConflict, "conflict", "caderno ja existe")
			return
		}
		if errors.Is(err, store.ErrProtected) {
			writeError(w, http.StatusConflict, "protected", "caderno padrao protegido")
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
		Name           *string `json:"name"`
		Color          *string `json:"color"`
		Kind           *string `json:"kind"`
		Subtitle       *string `json:"subtitle"`
		Author         *string `json:"author"`
		Synopsis       *string `json:"synopsis"`
		Language       *string `json:"language"`
		GoalWords      *int    `json:"goal_words"`
		BookStatus     *string `json:"book_status"`
		PageSize       *string `json:"page_size"`
		PageMarginMM   *int    `json:"page_margin_mm"`
		BodyPX         *int    `json:"body_px"`
		BodyLeading    *int    `json:"body_leading"`
		BodyFont       *string `json:"body_font"`
		DailyGoalWords *int    `json:"daily_goal_words"`
		Deadline       *string `json:"deadline"`
		ConfirmConvert bool    `json:"confirm_convert"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	hasMeta := req.Subtitle != nil || req.Author != nil || req.Synopsis != nil ||
		req.Language != nil || req.GoalWords != nil || req.BookStatus != nil ||
		req.PageSize != nil || req.PageMarginMM != nil || req.BodyPX != nil ||
		req.BodyLeading != nil || req.BodyFont != nil || req.DailyGoalWords != nil ||
		req.Deadline != nil
	if req.Name == nil && req.Color == nil && req.Kind == nil && !hasMeta {
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
	if req.Kind != nil && !store.ValidNotebookKind(strings.TrimSpace(*req.Kind)) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_kind", "kind deve ser notes ou book")
		return
	}
	if req.BookStatus != nil && !store.ValidBookStatus(strings.TrimSpace(*req.BookStatus)) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_book_status", "book_status invalido")
		return
	}
	if req.GoalWords != nil && *req.GoalWords < 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_goal", "meta invalida")
		return
	}
	if req.PageSize != nil && !store.ValidPageSize(*req.PageSize) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_page", "tamanho de pagina invalido")
		return
	}
	if req.PageMarginMM != nil && (*req.PageMarginMM < 10 || *req.PageMarginMM > 60) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_page", "margem invalida")
		return
	}
	if req.BodyPX != nil && (*req.BodyPX < 12 || *req.BodyPX > 26) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_page", "corpo invalido")
		return
	}
	if req.BodyLeading != nil && (*req.BodyLeading < 100 || *req.BodyLeading > 220) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_page", "entrelinha invalida")
		return
	}
	if req.BodyFont != nil && !validBookFont(*req.BodyFont) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_font", "fonte invalida")
		return
	}
	if req.DailyGoalWords != nil && *req.DailyGoalWords < 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_goal", "meta diaria invalida")
		return
	}
	if req.Deadline != nil && !validDeadline(*req.Deadline) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_deadline", "prazo invalido")
		return
	}

	ctx := r.Context()
	notebookID := r.PathValue("id")
	notebook, err := s.deps.Store.GetNotebook(ctx, notebookID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "caderno inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if req.Name != nil || req.Color != nil {
		notebook, err = s.deps.Store.UpdateNotebook(ctx, notebookID, req.Name, req.Color)
		if err != nil {
			writeNotebookError(w, err)
			return
		}
	}
	if req.Kind != nil {
		notebook, err = s.deps.Store.SetNotebookKind(ctx, notebookID,
			strings.TrimSpace(*req.Kind), req.ConfirmConvert)
		if err != nil {
			writeNotebookError(w, err)
			return
		}
	}
	if hasMeta {
		if !notebook.IsBook() {
			writeError(w, http.StatusUnprocessableEntity, "not_a_book", "caderno nao e um livro")
			return
		}
		meta := store.BookMeta{
			Subtitle:       notebook.Subtitle,
			Author:         notebook.Author,
			Synopsis:       notebook.Synopsis,
			Language:       notebook.Language,
			GoalWords:      notebook.GoalWords,
			BookStatus:     notebook.BookStatus,
			PageSize:       notebook.PageSize,
			PageMarginMM:   notebook.PageMarginMM,
			BodyPX:         notebook.BodyPX,
			BodyLeading:    notebook.BodyLeading,
			BodyFont:       notebook.BodyFont,
			DailyGoalWords: notebook.DailyGoalWords,
			Deadline:       notebook.Deadline,
		}
		if req.Subtitle != nil {
			meta.Subtitle = *req.Subtitle
		}
		if req.Author != nil {
			meta.Author = *req.Author
		}
		if req.Synopsis != nil {
			meta.Synopsis = *req.Synopsis
		}
		if req.Language != nil {
			meta.Language = *req.Language
		}
		if req.GoalWords != nil {
			meta.GoalWords = *req.GoalWords
		}
		if req.BookStatus != nil {
			meta.BookStatus = *req.BookStatus
		}
		if req.PageSize != nil {
			meta.PageSize = strings.TrimSpace(*req.PageSize)
		}
		if req.PageMarginMM != nil {
			meta.PageMarginMM = *req.PageMarginMM
		}
		if req.BodyPX != nil {
			meta.BodyPX = *req.BodyPX
		}
		if req.BodyLeading != nil {
			meta.BodyLeading = *req.BodyLeading
		}
		if req.BodyFont != nil {
			meta.BodyFont = strings.TrimSpace(*req.BodyFont)
		}
		if req.DailyGoalWords != nil {
			meta.DailyGoalWords = *req.DailyGoalWords
		}
		if req.Deadline != nil {
			meta.Deadline = strings.TrimSpace(*req.Deadline)
		}
		notebook, err = s.deps.Store.UpdateBookMeta(ctx, notebookID, meta)
		if err != nil {
			writeNotebookError(w, err)
			return
		}
	}
	s.deps.Events.Publish("notebook.changed", map[string]string{"notebook_id": notebook.ID})
	writeJSON(w, http.StatusOK, notebookJSON(notebook))
}

// writeNotebookError maps the store errors of notebook changes to the contract.
func writeNotebookError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "caderno inexistente")
	case errors.Is(err, store.ErrProtected):
		writeError(w, http.StatusConflict, "protected", "caderno padrao protegido")
	case errors.Is(err, store.ErrNotebookExists):
		writeError(w, http.StatusConflict, "conflict", "caderno ja existe")
	case errors.Is(err, store.ErrNotABook):
		writeError(w, http.StatusUnprocessableEntity, "not_a_book", "caderno nao e um livro")
	case errors.Is(err, store.ErrInvalidChapter):
		writeError(w, http.StatusUnprocessableEntity, "invalid_chapter", "capitulo invalido")
	case errors.Is(err, store.ErrNotebookNotEmpty):
		var count *store.NotebookCountError
		entries := 0
		if errors.As(err, &count) {
			entries = count.Count
		}
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":       map[string]string{"code": "notebook_not_empty", "message": "caderno tem notas"},
			"entry_count": entries,
		})
	case errors.Is(err, store.ErrBookHasChapters):
		var count *store.NotebookCountError
		chapters := 0
		if errors.As(err, &count) {
			chapters = count.Count
		}
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":         map[string]string{"code": "book_has_chapters", "message": "livro tem capitulos"},
			"chapter_count": chapters,
		})
	default:
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
	}
}

func (s *Server) handleDeleteNotebook(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")
	notebook, err := s.deps.Store.GetNotebook(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "caderno inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if notebook.IsBook() {
		if r.URL.Query().Get("mode") != "trash" {
			writeError(w, http.StatusConflict, "confirm_required", "confirme o titulo do livro")
			return
		}
		err = s.deps.Store.DeleteBook(ctx, id, r.URL.Query().Get("confirm"))
		if errors.Is(err, store.ErrConfirmRequired) {
			writeError(w, http.StatusConflict, "confirm_required", "confirme o titulo do livro")
			return
		}
	} else {
		err = s.deps.Store.DeleteNotebook(ctx, id)
	}
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
