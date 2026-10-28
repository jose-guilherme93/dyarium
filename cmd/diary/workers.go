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

	"github.com/joseti/dyarium/internal/analysisbuild"
	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/events"
	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/preview"
	"github.com/joseti/dyarium/internal/review"
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
	base := analyze.Config{
		Enabled:  cfg.AnalyzeEnabled,
		Provider: cfg.AnalyzeProvider,
		BaseURL:  cfg.AnalyzeBaseURL,
		APIKey:   cfg.AnalyzeAPIKey,
		Model:    cfg.AnalyzeModel,
	}
	settings, err := st.ListSettings(ctx)
	if err != nil {
		return base
	}
	return analyze.ConfigFromSettings(base, settings)
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
				// O aparelho pode ter mandado a transcricao (PUT /transcript)
				// enquanto o worker tentava. Sem esta checagem, o job falho
				// sobrescrevia o estado e a nota aparecia como "falhou" mesmo
				// com o texto salvo e legivel no dashboard e no app.
				if transcript, err := st.LatestTranscript(ctx, payload.EntryID); err == nil && strings.TrimSpace(transcript.Text) != "" {
					_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryTranscribed)
					bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryTranscribed})
				} else {
					_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
					bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": err.Error()})
				}
			}
			return err
		}
		bus.Publish("transcript.ready", map[string]string{"entry_id": payload.EntryID})
		// O cliente pode ter ficado responsavel pela analise (roda no aparelho
		// ou esta desligada): nesse caso o servidor nao enfileira nada.
		if serverOwnsAnalysis(ctx, st, cfg, payload.EntryID) {
			if _, err := queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey(payload.EntryID), jobs.AnalyzePayload{EntryID: payload.EntryID}); err != nil {
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

// serverOwnsAnalysis reports whether the server should enqueue the analysis of
// an entry: the analysis must be enabled and the client must not have claimed
// the stage (device analysis or analysis turned off).
func serverOwnsAnalysis(ctx context.Context, st *store.Store, cfg config.Config, entryID string) bool {
	if !analyzeConfigFromSettings(ctx, st, cfg).Enabled {
		return false
	}
	local, err := st.EntryLocalAnalysis(ctx, entryID)
	if err != nil {
		// Sem saber de quem e a etapa, nao processar: trabalho indesejado e pior
		// que trabalho adiado.
		return false
	}
	return !local
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
		metrics := analysisMetrics{
			Comprehension:  -1,
			StutterRate:    review.PerHundred(input.Speech.Stutter, input.Speech.Words),
			HesitationRate: review.PerHundred(input.Speech.Hesitation, input.Speech.Words),
		}
		reviewEnabled, literal := reviewSettings(ctx, st)
		if reviewEnabled && len(input.StoreSegments) > 0 {
			if err := reviseTranscript(ctx, st, client, analysisCfg.Model, payload.EntryID, &input, literal, &metrics, bus); err != nil {
				// A revisao e opcional: se ela falhar, a analise roda no texto cru.
				logger.Warn("worker: revisao da transcricao", "entry_id", payload.EntryID, "erro", err)
			}
		}
		progress := func(stage string, done, total int) {
			bus.Publish("job.progress", map[string]any{
				"entry_id": payload.EntryID,
				"stage":    stage,
				"done":     done,
				"total":    total,
			})
		}
		// A nota e lida secao por secao (titulos do texto escrito + transcricao)
		// e depois sintetizada: uma nota longa nao cabe num rotulo so.
		pipeline := analyze.NewPipeline(client)
		var result analyze.Result
		if sections := input.analysisSections(); len(sections) > 0 {
			result, err = pipeline.RunSections(ctx, input.Title, sections, progress)
		} else {
			result, err = pipeline.Run(ctx, input.Segments, progress)
		}
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
		if metrics.Comprehension < 0 {
			metrics.Comprehension = result.Comprehension
			metrics.Source = "analysis"
		}
		analysis, links := buildAnalysis(payload.EntryID, result, metrics)
		// Onde a analise rodou: no proprio servidor ou em um provedor hospedado.
		analysis.Origin = analysisCfg.Origin()
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
			Text:    visibleText(seg),
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
	// Segments is the transcript of the audios, with timestamps (the revision
	// feeds the analysis through it).
	Segments []analyze.Segment
	// TextSections is the written note split by its headings. The analysis
	// reads each one separately.
	TextSections []analyze.Section
	// StoreSegments is set only when the input is the transcript of a single
	// audio. It is what lets the revision map every segment back to a line.
	StoreSegments   []store.Segment
	TranscriptID    string
	Title           string
	Language        string
	TextChars       int
	TranscriptChars int
	Images          int
	// Speech is the disfluency measurement of the raw audio text.
	Speech review.Counts
}

// analysisSections is what the pipeline reads: every written section plus the
// transcript (revised, when the revision ran). Segments carries the revised
// text, so this has to be built after the revision pass.
func (in analysisInputResult) analysisSections() []analyze.Section {
	sections := make([]analyze.Section, 0, len(in.TextSections)+1)
	sections = append(sections, in.TextSections...)
	// A transcricao vai com [mm:ss]: e o que permite ao modelo devolver
	// start_ms real nos momentos. Sem os tempos, o painel mostrava instantes
	// inventados.
	text := strings.TrimSpace(joinSegmentsWithTime(in.Segments))
	if text != "" {
		sections = append(sections, analyze.Section{
			Heading:  "Transcrição do áudio",
			Kind:     "transcript",
			Text:     text,
			Segments: in.Segments,
		})
	}
	return sections
}

// joinSegmentsWithTime is the transcript as the model reads it, with the
// [mm:ss] offset of each segment so key moments carry a real timestamp.
func joinSegmentsWithTime(segments []analyze.Segment) string {
	lines := make([]string, 0, len(segments))
	for _, segment := range segments {
		text := strings.TrimSpace(segment.Text)
		if text != "" {
			lines = append(lines, "["+analyze.FormatOffset(segment.StartMS)+"] "+text)
		}
	}
	return strings.Join(lines, "\n")
}

// joinSegments is the transcript text as the model reads it.
func joinSegments(segments []analyze.Segment) string {
	lines := make([]string, 0, len(segments))
	for _, segment := range segments {
		text := strings.TrimSpace(segment.Text)
		if text != "" {
			lines = append(lines, text)
		}
	}
	return strings.Join(lines, "\n")
}

// visibleText is the text the analysis should read: the revision when it exists
// (it is the readable version), the raw whisper text otherwise.
func visibleText(seg store.Segment) string {
	if strings.TrimSpace(seg.Revised) != "" {
		return seg.Revised
	}
	return seg.Text
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
	// A taxa de gagueira e hesitacao sai do texto cru, nunca do revisado.
	speech := review.Speak(audioText)
	title := ""
	if entry, err := st.GetEntry(ctx, entryID); err == nil {
		title = entry.Title
	}
	textSections, noteErr := noteSections(ctx, st, entryID)
	linksText := entryLinksText(ctx, st, entryID)
	if text := strings.TrimSpace(linksText); text != "" {
		textSections = append(textSections, analyze.Section{Heading: "Links", Kind: "text", Text: text})
	}

	images := 0
	if attachments, err := st.ListAttachments(ctx, entryID); err == nil {
		for _, attachment := range attachments {
			if attachment.Kind == "image" {
				images += 1
			}
		}
	}

	// A transcricao entra como segmentos (com a marcacao de tempo) para a
	// revisao mapear cada linha e para os momentos-chave terem o instante.
	segments := []analyze.Segment(nil)
	storeSegments := []store.Segment(nil)
	transcriptID := ""
	if transcriptErr == nil && len(transcripts) == 1 {
		if _, list, err := st.GetTranscriptByAttachment(ctx, transcripts[0].AttachmentID); err == nil {
			storeSegments = list
			transcriptID = transcripts[0].ID
			segments = analyzeSegments(transcripts[0].Text, list)
		}
	}
	if segments == nil && strings.TrimSpace(audioText) != "" {
		segments = []analyze.Segment{{Text: audioText}}
	}

	textChars := 0
	for _, section := range textSections {
		textChars += len([]rune(section.Text))
	}
	if len(textSections) == 0 && strings.TrimSpace(joinSegments(segments)) == "" {
		partial := analysisInputResult{Images: images, Speech: speech, Title: title}
		if transcriptErr != nil {
			return partial, fmt.Errorf("worker: transcript: %w", transcriptErr)
		}
		if noteErr != nil {
			return partial, noteErr
		}
		return partial, errors.New("transcricao indisponivel")
	}
	return analysisInputResult{
		Segments:        segments,
		TextSections:    textSections,
		StoreSegments:   storeSegments,
		TranscriptID:    transcriptID,
		Title:           title,
		Language:        language,
		TextChars:       textChars,
		TranscriptChars: len([]rune(strings.TrimSpace(audioText))),
		Images:          images,
		Speech:          speech,
	}, nil
}

// noteSections splits the written note by its headings, keeping each section as
// its own analysis unit. A note without headings is one section.
func noteSections(ctx context.Context, st *store.Store, entryID string) ([]analyze.Section, error) {
	notes, err := st.ListNotes(ctx, entryID)
	if err != nil {
		return nil, err
	}
	if len(notes) == 0 {
		return nil, nil
	}
	note := notes[0]
	if markdown := strings.TrimSpace(note.ContentMarkdown); markdown != "" {
		return splitMarkdownSections(markdown), nil
	}
	if text := strings.TrimSpace(extractText(note.Document)); text != "" {
		return []analyze.Section{{Kind: "text", Text: text}}, nil
	}
	return nil, nil
}

var markdownHeading = regexp.MustCompile(`^(#{1,6})\s+(.*)$`)

// splitMarkdownSections cuts the written text on its markdown headings. Text
// before the first heading is a section with an empty heading.
func splitMarkdownSections(markdown string) []analyze.Section {
	sections := make([]analyze.Section, 0, 4)
	heading := ""
	lines := make([]string, 0, 32)
	flush := func() {
		text := preview.Plain(strings.Join(lines, "\n"))
		lines = lines[:0]
		if strings.TrimSpace(text) == "" {
			return
		}
		sections = append(sections, analyze.Section{Heading: heading, Kind: "text", Text: text})
	}
	for _, line := range strings.Split(markdown, "\n") {
		if match := markdownHeading.FindStringSubmatch(line); match != nil {
			flush()
			heading = strings.TrimSpace(match[2])
			continue
		}
		lines = append(lines, line)
	}
	flush()
	return sections
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
		return preview.Plain(note.ContentMarkdown), nil
	}
	return extractText(note.Document), nil
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
// analysisMetrics are the numbers the analysis stores besides the model result.
type analysisMetrics struct {
	Comprehension   int
	Source          string
	StutterRate     float64
	HesitationRate  float64
	RevisedSegments int
}

// reviewSettings reads the per-deployment revision preference. Both default to
// off: the analysis works without the revision, only less cleanly.
func reviewSettings(ctx context.Context, st *store.Store) (enabled, literal bool) {
	settings, err := st.ListSettings(ctx)
	if err != nil {
		return false, false
	}
	return settings["review_enabled"] == "true", settings["literal_transcript"] == "true"
}

// revisionIsCurrent tells whether the stored revision already matches the
// current model, prompt version and literal option. User-edited segments are
// outside the revision and never make it stale.
func revisionIsCurrent(t store.Transcript, segments []store.Segment, model string, literal bool) bool {
	if t.RevisedModel != model || t.RevisedPromptVersion != review.PromptVersion || t.RevisedLiteral != literal {
		return false
	}
	for _, seg := range segments {
		if seg.UserEdited {
			continue
		}
		if strings.TrimSpace(seg.Revised) == "" {
			return false
		}
	}
	return true
}

// reviseTranscript runs the revision pass and stores it. The texts applied to
// the analysis input are the accepted ones; rejected segments keep the raw
// whisper text. It is a no-op when the stored revision is already current.
func reviseTranscript(ctx context.Context, st *store.Store, client *analyze.Client, model, entryID string,
	input *analysisInputResult, literal bool, metrics *analysisMetrics, bus *events.Bus) error {
	transcript, err := st.LatestTranscript(ctx, entryID)
	if err != nil {
		return err
	}
	if revisionIsCurrent(transcript, input.StoreSegments, model, literal) {
		metrics.Comprehension = transcript.RevisedComprehension
		metrics.Source = "review"
		metrics.RevisedSegments = countChanged(transcript, input.StoreSegments)
		return nil
	}
	// A revisao parte sempre do texto cru do whisper, nunca do derivado.
	raw := make([]analyze.Segment, len(input.StoreSegments))
	for i, seg := range input.StoreSegments {
		raw[i] = analyze.Segment{StartMS: int(seg.StartMS), EndMS: int(seg.EndMS), Text: seg.Text}
	}
	// A revisao e gravada e publicada por janela: o painel mostra o texto se
	// montando em vez de esperar a transcricao inteira.
	if err := st.BeginRevision(ctx, transcript.ID); err != nil {
		return err
	}
	now := time.Now().UTC()
	windowSize := review.ServerWindow
	totalWindows := (len(raw) + windowSize - 1) / windowSize
	revision, err := analyze.NewPipeline(client).Revise(ctx, raw, analyze.ReviseOptions{
		Literal: literal,
		Title:   input.Title,
		OnWindow: func(start, end int, texts []string, rejected int) error {
			revs := make([]store.TranscriptRevision, 0, end-start)
			changed := make([]map[string]any, 0, end-start)
			for i := start; i < end; i++ {
				seg := input.StoreSegments[i]
				if seg.UserEdited {
					continue
				}
				text := strings.TrimSpace(seg.Text)
				if texts[i-start] != "" {
					text = texts[i-start]
					changed = append(changed, map[string]any{"idx": seg.Idx, "text": texts[i-start]})
				}
				revs = append(revs, store.TranscriptRevision{
					SegmentID:     seg.ID,
					Text:          text,
					Model:         model,
					PromptVersion: review.PromptVersion,
					Literal:       literal,
					CreatedAt:     now,
				})
			}
			if saveErr := st.SaveRevisionWindow(ctx, transcript.ID, revs, rejected, end); saveErr != nil {
				return saveErr
			}
			bus.Publish("transcript.revised", map[string]any{
				"entry_id":      entryID,
				"attachment_id": transcript.AttachmentID,
				"segments":      changed,
				"done":          (end + windowSize - 1) / windowSize,
				"total":         totalWindows,
				"rejected":      rejected,
			})
			return nil
		},
	}, func(stage string, done, total int) {
		bus.Publish("job.progress", map[string]any{
			"entry_id": entryID,
			"stage":    stage,
			"done":     done,
			"total":    total,
		})
	})
	if err != nil {
		return err
	}
	if err := st.FinishRevision(ctx, transcript.ID, revision.Comprehension, revision.Rejected+revision.Failed,
		len(input.StoreSegments), model, review.PromptVersion, literal); err != nil {
		return err
	}
	changed := 0
	for i, seg := range input.StoreSegments {
		if seg.UserEdited || revision.Texts[i] == "" {
			continue
		}
		input.Segments[i].Text = revision.Texts[i]
		changed++
	}
	metrics.Comprehension = revision.Comprehension
	metrics.Source = "review"
	metrics.RevisedSegments = changed
	return nil
}

// countChanged counts segments whose stored revision differs from the original.
func countChanged(t store.Transcript, segments []store.Segment) int {
	changed := 0
	for _, seg := range segments {
		if !seg.UserEdited && strings.TrimSpace(seg.Revised) != "" && seg.Revised != seg.Text {
			changed++
		}
	}
	return changed
}

func buildAnalysis(entryID string, result analyze.Result, metrics analysisMetrics) (store.Analysis, []store.EntityLink) {
	return analysisbuild.Build(entryID, result, analysisbuild.Metrics{
		Comprehension:   metrics.Comprehension,
		Source:          metrics.Source,
		StutterRate:     metrics.StutterRate,
		HesitationRate:  metrics.HesitationRate,
		RevisedSegments: metrics.RevisedSegments,
	})
}
