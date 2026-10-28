package store

import (
	"context"
	"testing"
	"time"
)

func TestAnalysisRunSummary(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC().Truncate(time.Second)
	seedEntry(t, s, "e1", now)

	runs := []AnalysisRun{
		{
			EntryID: "e1", Runtime: "server", Provider: "openai", Model: "m1", Attempt: 1,
			Outcome: "ok", StartedAt: now.Add(-2 * time.Minute), FinishedAt: now.Add(-2 * time.Minute).Add(time.Second),
			DurationMS: 1000, CompletionTokens: 100,
		},
		{
			EntryID: "e1", Runtime: "server", Provider: "openai", Model: "m1", Attempt: 1,
			Outcome: "ok", StartedAt: now.Add(-3 * time.Minute), FinishedAt: now.Add(-3 * time.Minute).Add(3 * time.Second),
			DurationMS: 3000, CompletionTokens: 300,
		},
		{
			EntryID: "e1", Runtime: "server", Provider: "openai", Model: "m1", Attempt: 1,
			Outcome: "fallback", StartedAt: now.Add(-4 * time.Minute), FinishedAt: now.Add(-4 * time.Minute),
		},
		{
			EntryID: "e1", Runtime: "server", Provider: "openai", Model: "m1", Attempt: 1,
			Outcome: "error", ErrorClass: "rate_limit",
			StartedAt: now.Add(-5 * time.Minute), FinishedAt: now.Add(-5 * time.Minute).Add(500 * time.Millisecond),
			DurationMS: 500,
		},
		{
			EntryID: "e1", Runtime: "local", Provider: "llama.cpp", Model: "m2", Attempt: 1,
			Outcome: "ok", StartedAt: now.Add(-6 * time.Minute), FinishedAt: now.Add(-6 * time.Minute).Add(2 * time.Second),
			DurationMS: 2000, CompletionTokens: 50, BatteryDeltaPct: floatPtr(2),
		},
	}
	for _, run := range runs {
		if err := s.SaveAnalysisRun(ctx, run); err != nil {
			t.Fatalf("save run: %v", err)
		}
	}

	summary, err := s.AnalysisRunSummary(ctx, now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if summary.Totals.Runs != 5 || summary.Totals.OK != 3 || summary.Totals.Fallback != 1 || summary.Totals.Failed != 1 {
		t.Fatalf("totais = %+v", summary.Totals)
	}
	if summary.Totals.SuccessRate != 0.6 || summary.Totals.SimplifiedRate != 0.2 {
		t.Fatalf("taxas = %+v", summary.Totals)
	}
	if summary.Totals.AvgDurationMS != 2000 {
		t.Fatalf("duracao media = %v, want 2000", summary.Totals.AvgDurationMS)
	}
	if summary.Totals.TokensPerSecond != 75 {
		t.Fatalf("tokens/s = %v, want 75", summary.Totals.TokensPerSecond)
	}
	if len(summary.Models) != 2 {
		t.Fatalf("modelos = %d, want 2", len(summary.Models))
	}
	for _, model := range summary.Models {
		switch model.Model {
		case "m1":
			if model.Runs != 4 || model.OK != 2 || model.Fallback != 1 || model.Failed != 1 {
				t.Fatalf("m1 = %+v", model)
			}
			if model.SuccessRate != 0.5 || model.SimplifiedRate != 0.25 {
				t.Fatalf("m1 taxas = %+v", model)
			}
			if model.AvgDurationMS != 2000 || model.TokensPerSecond != 100 {
				t.Fatalf("m1 medidas = %+v", model)
			}
		case "m2":
			if model.Runs != 1 || model.OK != 1 || model.Failed != 0 || model.Fallback != 0 {
				t.Fatalf("m2 = %+v", model)
			}
		default:
			t.Fatalf("modelo inesperado: %+v", model)
		}
	}

	empty, err := s.AnalysisRunSummary(ctx, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("summary vazia: %v", err)
	}
	if empty.Totals.Runs != 0 || len(empty.Models) != 0 {
		t.Fatalf("janela futura deveria estar vazia: %+v", empty)
	}
}
