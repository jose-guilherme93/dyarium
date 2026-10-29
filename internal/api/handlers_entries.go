package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/entrytitle"
	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/preview"
	"github.com/joseti/dyarium/internal/review"
	"github.com/joseti/dyarium/internal/store"
)

// entryTagNames returns the tag names attached to an entry.
func (s *Server) entryTagNames(ctx context.Context, entryID string) ([]string, error) {
	tags, err := s.deps.Store.ListEntryTags(ctx, entryID)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(tags))
	for _, tag := range tags {
		names = append(names, tag.Name)
	}
	return names, nil
}

func entryJSON(e store.Entry) map[string]any {
	body := map[string]any{
		"id":                e.ID,
		"title":             e.Title,
		"status":            e.Status,
		"source":            e.Source,
		"parent_id":         e.ParentID,
		"notebook_id":       e.NotebookID,
		"original_filename": e.OriginalFilename,
		"content_type":      e.ContentType,
		"size_bytes":        e.SizeBytes,
		"duration_seconds":  e.DurationSeconds,
		"sha256":            e.SHA256,
		"recorded_at":       e.RecordedAt,
		"created_at":        e.CreatedAt,
		"updated_at":        e.UpdatedAt,
		"archived":          e.Archived,
		// Papel escolhido para a nota (self/other/mixed). Vazio segue o padrao
		// do app (owner_name/all_notes_mine), que o cliente tambem recebe.
		"author": e.Author,
		// Versao de cada campo editavel, para o cliente mandar de volta na
		// gravacao e o servidor recusar o que ja mudou em outro lugar.
		"versions": entryVersions(e),
		// Quando a analise mais nova foi gravada. Vazio quando nao ha analise.
		// O app usa como sinal de atualizacao: busca uma vez e guarda.
		"analysis_at": e.AnalysisAt,
		// O mesmo para a transcricao: uma revisao feita no servidor tem hora
		// propria e o app so busca quando ela muda.
		"transcript_at": e.TranscriptAt,
	}
	if e.DeletedAt != nil {
		body["deleted_at"] = e.DeletedAt
	}
	if e.PrimaryAttachmentID != "" {
		body["primary_attachment_id"] = e.PrimaryAttachmentID
	}
	return body
}

// entryVersions sao as versoes dos campos editaveis, no formato exato que o
// cliente manda de volta. Vazio quando a leitura nao as trouxe.
func entryVersions(e store.Entry) map[string]string {
	out := map[string]string{}
	if e.TitleUpdatedAt != "" {
		out[store.FieldTitle] = e.TitleUpdatedAt
	}
	if e.RecordedAtVersion != "" {
		out[store.FieldRecordedAt] = e.RecordedAtVersion
	}
	if e.BodyVersion != "" {
		out[store.FieldBody] = e.BodyVersion
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

/**
 * Filtro de arquivadas: `archived=1` so as arquivadas, `archived=0` (padrao) so
 * as que estao na lista de trabalho. Ausente traz as duas, para nenhum cliente
 * perder nota por omissao.
 */
func archiveFilter(query url.Values) *bool {
	switch strings.TrimSpace(query.Get("archived")) {
	case "1", "true":
		return boolPtr(true)
	case "0", "false":
		return boolPtr(false)
	default:
		return nil
	}
}

func boolPtr(value bool) *bool {
	return &value
}

func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	// O app usa um `limit` alto para reconciliar exclusoes (saber o conjunto
	// completo de ids vivos). Teto para nao virar um dump.
	limit := 100
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 5000 {
		limit = 5000
	}
	// Paginacao por deslocamento. A resposta traz `next_cursor` enquanto houver
	// outra pagina, para o app nao parar em 2000 notas sem aviso.
	cursor := 0
	if raw := strings.TrimSpace(query.Get("cursor")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cursor = n
		}
	}
	pageJSON := func(out []map[string]any, count int) map[string]any {
		body := map[string]any{"entries": out}
		if count == limit {
			body["next_cursor"] = strconv.Itoa(cursor + count)
		}
		return body
	}
	// `deleted=1` lista as lixeiras (tombstones): o app so apaga uma nota local
	// quando o servidor confirma que ela foi apagada.
	if truthy(query.Get("deleted")) {
		entries, err := s.deps.Store.ListDeletedEntries(r.Context(), limit, cursor)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		out := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			out = append(out, entryJSON(e))
		}
		writeJSON(w, http.StatusOK, pageJSON(out, len(entries)))
		return
	}
	notebookID := strings.TrimSpace(query.Get("notebook_id"))
	if notebookID != "" {
		if err := s.deps.Store.NotebookExists(r.Context(), notebookID); err != nil {
			if errors.Is(err, store.ErrNotebookNotFound) {
				writeError(w, http.StatusNotFound, "notebook_not_found", "caderno inexistente")
				return
			}
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	entries, err := s.deps.Store.ListEntriesFilteredNotebook(r.Context(), limit, cursor,
		query.Get("person"), query.Get("place"), query.Get("theme"), archiveFilter(query), notebookID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	ids := make([]string, 0, len(entries))
	for _, e := range entries {
		ids = append(ids, e.ID)
	}
	tagNames, err := s.deps.Store.ListEntryTagNames(r.Context(), ids)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// A previa pode vir da transcricao: grafias antigas de uma entidade
	// mesclada aparecem com o nome atual, como no painel da transcricao.
	aliasPairs, _ := s.deps.Store.EntityAliasPairs(r.Context())
	body := pageJSON(entriesJSON(entries, tagNames, aliasPairs), len(entries))
	writeJSON(w, http.StatusOK, body)
}

// entriesJSON converte as entradas e anexa os nomes das tags num lugar so.
func entriesJSON(entries []store.Entry, tagNames map[string][]string, aliasPairs []store.EntityNamePair) []map[string]any {
	out := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		item := entryJSON(e)
		if names := tagNames[e.ID]; len(names) > 0 {
			item["tags"] = names
		}
		// A lista mostra duas linhas do corpo (ou da transcricao). O texto chega
		// em markdown cru do banco e vira prosa aqui, para a interface nao exibir
		// `![...]` nem `#`.
		text := preview.Short(e.Preview, preview.DefaultLimit)
		if text == "" {
			// Corpo so com marcador de audio/imagem nao tem prosa: a previa e a
			// transcricao, que e o que a pessoa le naquela nota.
			text = preview.Short(e.SpokenPreview, preview.DefaultLimit)
			if text != "" {
				text = canonicalizeAnalysisText(text, aliasPairs)
			}
		}
		if text != "" {
			item["preview"] = text
		}
		out = append(out, item)
	}
	return out
}

// truthy accepts the query-param spellings a client may use for a boolean.
func truthy(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// handleCreateEntry creates a written note (no audio). The body is stored as a
// note document, like the written part of an audio note. When parent_id is
// given, the note is created as a child of that note (subnote).
func (s *Server) handleCreateEntry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID         string `json:"id"`
		Title      string `json:"title"`
		ParentID   string `json:"parent_id"`
		NotebookID string `json:"notebook_id"`
		CreatedAt  string `json:"created_at"`
		// RecordedAt is the date of the event, when it differs from the creation
		// time (offline note, imported entry). Without it the app had to PATCH
		// the date right after creating the note.
		RecordedAt string `json:"recorded_at"`
		// Author is the explicit role of the note (self/other/mixed). Empty
		// means "follow the app default".
		Author string `json:"author"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	author := strings.TrimSpace(req.Author)
	if !store.ValidAuthor(author) {
		writeError(w, http.StatusBadRequest, "invalid_author", "author deve ser self, other, mixed ou vazio")
		return
	}
	notebookID := strings.TrimSpace(req.NotebookID)
	if notebookID == "" {
		notebookID = store.DefaultNotebookID
	}
	if err := s.deps.Store.NotebookExists(r.Context(), notebookID); err != nil {
		if errors.Is(err, store.ErrNotebookNotFound) {
			writeError(w, http.StatusUnprocessableEntity, "invalid_notebook", "caderno inexistente")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	parentID := strings.TrimSpace(req.ParentID)
	if parentID != "" {
		if _, err := s.deps.Store.GetEntry(r.Context(), parentID); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "invalid_parent", "nota pai inexistente")
			return
		}
	}
	now := time.Now().UTC()
	// O cliente pode informar quando a nota foi criada (offline); senao vale agora.
	createdAt := now
	if raw := strings.TrimSpace(req.CreatedAt); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_created_at", "created_at invalido")
			return
		}
		createdAt = parsed.UTC()
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = entrytitle.Name(entrytitle.Text)
	}
	var recordedAt *time.Time
	if raw := strings.TrimSpace(req.RecordedAt); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_recorded_at", "recorded_at invalido")
			return
		}
		t := parsed.UTC()
		recordedAt = &t
	}
	entry := store.Entry{
		ID:         id.New(),
		Title:      title,
		Status:     store.EntryReady,
		Source:     "text",
		ParentID:   parentID,
		NotebookID: notebookID,
		RecordedAt: recordedAt,
		CreatedAt:  createdAt,
		UpdatedAt:  now,
		Author:     author,
	}
	if clientID := strings.TrimSpace(req.ID); clientID != "" {
		if !id.Valid(clientID) {
			writeError(w, http.StatusBadRequest, "invalid_id", "id invalido")
			return
		}
		// Idempotente: um cliente offline pode reenviar a mesma nota.
		existing, err := s.deps.Store.GetEntry(r.Context(), clientID)
		if err == nil {
			writeJSON(w, http.StatusOK, entryJSON(existing))
			return
		}
		if !errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		// A nota pode existir apagada (lixeira) — por exemplo, o app restaurou um
		// backup depois de apagar a nota. Nesse caso ela volta a viver, em vez de
		// falhar com conflito de id.
		if err := s.deps.Store.RestoreEntry(r.Context(), clientID); err == nil {
			current, getErr := s.deps.Store.GetEntry(r.Context(), clientID)
			if getErr == nil {
				writeJSON(w, http.StatusOK, entryJSON(current))
				return
			}
		} else if !errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		entry.ID = clientID
	}
	if err := s.deps.Store.CreateEntry(r.Context(), entry); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entryJSON(entry))
}

func (s *Server) handleGetEntry(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	entry, err := s.deps.Store.GetEntry(ctx, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	body := entryJSON(entry)
	if names, err := s.entryTagNames(ctx, entry.ID); err == nil {
		body["tags"] = names
	}
	if audios, err := s.deps.Store.ListAudios(ctx, entry.ID); err == nil {
		body["audios"] = s.audiosJSON(ctx, entry.ID, audios)
	}
	if m, ok, err := s.deps.Store.GetMetrics(ctx, entry.ID); err == nil && ok {
		body["metrics"] = map[string]any{
			"duration_ms":         m.DurationMS,
			"loudness_lufs":       m.LoudnessLUFS,
			"true_peak":           m.TruePeak,
			"silence_count":       m.SilenceCount,
			"silence_total_ms":    m.SilenceTotalMS,
			"sample_rate":         m.SampleRate,
			"channels":            m.Channels,
			"whisper_peak_rss_mb": m.WhisperPeakRSSMB,
		}
	}
	writeJSON(w, http.StatusOK, body)
}

type patchEntryRequest struct {
	Title      *string `json:"title"`
	RecordedAt *string `json:"recorded_at"`
	// NotebookID move a nota entre cadernos. E um ponteiro, nao texto: a ultima
	// gravacao vence, sem conflito.
	NotebookID *string `json:"notebook_id"`
	// Archived tira a nota da lista de trabalho sem apagar. E um interruptor, nao
	// texto: nao tem versao nem conflito.
	Archived *bool `json:"archived"`
	// Author troca o papel da nota (self/other/mixed). Vazio volta ao padrao do
	// app. Como os outros interruptores, a ultima gravacao vence.
	Author *string `json:"author"`
	// Versions are the versions of title/recorded_at the client last read.
	// Fields whose version moved on are not written; they come back as a
	// conflict so the user decides instead of the last write winning blindly.
	Versions struct {
		Title      string `json:"title"`
		RecordedAt string `json:"recorded_at"`
	} `json:"versions"`
}

func (s *Server) handlePatchEntry(w http.ResponseWriter, r *http.Request) {
	var req patchEntryRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	id := r.PathValue("id")

	var recordedAt *time.Time
	if req.RecordedAt != nil {
		if parsed, err := time.Parse(time.RFC3339, *req.RecordedAt); err == nil {
			t := parsed.UTC()
			recordedAt = &t
		}
	}
	if req.Title == nil && recordedAt == nil && req.NotebookID == nil && req.Archived == nil && req.Author == nil {
		writeError(w, http.StatusBadRequest, "empty_patch", "nada para atualizar")
		return
	}
	if req.Author != nil && !store.ValidAuthor(strings.TrimSpace(*req.Author)) {
		writeError(w, http.StatusBadRequest, "invalid_author", "author deve ser self, other, mixed ou vazio")
		return
	}
	if req.NotebookID != nil && strings.TrimSpace(*req.NotebookID) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_notebook", "caderno obrigatorio")
		return
	}
	versions, conflict, err := s.deps.Store.UpdateEntryFields(r.Context(), id, req.Title, recordedAt,
		req.NotebookID, req.Archived, req.Author, req.Versions.Title, req.Versions.RecordedAt)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	if errors.Is(err, store.ErrInvalidAuthor) {
		writeError(w, http.StatusBadRequest, "invalid_author", "author deve ser self, other, mixed ou vazio")
		return
	}
	if errors.Is(err, store.ErrNotebookNotFound) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_notebook", "caderno inexistente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if len(conflict) > 0 {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":    map[string]string{"code": "conflict", "message": "a nota mudou no outro lugar"},
			"conflict": conflict,
			"versions": versions,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "versions": versions})
}

func (s *Server) handleDeleteEntry(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")
	if err := s.deps.Store.SoftDeleteEntry(ctx, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// The removal is logical; the cleanup job deletes the encrypted objects and
	// the row afterwards. It is scheduled after the retention window, so a note
	// deleted by mistake (or restored from a local backup) can still be brought
	// back with its audio intact. A failure here only delays the cleanup, so it
	// is logged instead of failing the request.
	retention := s.deps.Config.DeletedRetention
	if _, err := s.deps.Queue.EnqueueAfter(ctx, jobs.TypeCleanup, "cleanup:"+id,
		jobs.CleanupPayload{EntryID: id}, retention); err != nil {
		s.deps.Logger.Error("api: enfileirar limpeza", "entry_id", id, "erro", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRestoreEntry brings a soft-deleted entry back. The app calls it when a
// restored backup contains notes the server still has in the trash, so the next
// pull does not delete them again.
func (s *Server) handleRestoreEntry(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")
	if err := s.deps.Store.RestoreEntry(ctx, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	entry, err := s.deps.Store.GetEntry(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": id, "status": entry.Status})
	writeJSON(w, http.StatusOK, entryJSON(entry))
}

func (s *Server) handleGetTranscript(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	t, segs, err := s.deps.Store.GetTranscript(ctx, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "transcricao indisponivel")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// A leitura resolve grafias antigas para a entidade sobrevivente; o texto
	// gravado (e o audio) continua exatamente como foi transcrito.
	aliasPairs, _ := s.deps.Store.EntityAliasPairs(ctx)
	body := transcriptJSON(t, segs)
	canonicalizeTranscriptBody(body, aliasPairs)
	writeJSON(w, http.StatusOK, body)
}

type putTranscriptRequest struct {
	AttachmentID string `json:"attachment_id"`
	Language     string `json:"language"`
	Text         string `json:"text"`
	Segments     []struct {
		StartMS int64  `json:"start_ms"`
		EndMS   int64  `json:"end_ms"`
		Text    string `json:"text"`
		// Edited marks a segment the user rewrote by hand. The revision never
		// touches it, and a new sync keeps the flag.
		Edited bool `json:"edited"`
	} `json:"segments"`
}

// handlePutTranscript stores a transcript produced on the device (transcricao
// local). Assim o servidor nao transcreve de novo e o dashboard mostra o texto.
func (s *Server) handlePutTranscript(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	entryID := r.PathValue("id")
	if _, err := s.deps.Store.GetEntry(ctx, entryID); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	var req putTranscriptRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "texto vazio")
		return
	}
	attachmentID := strings.TrimSpace(req.AttachmentID)
	if attachmentID == "" {
		// Cliente antigo/atipico nao mandou o audio. Quando a entrada tem um
		// unico audio, a transcricao e claramente dele: associa em vez de deixar
		// o texto solto (que sumia da pilha no dashboard).
		if audios, err := s.deps.Store.ListAudios(ctx, entryID); err == nil && len(audios) == 1 {
			attachmentID = audios[0].ID
		}
	}
	if attachmentID != "" {
		att, err := s.deps.Store.GetAttachment(ctx, attachmentID)
		if err != nil || att.EntryID != entryID {
			writeError(w, http.StatusBadRequest, "invalid_attachment", "anexo invalido")
			return
		}
	}

	now := time.Now().UTC()
	segments := make([]store.Segment, 0, len(req.Segments))
	for _, seg := range req.Segments {
		segments = append(segments, store.Segment{
			ID:         id.New(),
			StartMS:    seg.StartMS,
			EndMS:      seg.EndMS,
			Text:       seg.Text,
			UserEdited: seg.Edited,
			CreatedAt:  now,
		})
	}
	transcript := store.Transcript{
		ID:           id.New(),
		EntryID:      entryID,
		AttachmentID: attachmentID,
		Model:        "local",
		Language:     strings.TrimSpace(req.Language),
		Text:         text,
		CreatedAt:    now,
	}
	if err := s.deps.Store.SaveTranscript(ctx, transcript, segments); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// O app reenvia a transcricao ao abrir a nota. Rebaixar uma nota ja
	// analisada para "transcrito" escondia o resultado pronto no painel.
	status := store.EntryTranscribed
	if entry, err := s.deps.Store.GetEntry(ctx, entryID); err == nil && entry.Status == store.EntryReady {
		status = store.EntryReady
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, entryID, status)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": entryID, "status": status})
	s.deps.Events.Publish("transcript.ready", map[string]string{"entry_id": entryID})
	writeJSON(w, http.StatusOK, map[string]string{"model": "local"})
}

type putRevisionsRequest struct {
	AttachmentID  string `json:"attachment_id"`
	Model         string `json:"model"`
	PromptVersion int    `json:"prompt_version"`
	Literal       bool   `json:"literal"`
	Comprehension int    `json:"comprehension"`
	// Rejected is how many segments the device could not review (the model
	// answered in an unusable shape or the guardrails refused it). It travels
	// with the revision so the panel can tell "nothing to fix" from "not
	// applied".
	Rejected int `json:"rejected"`
	// ReviewedThrough is the index of the first segment this pass did not reach
	// yet. Windows are reviewed in order, so everything below it was reviewed —
	// even the segments that came back unchanged — and everything from it on
	// stays raw. Zero means "the whole transcript was reviewed".
	ReviewedThrough *int `json:"reviewed_through"`
	Segments        []struct {
		Idx  int    `json:"idx"`
		Text string `json:"text"`
	} `json:"segments"`
}

// maxRevisionRunes caps one revised segment. A model answer longer than this is
// clearly not a correction of the original line.
const maxRevisionRunes = 4000

// handlePutTranscriptRevisions stores the revision produced on the device. The
// server validates every line with the same guardrails as its own pass, so a
// client cannot push a rewritten transcript. User-edited segments are skipped:
// the user's writing always wins.
func (s *Server) handlePutTranscriptRevisions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	entryID := r.PathValue("id")
	if _, err := s.deps.Store.GetEntry(ctx, entryID); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	var req putRevisionsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if req.PromptVersion <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_body", "prompt_version invalido")
		return
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "modelo vazio")
		return
	}
	var transcript store.Transcript
	var err error
	if attachmentID := strings.TrimSpace(req.AttachmentID); attachmentID != "" {
		transcript, err = s.deps.Store.TranscriptByAttachment(ctx, attachmentID)
		if err == nil && transcript.EntryID != entryID {
			err = sql.ErrNoRows
		}
	} else {
		transcript, err = s.deps.Store.LatestTranscript(ctx, entryID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "transcricao indisponivel")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	segments, err := s.deps.Store.ListSegments(ctx, transcript.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	byIndex := make(map[int]store.Segment, len(segments))
	for _, seg := range segments {
		byIndex[seg.Idx] = seg
	}
	through := len(segments)
	if req.ReviewedThrough != nil {
		through = *req.ReviewedThrough
	}
	if through < 0 {
		through = 0
	}
	if through > len(segments) {
		through = len(segments)
	}
	now := time.Now().UTC()
	revs := make([]store.TranscriptRevision, 0, len(req.Segments))
	changed, refused := 0, 0
	for _, item := range req.Segments {
		seg, ok := byIndex[item.Idx]
		if !ok || seg.UserEdited || seg.Idx >= through {
			continue
		}
		text := strings.TrimSpace(item.Text)
		if text == "" {
			text = seg.Text
		}
		if len([]rune(text)) > maxRevisionRunes {
			refused++
			continue
		}
		if text != seg.Text {
			if ok, _ := review.Accept(seg.Text, text); !ok {
				refused++
				continue
			}
			changed++
		}
		// Uma linha por trecho alcancado, mesmo sem mudanca: a linha e o que
		// marca "revisado", e sem ela o painel nao distingue "nao mudou nada"
		// de "nao chegou a revisar".
		revs = append(revs, store.TranscriptRevision{
			SegmentID:     seg.ID,
			Text:          text,
			Model:         model,
			PromptVersion: req.PromptVersion,
			Literal:       req.Literal,
			CreatedAt:     now,
		})
	}
	comprehension := req.Comprehension
	if comprehension < 0 || comprehension > 100 {
		comprehension = -1
	}
	rejected := req.Rejected
	if rejected < 0 {
		rejected = 0
	}
	rejected += refused
	if err := s.deps.Store.SaveRevisions(ctx, transcript.ID, revs, comprehension, rejected, through, model, req.PromptVersion, req.Literal); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revised_segments": changed, "rejected": rejected})
}

// transcriptJSON renders a transcript with its segments.
func transcriptJSON(t store.Transcript, segs []store.Segment) map[string]any {
	body := transcriptSummaryJSON(t)
	segments := make([]map[string]any, 0, len(segs))
	for _, seg := range segs {
		item := map[string]any{
			"idx":      seg.Idx,
			"start_ms": seg.StartMS,
			"end_ms":   seg.EndMS,
			"text":     seg.Text,
			"edited":   seg.UserEdited,
			// reviewed diz que a passada chegou neste trecho (mesmo quando nao
			// mudou nada). Sem isso o app nao distingue trecho recusado de
			// trecho que a passada ainda nao alcancou.
			"reviewed": seg.Revised != "",
		}
		// revised so aparece quando difere do original: o painel marca so o
		// trecho que a IA mudou de verdade.
		if seg.Revised != "" && seg.Revised != seg.Text {
			item["revised"] = seg.Revised
		}
		segments = append(segments, item)
	}
	body["segments"] = segments
	changed := 0
	for _, seg := range segs {
		if seg.Revised != "" && seg.Revised != seg.Text && !seg.UserEdited {
			changed++
		}
	}
	// changed distingue "revisou e alterou" de "revisou e nao mudou nada";
	// revised_rejected e revised_pending distinguem os dois de "nao chegou a
	// revisar". Pending conta so o que a passada nao alcancou: um trecho
	// recusado foi alcancado e aparece em revised_rejected, nao aqui.
	body["revised_changed"] = changed
	pending := 0
	for _, seg := range segs {
		if seg.UserEdited || seg.Idx < t.RevisedThrough {
			continue
		}
		pending++
	}
	body["revised_pending"] = pending
	return body
}

// canonicalizeTranscriptSummary aplica os aliases de entidade ao texto visivel
// da transcricao. O banco guarda a fala crua; so a resposta da API muda.
func canonicalizeTranscriptSummary(body map[string]any, pairs []store.EntityNamePair) {
	if len(pairs) == 0 {
		return
	}
	if text, ok := body["text"].(string); ok {
		body["text"] = canonicalizeAnalysisText(text, pairs)
	}
}

// canonicalizeTranscriptBody also touches the segments: the panel shows the
// original and the revised line, and both should resolve a merged spelling.
func canonicalizeTranscriptBody(body map[string]any, pairs []store.EntityNamePair) {
	canonicalizeTranscriptSummary(body, pairs)
	if len(pairs) == 0 {
		return
	}
	segments, ok := body["segments"].([]map[string]any)
	if !ok {
		return
	}
	for _, item := range segments {
		if text, ok := item["text"].(string); ok {
			item["text"] = canonicalizeAnalysisText(text, pairs)
		}
		if revised, ok := item["revised"].(string); ok {
			item["revised"] = canonicalizeAnalysisText(revised, pairs)
		}
	}
}

// transcriptSummaryJSON is the transcript without its segments. The full entry
// payload uses it: segments are usually large and only needed when the user
// expands the transcript, which fetches them page by page.
func transcriptSummaryJSON(t store.Transcript) map[string]any {
	// text e o que o usuario le: o revisado quando existe, o cru do whisper
	// quando nao. O original continua nos segmentos e nunca e sobrescrito.
	text := t.Text
	if strings.TrimSpace(t.RevisedText) != "" {
		text = t.RevisedText
	}
	return map[string]any{
		"model":    t.Model,
		"language": t.Language,
		"text":     text,
		// raw_text e o original do whisper. O app compara com ele antes de
		// reenviar: se o unico diferenca for a revisao, o envio apagaria a
		// revisao que o servidor ja tinha feito.
		"raw_text":               t.Text,
		"trim_silence":           t.TrimSilence,
		"duration_seconds":       t.DurationSeconds,
		"revised":                hasRevision(t),
		"revised_model":          t.RevisedModel,
		"revised_prompt_version": t.RevisedPromptVersion,
		"revised_literal":        t.RevisedLiteral,
		"revised_comprehension":  t.RevisedComprehension,
		"revised_rejected":       t.RevisedRejected,
		"revised_through":        t.RevisedThrough,
		"revised_finished":       t.RevisedFinished,
		"revised_changed":        t.RevisedChanged,
		"revised_pending":        t.RevisedPending,
	}
}

// hasRevision reports whether a revision pass ran for the transcript. A pass
// that rejected every segment has no revision rows, but it still ran and left
// its counts; `revised` has to cover it, otherwise the panel hides the failure.
func hasRevision(t store.Transcript) bool {
	return t.RevisedPromptVersion > 0 || t.RevisedFinished || t.RevisedThrough > 0 || t.RevisedRejected > 0
}

// handleListSegments serves one page of transcript segments for the full
// transcript view. `cursor` is the plaintext index of the first segment.
func (s *Server) handleListSegments(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	entryID := r.PathValue("id")
	query := r.URL.Query()

	var t store.Transcript
	var err error
	if attachmentID := strings.TrimSpace(query.Get("attachment_id")); attachmentID != "" {
		t, err = s.deps.Store.TranscriptByAttachment(ctx, attachmentID)
		if err == nil && t.EntryID != entryID {
			writeError(w, http.StatusNotFound, "not_found", "transcricao indisponivel")
			return
		}
	} else {
		t, err = s.deps.Store.LatestTranscript(ctx, entryID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "transcricao indisponivel")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	offset := 0
	if raw := strings.TrimSpace(query.Get("cursor")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			offset = n
		}
	}
	limit := 200
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 1000 {
		limit = 1000
	}
	segs, more, err := s.deps.Store.ListSegmentsPage(ctx, t.ID, offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// As paginas da transcricao tambem mostram a grafia atual da entidade.
	aliasPairs, _ := s.deps.Store.EntityAliasPairs(ctx)
	out := make([]map[string]any, 0, len(segs))
	for _, seg := range segs {
		item := map[string]any{
			"idx":      seg.Idx,
			"start_ms": seg.StartMS,
			"end_ms":   seg.EndMS,
			"text":     canonicalizeAnalysisText(seg.Text, aliasPairs),
			"edited":   seg.UserEdited,
			"reviewed": seg.Revised != "",
		}
		if seg.Revised != "" && seg.Revised != seg.Text {
			item["revised"] = canonicalizeAnalysisText(seg.Revised, aliasPairs)
		}
		out = append(out, item)
	}
	body := map[string]any{"segments": out}
	if more {
		body["next_cursor"] = strconv.Itoa(offset + len(out))
	}
	writeJSON(w, http.StatusOK, body)
}

// audiosJSON renders the audio attachments of an entry, each with its own
// transcript when available.
func (s *Server) audiosJSON(ctx context.Context, entryID string, audios []store.Attachment) []map[string]any {
	// Grafias antigas de entidades mescladas aparecem com o nome atual tambem
	// no resumo da transcricao de cada audio.
	aliasPairs, _ := s.deps.Store.EntityAliasPairs(ctx)
	// Uma nota com um unico audio: se a transcricao existe mas ficou solta (sem
	// attachment), ela e a deste audio. Sem isso o painel mostrava a nota
	// transcrita e nenhum texto.
	var loose store.Transcript
	if len(audios) == 1 {
		if t, err := s.deps.Store.LatestTranscript(ctx, entryID); err == nil {
			loose = t
		}
	}
	out := make([]map[string]any, 0, len(audios))
	for _, a := range audios {
		item := map[string]any{
			"id":               a.ID,
			"content_type":     a.ContentType,
			"size_bytes":       a.SizeBytes,
			"duration_seconds": a.DurationSeconds,
			"created_at":       a.CreatedAt,
		}
		if t, err := s.deps.Store.TranscriptByAttachment(ctx, a.ID); err == nil {
			summary := transcriptSummaryJSON(t)
			canonicalizeTranscriptSummary(summary, aliasPairs)
			item["transcript"] = summary
		} else {
			if !errors.Is(err, sql.ErrNoRows) && s.deps.Logger != nil {
				// Sem transcricao, o painel do audio fica vazio. Nao engolir o
				// erro: um schema desalinhado ja escondeu todas as transcricoes.
				s.deps.Logger.Warn("api: ler transcricao do audio", "entry_id", entryID,
					"attachment_id", a.ID, "erro", err)
			}
			if loose.ID != "" {
				summary := transcriptSummaryJSON(loose)
				canonicalizeTranscriptSummary(summary, aliasPairs)
				item["transcript"] = summary
			}
		}
		out = append(out, item)
	}
	return out
}

func (s *Server) handleRetranscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")
	audios, err := s.deps.Store.ListAudios(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	for _, audio := range audios {
		if _, err := s.deps.Queue.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:"+audio.ID,
			jobs.TranscribePayload{EntryID: id, AttachmentID: audio.ID}); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, id, store.EntryQueued)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": id, "status": store.EntryQueued})
	writeJSON(w, http.StatusAccepted, map[string]string{"status": store.EntryQueued})
}

// handleCancelEntry stops any running or queued transcription/analysis of an
// entry and resets its status.
func (s *Server) handleCancelEntry(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")
	ids, err := s.deps.Queue.CancelEntry(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if s.deps.Canceller != nil {
		for _, jobID := range ids {
			s.deps.Canceller.Cancel(jobID)
		}
	}
	status := store.EntryStored
	if _, _, err := s.deps.Store.GetTranscript(ctx, id); err == nil {
		status = store.EntryTranscribed
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, id, status)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": id, "status": status})
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "cancelled": ids})
}
