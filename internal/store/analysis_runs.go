package store

import (
	"context"
	"fmt"
	"time"
)

// AnalysisRun is one attempt of the analysis pipeline. It is append-only and
// stores measurements only, never note content. Local app runs use the same
// shape in the app SQLite; server runs live here.
type AnalysisRun struct {
	ID                   string
	EntryID              string
	AnalysisID           string
	AttachmentID         string
	Runtime              string
	Provider             string
	Model                string
	Attempt              int
	Outcome              string
	ErrorClass           string
	StartedAt            time.Time
	FinishedAt           time.Time
	DurationMS           int64
	InputTextChars       int
	InputTranscriptChars int
	InputImages          int
	PromptTokens         int
	CompletionTokens     int
	TokensPerSecond      float64
	Threads              *int
	BatteryDeltaPct      *float64
}

// AnalysisRunAggregate is the summary of a group of runs (one model or all).
type AnalysisRunAggregate struct {
	Runtime         string
	Provider        string
	Model           string
	Runs            int
	OK              int
	Failed          int
	Fallback        int
	SuccessRate     float64
	SimplifiedRate  float64
	AvgDurationMS   float64
	TokensPerSecond float64
}

// AnalysisRunSummary is the diagnostics aggregate over a time window.
type AnalysisRunSummary struct {
	Since  time.Time
	Totals AnalysisRunAggregate
	Models []AnalysisRunAggregate
}

// SaveAnalysisRun appends one attempt. The job handler calls it on success and
// on failure; a metrics failure must never fail the analysis itself.
func (s *Store) SaveAnalysisRun(ctx context.Context, run AnalysisRun) error {
	if run.ID == "" {
		run.ID = newID()
	}
	if run.StartedAt.IsZero() {
		run.StartedAt = nowUTC()
	}
	if run.FinishedAt.IsZero() {
		run.FinishedAt = run.StartedAt
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO analysis_runs (
			id, entry_id, analysis_id, attachment_id, runtime, provider, model,
			attempt, outcome, error_class, started_at, finished_at, duration_ms,
			input_text_chars, input_transcript_chars, input_images,
			prompt_tokens, completion_tokens, tokens_per_second, threads,
			battery_delta_pct, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID, run.EntryID, nullText(run.AnalysisID), nullText(run.AttachmentID),
		run.Runtime, run.Provider, run.Model, run.Attempt, run.Outcome,
		nullText(run.ErrorClass), ts(run.StartedAt), ts(run.FinishedAt),
		run.DurationMS, run.InputTextChars, run.InputTranscriptChars, run.InputImages,
		run.PromptTokens, run.CompletionTokens, run.TokensPerSecond, run.Threads,
		run.BatteryDeltaPct, ts(nowUTC()))
	if err != nil {
		return fmt.Errorf("store: save analysis run: %w", err)
	}
	return nil
}

// AnalysisRunSummary aggregates the runs started at or after `since`, by
// runtime/provider/model. Success means outcome "ok"; a lexical fallback is
// counted separately and never as success.
func (s *Store) AnalysisRunSummary(ctx context.Context, since time.Time) (AnalysisRunSummary, error) {
	summary := AnalysisRunSummary{Since: since, Models: make([]AnalysisRunAggregate, 0)}
	rows, err := s.db.QueryContext(ctx, `
		SELECT runtime, provider, model,
			COUNT(*),
			COALESCE(SUM(CASE WHEN outcome = 'ok' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN outcome = 'fallback' THEN 1 ELSE 0 END), 0),
			COALESCE(AVG(CASE WHEN outcome = 'ok' THEN duration_ms END), 0),
			COALESCE(SUM(CASE WHEN outcome = 'ok' THEN completion_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN outcome = 'ok' THEN duration_ms ELSE 0 END), 0)
		FROM analysis_runs
		WHERE started_at >= ?
		GROUP BY runtime, provider, model
		ORDER BY COUNT(*) DESC, runtime, provider, model`, ts(since))
	if err != nil {
		return summary, fmt.Errorf("store: analysis run summary: %w", err)
	}
	defer rows.Close()

	var okRuns int
	var durationOKMS float64
	var completionTokens float64
	var durationSum float64
	for rows.Next() {
		var agg AnalysisRunAggregate
		var runs, ok, fallback int
		var avgDuration, completionOK, durationMS float64
		if err := rows.Scan(
			&agg.Runtime, &agg.Provider, &agg.Model, &runs, &ok, &fallback,
			&avgDuration, &completionOK, &durationMS,
		); err != nil {
			return summary, fmt.Errorf("store: scan analysis run summary: %w", err)
		}
		agg.Runs = runs
		agg.OK = ok
		agg.Fallback = fallback
		agg.Failed = runs - ok - fallback
		agg.SuccessRate = ratio(ok, runs)
		agg.SimplifiedRate = ratio(fallback, runs)
		agg.AvgDurationMS = avgDuration
		if durationMS > 0 {
			agg.TokensPerSecond = completionOK * 1000 / durationMS
		}
		summary.Models = append(summary.Models, agg)

		summary.Totals.Runs += runs
		summary.Totals.OK += ok
		summary.Totals.Fallback += fallback
		summary.Totals.Failed += runs - ok - fallback
		durationSum += avgDuration * float64(ok)
		okRuns += ok
		completionTokens += completionOK
		durationOKMS += durationMS
	}
	if err := rows.Err(); err != nil {
		return summary, fmt.Errorf("store: analysis run summary rows: %w", err)
	}

	summary.Totals.SuccessRate = ratio(summary.Totals.OK, summary.Totals.Runs)
	summary.Totals.SimplifiedRate = ratio(summary.Totals.Fallback, summary.Totals.Runs)
	if okRuns > 0 {
		summary.Totals.AvgDurationMS = durationSum / float64(okRuns)
	}
	if durationOKMS > 0 {
		summary.Totals.TokensPerSecond = completionTokens * 1000 / durationOKMS
	}
	return summary, nil
}

func ratio(part, total int) float64 {
	if total <= 0 {
		return 0
	}
	return float64(part) / float64(total)
}
