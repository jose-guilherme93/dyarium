package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/joseti/dyarium/internal/analyze"
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
	if _, err := s.queue.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:"+entry.ID, jobs.TranscribePayload{EntryID: entry.ID}); err != nil {
		return "", err
	}
	_ = s.store.UpdateEntryStatus(ctx, entry.ID, store.EntryQueued)
	s.bus.Publish("entry.status", map[string]string{"entry_id": entry.ID, "status": store.EntryQueued})
	return entry.ID, nil
}

// transcribeHandler runs the transcription pipeline and, on success, either
// enqueues analysis or marks the entry ready.
func transcribeHandler(st *store.Store, pipeline *transcribe.Pipeline, analyzer *analyze.Client, queue *jobs.Queue, bus *events.Bus, logger *slog.Logger) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job, heartbeat func() error) error {
		var payload jobs.TranscribePayload
		if err := jobs.DecodePayload(job, &payload); err != nil {
			return err
		}
		if err := pipeline.Run(ctx, payload.EntryID, heartbeat); err != nil {
			_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
			bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": err.Error()})
			return err
		}
		bus.Publish("transcript.ready", map[string]string{"entry_id": payload.EntryID})
		if analyzer != nil && analyzer.Enabled() {
			if _, err := queue.Enqueue(ctx, jobs.TypeAnalyze, "analyze:"+payload.EntryID, jobs.AnalyzePayload{EntryID: payload.EntryID}); err != nil {
				logger.Error("worker: enfileirar analise", "erro", err)
			}
			_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryAnalyzing)
			bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryAnalyzing})
			return nil
		}
		_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryReady)
		bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryReady})
		return nil
	}
}

// analyzeHandler enriches a transcript and stores the analysis.
func analyzeHandler(st *store.Store, analyzer *analyze.Client, bus *events.Bus, logger *slog.Logger) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job, _ func() error) error {
		var payload jobs.AnalyzePayload
		if err := jobs.DecodePayload(job, &payload); err != nil {
			return err
		}
		if analyzer == nil || !analyzer.Enabled() {
			return analyze.ErrDisabled
		}
		transcript, _, err := st.GetTranscript(ctx, payload.EntryID)
		if err != nil {
			return fmt.Errorf("worker: transcript: %w", err)
		}
		result, err := analyzer.Analyze(ctx, transcript.Text)
		if err != nil {
			_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryFailed)
			bus.Publish("entry.failed", map[string]string{"entry_id": payload.EntryID, "reason": err.Error()})
			return err
		}
		emotions, _ := json.Marshal(result.Emotions)
		people, _ := json.Marshal(result.People)
		places, _ := json.Marshal(result.Places)
		analysis := store.Analysis{
			ID:        id.New(),
			EntryID:   payload.EntryID,
			Model:     result.Model,
			Sentiment: result.Sentiment,
			Emotions:  string(emotions),
			People:    string(people),
			Places:    string(places),
			Summary:   result.Summary,
			Raw:       result.Raw,
			CreatedAt: time.Now().UTC(),
		}
		if err := st.SaveAnalysis(ctx, analysis); err != nil {
			return err
		}
		_ = st.UpdateEntryStatus(ctx, payload.EntryID, store.EntryReady)
		bus.Publish("analysis.ready", map[string]string{"entry_id": payload.EntryID})
		bus.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryReady})
		logger.Info("worker: analise concluida", "entry_id", payload.EntryID)
		return nil
	}
}
