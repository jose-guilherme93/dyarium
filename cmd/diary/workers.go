package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
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
			_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
			bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": err.Error()})
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
		_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryAnalyzing)
		bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryAnalyzing})
		input, language, err := analysisInput(ctx, st, payload.EntryID)
		if err != nil {
			_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
			bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": analyze.FriendlyError(err)})
			logger.Error("worker: analise sem entrada", "entry_id", payload.EntryID, "erro", err)
			return err
		}
		if language != "" {
			analysisCfg.Language = language
		}
		client := analyze.New(analysisCfg)
		result, err := analyze.NewPipeline(client).Run(ctx, input, func(stage string, done, total int) {
			bus.Publish("job.progress", map[string]any{
				"entry_id": payload.EntryID,
				"stage":    stage,
				"done":     done,
				"total":    total,
			})
		})
		if err != nil {
			_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
			bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": analyze.FriendlyError(err)})
			logger.Error("worker: analise falhou", "entry_id", payload.EntryID, "erro", err)
			return err
		}
		analysis, links := buildAnalysis(payload.EntryID, result)
		if err := st.SaveRichAnalysis(ctx, analysis, links); err != nil {
			return err
		}
		_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryReady)
		bus.Publish("analysis.ready", map[string]string{"entry_id": payload.EntryID})
		bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryReady})
		logger.Info("worker: analise concluida", "entry_id", payload.EntryID)
		return nil
	}
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

// analysisInput prefers the audio transcripts and falls back to the written
// note body, so a text note can be analyzed too. With several audios the
// transcripts are concatenated (segment timestamps would collide, so a single
// text segment is used).
func analysisInput(ctx context.Context, st *store.Store, entryID string) ([]analyze.Segment, string, error) {
	transcripts, err := st.ListTranscripts(ctx, entryID)
	if err == nil && len(transcripts) == 1 {
		if _, segments, serr := st.GetTranscriptByAttachment(ctx, transcripts[0].AttachmentID); serr == nil {
			return analyzeSegments(transcripts[0].Text, segments), transcripts[0].Language, nil
		}
	}
	if err == nil && len(transcripts) > 1 {
		var parts []string
		language := ""
		for _, t := range transcripts {
			if text := strings.TrimSpace(t.Text); text != "" {
				parts = append(parts, text)
			}
			if language == "" && t.Language != "" {
				language = t.Language
			}
		}
		if joined := strings.Join(parts, "\n\n"); joined != "" {
			return []analyze.Segment{{Text: joined}}, language, nil
		}
	}
	text, noteErr := noteBodyText(ctx, st, entryID)
	if noteErr != nil {
		if err != nil {
			return nil, "", fmt.Errorf("worker: transcript: %w", err)
		}
		return nil, "", noteErr
	}
	if strings.TrimSpace(text) == "" {
		return nil, "", errors.New("transcricao indisponivel")
	}
	return []analyze.Segment{{Text: text}}, "", nil
}

// noteBodyText extracts the plain text of the entry's first note document.
func noteBodyText(ctx context.Context, st *store.Store, entryID string) (string, error) {
	notes, err := st.ListNotes(ctx, entryID)
	if err != nil {
		return "", err
	}
	if len(notes) == 0 {
		return "", nil
	}
	return extractText(notes[0].Document), nil
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
