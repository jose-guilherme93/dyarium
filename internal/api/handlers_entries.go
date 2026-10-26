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
		// Versao de cada campo editavel, para o cliente mandar de volta na
		// gravacao e o servidor recusar o que ja mudou em outro lugar.
		"versions": entryVersions(e),
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
	body := pageJSON(entriesJSON(entries, tagNames), len(entries))
	writeJSON(w, http.StatusOK, body)
}

// entriesJSON converte as entradas e anexa os nomes das tags num lugar so.
func entriesJSON(entries []store.Entry, tagNames map[string][]string) []map[string]any {
	out := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		item := entryJSON(e)
		if names := tagNames[e.ID]; len(names) > 0 {
			item["tags"] = names
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
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
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
		body["audios"] = s.audiosJSON(ctx, audios)
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
	if req.Title == nil && recordedAt == nil && req.NotebookID == nil && req.Archived == nil {
		writeError(w, http.StatusBadRequest, "empty_patch", "nada para atualizar")
		return
	}
	if req.NotebookID != nil && strings.TrimSpace(*req.NotebookID) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_notebook", "caderno obrigatorio")
		return
	}
	versions, conflict, err := s.deps.Store.UpdateEntryFields(r.Context(), id, req.Title, recordedAt,
		req.NotebookID, req.Archived, req.Versions.Title, req.Versions.RecordedAt)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
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
	writeJSON(w, http.StatusOK, transcriptJSON(t, segs))
}

type putTranscriptRequest struct {
	AttachmentID string `json:"attachment_id"`
	Language     string `json:"language"`
	Text         string `json:"text"`
	Segments     []struct {
		StartMS int64  `json:"start_ms"`
		EndMS   int64  `json:"end_ms"`
		Text    string `json:"text"`
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
			ID:        id.New(),
			StartMS:   seg.StartMS,
			EndMS:     seg.EndMS,
			Text:      seg.Text,
			CreatedAt: now,
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
	_ = s.deps.Store.UpdateEntryStatus(ctx, entryID, store.EntryTranscribed)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": entryID, "status": store.EntryTranscribed})
	s.deps.Events.Publish("transcript.ready", map[string]string{"entry_id": entryID})
	writeJSON(w, http.StatusOK, map[string]string{"model": "local"})
}

// transcriptJSON renders a transcript with its segments.
func transcriptJSON(t store.Transcript, segs []store.Segment) map[string]any {
	body := transcriptSummaryJSON(t)
	segments := make([]map[string]any, 0, len(segs))
	for _, seg := range segs {
		segments = append(segments, map[string]any{
			"start_ms": seg.StartMS,
			"end_ms":   seg.EndMS,
			"text":     seg.Text,
		})
	}
	body["segments"] = segments
	return body
}

// transcriptSummaryJSON is the transcript without its segments. The full entry
// payload uses it: segments are usually large and only needed when the user
// expands the transcript, which fetches them page by page.
func transcriptSummaryJSON(t store.Transcript) map[string]any {
	return map[string]any{
		"model":            t.Model,
		"language":         t.Language,
		"text":             t.Text,
		"trim_silence":     t.TrimSilence,
		"duration_seconds": t.DurationSeconds,
	}
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
	out := make([]map[string]any, 0, len(segs))
	for _, seg := range segs {
		out = append(out, map[string]any{
			"start_ms": seg.StartMS,
			"end_ms":   seg.EndMS,
			"text":     seg.Text,
		})
	}
	body := map[string]any{"segments": out}
	if more {
		body["next_cursor"] = strconv.Itoa(offset + len(out))
	}
	writeJSON(w, http.StatusOK, body)
}

// audiosJSON renders the audio attachments of an entry, each with its own
// transcript when available.
func (s *Server) audiosJSON(ctx context.Context, audios []store.Attachment) []map[string]any {
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
			item["transcript"] = transcriptSummaryJSON(t)
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
