package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/events"
	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
	"github.com/joseti/dyarium/internal/transcribe"
)

// telegramSink ingests audio received through the Telegram module.
type telegramSink struct {
	ingest *ingest.Service
	queue  *jobs.Queue
	store  *store.Store
	bus    *events.Bus
}

func (s telegramSink) IngestAudio(ctx context.Context, source, filename, contentType string, data io.Reader) (string, error) {
	entry, err := s.ingest.IngestStream(ctx, source, filename, contentType, data)
	if err != nil {
		return "", err
	}
	att, err := s.store.GetAttachmentByKind(ctx, entry.ID, store.AttachmentOriginal)
	if err != nil {
		return "", err
	}
	if _, err := s.queue.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:"+att.ID, jobs.TranscribePayload{EntryID: entry.ID, AttachmentID: att.ID}); err != nil {
		return "", err
	}
	_ = s.store.UpdateEntryStatus(ctx, entry.ID, store.EntryQueued)
	s.bus.Publish("entry.status", map[string]string{"entry_id": entry.ID, "status": store.EntryQueued})
	return entry.ID, nil
}

// analyzeConfigFromSettings merges the environment defaults with the values
// stored in the database, so the dashboard can configure paid APIs.
func analyzeConfigFromSettings(ctx context.Context, st *store.Store, cfg config.Config) analyze.Config {
	result := analyze.Config{
		Enabled:  cfg.AnalyzeEnabled,
		Provider: cfg.AnalyzeProvider,
		BaseURL:  cfg.AnalyzeBaseURL,
		APIKey:   cfg.AnalyzeAPIKey,
		Model:    cfg.AnalyzeModel,
	}
	if settings, err := st.ListSettings(ctx); err == nil {
		if v, ok := settings["analyze_enabled"]; ok {
			result.Enabled = v == "true"
		}
		if v, ok := settings["analyze_provider"]; ok && v != "" {
			result.Provider = v
		}
		if v, ok := settings["analyze_base_url"]; ok && v != "" {
			result.BaseURL = v
		}
		if v, ok := settings["analyze_api_key"]; ok {
			result.APIKey = v
		}
		if v, ok := settings["analyze_model"]; ok && v != "" {
			result.Model = v
		}
		if v, ok := settings["analysis_themes"]; ok && strings.TrimSpace(v) != "" {
			result.Themes = analyze.ParseThemes(v)
		}
	}
	return result
}

// transcribeHandler runs the transcription pipeline and, on success, either
// enqueues analysis or marks the entry ready.
func transcribeHandler(st *store.Store, cfg config.Config, pipeline *transcribe.Pipeline, queue *jobs.Queue, bus *events.Bus, logger *slog.Logger) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job, heartbeat func() error) error {
		var payload jobs.TranscribePayload
		if err := jobs.DecodePayload(job, &payload); err != nil {
			return err
		}
		_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryTranscribing)
		bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryTranscribing})
		cb := transcribe.Callbacks{
			Heartbeat: heartbeat,
			Progress: func(stage string, done, total int) {
				bus.Publish("job.progress", map[string]any{
					"entry_id": payload.EntryID,
					"stage":    stage,
					"done":     done,
					"total":    total,
				})
			},
			Segment: func(seg transcribe.Segment) {
				bus.Publish("transcript.partial", map[string]any{
					"entry_id": payload.EntryID,
					"start_ms": seg.StartMS,
					"end_ms":   seg.EndMS,
					"text":     seg.Text,
				})
			},
		}
		if err := pipeline.Run(ctx, payload.EntryID, payload.AttachmentID, cb); err != nil {
			// A fila ainda retenta ate max_attempts. So marca a entrada como
			// definitivamente falha na ultima tentativa; antes disso o app veria
			// "falhou" enquanto o worker ainda ia tentar de novo. Um cancelamento
			// tem caminho proprio e nao deve virar falha.
			if ctx.Err() == nil && job.Attempts+1 >= job.MaxAttempts {
				_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
				bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": err.Error()})
			}
			return err
		}
		bus.Publish("transcript.ready", map[string]string{"entry_id": payload.EntryID})
		if analyzeConfigFromSettings(ctx, st, cfg).Enabled {
			if _, err := queue.Enqueue(ctx, jobs.TypeAnalyze, "analyze:"+payload.EntryID, jobs.AnalyzePayload{EntryID: payload.EntryID}); err != nil {
				logger.Error("worker: enfileirar analise", "erro", err)
			}
			// Keep the entry as transcribed until the analyze job actually starts.
			return nil
		}
		_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryReady)
		bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryReady})
		return nil
	}
}

// analyzeHandler enriches a transcript and stores the analysis.
func analyzeHandler(st *store.Store, cfg config.Config, bus *events.Bus, logger *slog.Logger) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job, _ func() error) error {
		var payload jobs.AnalyzePayload
		if err := jobs.DecodePayload(job, &payload); err != nil {
			return err
		}
		analysisCfg := analyzeConfigFromSettings(ctx, st, cfg)
		if !analysisCfg.Enabled {
			return analyze.ErrDisabled
		}

		started := time.Now().UTC()
		saveRun := func(run store.AnalysisRun) {
			run.Runtime = "server"
			run.Provider = analysisCfg.Provider
			run.Model = analysisCfg.Model
			run.Attempt = job.Attempts + 1
			run.StartedAt = started
			if run.FinishedAt.IsZero() {
				run.FinishedAt = time.Now().UTC()
			}
			if run.DurationMS == 0 && !run.FinishedAt.Before(run.StartedAt) {
				run.DurationMS = run.FinishedAt.Sub(run.StartedAt).Milliseconds()
			}
			if run.DurationMS > 0 && run.CompletionTokens > 0 {
				run.TokensPerSecond = float64(run.CompletionTokens) * 1000 / float64(run.DurationMS)
			}
			// O diagnostico nunca derruba a analise.
			if err := st.SaveAnalysisRun(context.WithoutCancel(ctx), run); err != nil {
				logger.Error("worker: registrar execucao da analise", "entry_id", payload.EntryID, "erro", err)
			}
		}

		_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryAnalyzing)
		bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryAnalyzing})

		input, err := analysisInput(ctx, st, payload.EntryID)
		run := store.AnalysisRun{
			EntryID:              payload.EntryID,
			InputTextChars:       input.TextChars,
			InputTranscriptChars: input.TranscriptChars,
			InputImages:          input.Images,
		}
		if err != nil {
			run.Outcome = "error"
			run.ErrorClass = "input"
			run.FinishedAt = time.Now().UTC()
			saveRun(run)
			_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
			bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": analyze.FriendlyError(err)})
			logger.Error("worker: analise sem entrada", "entry_id", payload.EntryID, "erro", err)
			return err
		}
		if input.Language != "" {
			analysisCfg.Language = input.Language
		}

		client := analyze.New(analysisCfg)
		result, err := analyze.NewPipeline(client).Run(ctx, input.Segments, func(stage string, done, total int) {
			bus.Publish("job.progress", map[string]any{
				"entry_id": payload.EntryID,
				"stage":    stage,
				"done":     done,
				"total":    total,
			})
		})
		run.FinishedAt = time.Now().UTC()
		run.DurationMS = run.FinishedAt.Sub(started).Milliseconds()
		run.PromptTokens, run.CompletionTokens = client.Usage()
		if run.DurationMS > 0 && run.CompletionTokens > 0 {
			run.TokensPerSecond = float64(run.CompletionTokens) * 1000 / float64(run.DurationMS)
		}

		if err != nil {
			// Erro transitorio (rede, 429, 5xx) ainda tem tentativas: manter a
			// nota como "analisando" evita anunciar falha cedo demais, quando a
			// retentativa ainda pode dar certo. Chave/modelo/endpoint errados sao
			// finais e falham na hora, com a mensagem certa.
			run.Outcome = "error"
			if errors.Is(err, context.Canceled) {
				run.Outcome = "stopped"
			}
			run.ErrorClass = analyze.ErrorClass(err)
			saveRun(run)
			if shouldGiveUpAnalysis(job.Attempts, job.MaxAttempts, err) {
				_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
				bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": analyze.FriendlyError(err)})
			}
			logger.Error("worker: analise falhou", "entry_id", payload.EntryID, "erro", err)
			return err
		}
		analysis, links := buildAnalysis(payload.EntryID, result)
		if err := st.SaveRichAnalysis(ctx, analysis, links); err != nil {
			run.Outcome = "error"
			run.ErrorClass = "storage"
			saveRun(run)
			return err
		}
		run.AnalysisID = analysis.ID
		run.Outcome = "ok"
		saveRun(run)
		_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryReady)
		bus.Publish("analysis.ready", map[string]string{"entry_id": payload.EntryID})
		bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryReady})
		logger.Info("worker: analise concluida", "entry_id", payload.EntryID)
		return nil
	}
}

// cleanupHandler removes the encrypted objects and the row of an entry that was
// soft-deleted. It is idempotent and a no-op when the entry is not deleted (for
// example, a job left over from a deletion that never completed).
func cleanupHandler(st *store.Store, ing *ingest.Service, logger *slog.Logger) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job, _ func() error) error {
		var payload jobs.CleanupPayload
		if err := jobs.DecodePayload(job, &payload); err != nil {
			return err
		}
		deleted, err := st.EntryIsDeleted(ctx, payload.EntryID)
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if !deleted {
			return nil
		}
		attachments, err := st.ListAttachments(ctx, payload.EntryID)
		if err != nil {
			return err
		}
		for _, attachment := range attachments {
			if err := ing.DeleteAttachmentObject(attachment); err != nil {
				return err
			}
		}
		if err := st.PurgeEntry(ctx, payload.EntryID); err != nil {
			return err
		}
		logger.Info("worker: entrada removida", "entry_id", payload.EntryID, "objetos", len(attachments))
		return nil
	}
}

// shouldGiveUpAnalysis decides when a failed analysis is final. Permanent
// provider errors (wrong key, model or endpoint) stop at once; transient ones
// (rate limit, timeout, 5xx) use every attempt before the entry is marked as
// failed.
func shouldGiveUpAnalysis(attempts, maxAttempts int, err error) bool {
	if !analyze.Retryable(err) {
		return true
	}
	return attempts+1 >= maxAttempts
}

// analyzeSegments maps the stored transcript segments to the analysis package
// and falls back to a single synthetic segment when none is available.
func analyzeSegments(text string, segments []store.Segment) []analyze.Segment {
	out := make([]analyze.Segment, 0, len(segments))
	for _, seg := range segments {
		out = append(out, analyze.Segment{
			StartMS: int(seg.StartMS),
			EndMS:   int(seg.EndMS),
			Text:    seg.Text,
		})
	}
	if len(out) == 0 && strings.TrimSpace(text) != "" {
		out = append(out, analyze.Segment{Text: text})
	}
	return out
}

// analysisInputResult carries the pipeline input and the measurements the run
// record needs. Character counts are runes and never include the prefixes the
// prompt adds.
type analysisInputResult struct {
	Segments        []analyze.Segment
	Language        string
	TextChars       int
	TranscriptChars int
	Images          int
}

// analysisInput builds the analysis input from every kind of content the entry
// has: written text, audio transcripts, images (their captions/filenames) and
// links. The pipeline receives an array of segments; when there is only one
// audio and nothing else, the original segments are kept so key moments keep
// their timestamps. With mixed content, one text segment carries everything.
func analysisInput(ctx context.Context, st *store.Store, entryID string) (analysisInputResult, error) {
	transcripts, transcriptErr := st.ListTranscripts(ctx, entryID)
	language := ""
	if transcriptErr == nil {
		for _, t := range transcripts {
			if t.Language != "" {
				language = t.Language
				break
			}
		}
	}
	audioText := transcriptText(transcripts)
	bodyText, noteErr := noteBodyText(ctx, st, entryID)
	linksText := entryLinksText(ctx, st, entryID)

	images := 0
	if attachments, err := st.ListAttachments(ctx, entryID); err == nil {
		for _, attachment := range attachments {
			if attachment.Kind == "image" {
				images += 1
			}
		}
	}

	// Somente um audio, sem texto escrito nem links: mantem os segmentos.
	if transcriptErr == nil && len(transcripts) == 1 &&
		strings.TrimSpace(bodyText) == "" && strings.TrimSpace(linksText) == "" {
		if _, segments, err := st.GetTranscriptByAttachment(ctx, transcripts[0].AttachmentID); err == nil {
			return analysisInputResult{
				Segments:        analyzeSegments(transcripts[0].Text, segments),
				Language:        language,
				TranscriptChars: len([]rune(strings.TrimSpace(transcripts[0].Text))),
				Images:          images,
			}, nil
		}
	}

	parts := make([]string, 0, 3)
	if text := strings.TrimSpace(bodyText); text != "" {
		parts = append(parts, "Texto escrito:\n"+text)
	}
	if text := strings.TrimSpace(audioText); text != "" {
		parts = append(parts, "Transcricao do audio:\n"+text)
	}
	if text := strings.TrimSpace(linksText); text != "" {
		parts = append(parts, "Links da nota:\n"+text)
	}
	if len(parts) == 0 {
		partial := analysisInputResult{Images: images}
		if transcriptErr != nil {
			return partial, fmt.Errorf("worker: transcript: %w", transcriptErr)
		}
		if noteErr != nil {
			return partial, noteErr
		}
		return partial, errors.New("transcricao indisponivel")
	}
	return analysisInputResult{
		Segments:        []analyze.Segment{{Text: strings.Join(parts, "\n\n")}},
		Language:        language,
		TextChars:       len([]rune(strings.TrimSpace(bodyText))),
		TranscriptChars: len([]rune(strings.TrimSpace(audioText))),
		Images:          images,
	}, nil
}

// transcriptText joins every audio transcript of the entry.
func transcriptText(transcripts []store.Transcript) string {
	parts := make([]string, 0, len(transcripts))
	for _, t := range transcripts {
		if text := strings.TrimSpace(t.Text); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n\n")
}

// entryLinksText lists the entry's links: external URLs and the titles of the
// notes it points to.
func entryLinksText(ctx context.Context, st *store.Store, entryID string) string {
	links, err := st.ListLinks(ctx, entryID)
	if err != nil {
		return ""
	}
	parts := make([]string, 0, len(links))
	for _, link := range links {
		switch {
		case strings.TrimSpace(link.URL) != "":
			url := strings.TrimSpace(link.URL)
			label := strings.TrimSpace(link.Label)
			if label != "" && label != url {
				parts = append(parts, label+" ("+url+")")
			} else {
				parts = append(parts, url)
			}
		case link.ToEntryID != "":
			title := strings.TrimSpace(link.Title)
			if title == "" {
				title = link.ToEntryID
			}
			parts = append(parts, "nota: "+title)
		}
	}
	return strings.Join(parts, "\n")
}

// noteBodyText extracts the plain text of the entry's newest note. The body is
// markdown; only a note that was never written after the markdown migration
// still lives in the legacy BlockNote document.
func noteBodyText(ctx context.Context, st *store.Store, entryID string) (string, error) {
	notes, err := st.ListNotes(ctx, entryID)
	if err != nil {
		return "", err
	}
	if len(notes) == 0 {
		return "", nil
	}
	note := notes[0]
	if strings.TrimSpace(note.ContentMarkdown) != "" {
		return markdownToPlain(note.ContentMarkdown), nil
	}
	return extractText(note.Document), nil
}

// markdownToPlain is the plain text of a markdown body: the same view the
// dashboard counts words from (web/src/editor/blocknoteMarkdown.ts), so the
// analysis reads the same text the user sees. Markdown that carries no prose
// (fenced code, table rows, a mention to another note) is dropped.
func markdownToPlain(markdown string) string {
	plain := markdown
	for _, rule := range markdownToPlainRules {
		plain = rule.re.ReplaceAllString(plain, rule.replacement)
	}
	return strings.Join(strings.Fields(plain), " ")
}

var markdownToPlainRules = []struct {
	re          *regexp.Regexp
	replacement string
}{
	{regexp.MustCompile("(?ms)^```.*?^```[^\\n]*$"), ""},
	{regexp.MustCompile(`(?m)^\|.*\|$`), ""},
	// Imagem entra pela legenda/arquivo: e o que um modelo de texto consegue ler
	// do anexo (o conteudo visual exigiria um modelo com visao).
	{regexp.MustCompile(`!\[([^\]]*)\]\([^)\s]*\)`), "imagem: ${1}"},
	// Mencao a outra nota: fica o rotulo (a secao de links traz o titulo).
	{regexp.MustCompile(`\[([^\]]*)\]\(note:[^)\s]+\)`), "${1}"},
	// Link externo: rotulo e URL, para a analise saber para onde aponta.
	{regexp.MustCompile(`\[([^\]]*)\]\(([^)\s]+)\)`), "${1} (${2})"},
	{regexp.MustCompile(`(?m)^#{1,6}\s+`), ""},
	{regexp.MustCompile(`(?m)^>\s?`), ""},
	{regexp.MustCompile(`(?m)^\s*[-*+]\s+`), ""},
	{regexp.MustCompile(`(?m)^\s*\d+\.\s+`), ""},
	{regexp.MustCompile("[*_~`]"), ""},
}

// extractText walks a BlockNote document and concatenates every inline "text".
func extractText(raw string) string {
	var doc any
	if json.Unmarshal([]byte(raw), &doc) != nil {
		return ""
	}
	var parts []string
	var walk func(value any)
	walk = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if s, ok := node["text"].(string); ok && strings.TrimSpace(s) != "" {
				parts = append(parts, s)
			}
			for _, child := range node {
				walk(child)
			}
		case []any:
			for _, item := range node {
				walk(item)
			}
		}
	}
	walk(doc)
	return strings.Join(parts, " ")
}

// buildAnalysis converts a rich result into the stored analysis row plus the
// entity links. The legacy columns keep the previous JSON shape so the current
// dashboard keeps working.
func buildAnalysis(entryID string, result analyze.Result) (store.Analysis, []store.EntityLink) {
	emotions := make(map[string]float64, len(result.Emotions))
	for _, e := range result.Emotions {
		emotions[e.Name] = e.Intensity
	}
	people := make([]string, 0, len(result.People))
	for _, p := range result.People {
		people = append(people, p.Name)
	}
	places := make([]string, 0, len(result.Places))
	for _, p := range result.Places {
		places = append(places, p.Name)
	}
	emotionsJSON, _ := json.Marshal(emotions)
	peopleJSON, _ := json.Marshal(people)
	placesJSON, _ := json.Marshal(places)
	dataJSON, _ := json.Marshal(result)

	links := make([]store.EntityLink, 0, len(result.People)+len(result.Places)+len(result.Themes))
	for _, p := range result.People {
		sentiment := p.Sentiment
		links = append(links, store.EntityLink{
			Kind: store.EntityPerson, Name: p.Name, Count: max(p.Count, 1),
			Relation: p.Relation, Sentiment: &sentiment,
		})
	}
	for _, p := range result.Places {
		links = append(links, store.EntityLink{Kind: store.EntityPlace, Name: p.Name, Count: max(p.Count, 1)})
	}
	for _, t := range result.Themes {
		links = append(links, store.EntityLink{Kind: store.EntityTheme, Name: t.Name, Count: 1})
	}

	return store.Analysis{
		ID:             id.New(),
		EntryID:        entryID,
		Model:          result.Model,
		Sentiment:      result.Sentiment.Score,
		SentimentLabel: result.Sentiment.Label,
		Emotions:       string(emotionsJSON),
		People:         string(peopleJSON),
		Places:         string(placesJSON),
		Summary:        result.Summary,
		Raw:            result.Raw,
		Data:           string(dataJSON),
		CreatedAt:      time.Now().UTC(),
	}, links
}
