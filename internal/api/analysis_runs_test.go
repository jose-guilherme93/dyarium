package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestAnalysisRunsSummary(t *testing.T) {
	srv := newTestServer(t)
	const entryID = "run_01J8Z000000000000000000A"
	seedEntryWithNote(t, srv, entryID)

	now := time.Now().UTC()
	runs := []store.AnalysisRun{
		{
			EntryID: entryID, Runtime: "server", Provider: "openai", Model: "m", Attempt: 1,
			Outcome: "ok", StartedAt: now.Add(-time.Minute), FinishedAt: now.Add(-time.Minute).Add(time.Second),
			DurationMS: 1000, PromptTokens: 10, CompletionTokens: 20,
		},
		{
			EntryID: entryID, Runtime: "server", Provider: "openai", Model: "m", Attempt: 2,
			Outcome: "error", ErrorClass: "rate_limit",
			StartedAt: now.Add(-2 * time.Minute), FinishedAt: now.Add(-2 * time.Minute),
		},
		{
			EntryID: entryID, Runtime: "server", Provider: "openai", Model: "m", Attempt: 1,
			Outcome: "fallback", StartedAt: now.Add(-3 * time.Minute), FinishedAt: now.Add(-3 * time.Minute),
		},
	}
	for _, run := range runs {
		if err := srv.deps.Store.SaveAnalysisRun(context.Background(), run); err != nil {
			t.Fatalf("save run: %v", err)
		}
	}

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/analysis/runs/summary?days=30", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body["days"] != float64(30) {
		t.Fatalf("days = %v, want 30", body["days"])
	}
	totals, _ := body["totals"].(map[string]any)
	if totals["runs"] != float64(3) || totals["ok"] != float64(1) ||
		totals["failed"] != float64(1) || totals["fallback"] != float64(1) {
		t.Fatalf("totals = %v", totals)
	}
	if totals["success_rate"] != 1.0/3.0 {
		t.Fatalf("success_rate = %v", totals["success_rate"])
	}
	models, _ := body["models"].([]any)
	if len(models) != 1 {
		t.Fatalf("models = %v, want 1", models)
	}
	model, _ := models[0].(map[string]any)
	if model["model"] != "m" || model["runs"] != float64(3) {
		t.Fatalf("model = %v", model)
	}
}

func TestAnalysisRunsSummaryEmptyIsArray(t *testing.T) {
	srv := newTestServer(t)
	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/analysis/runs/summary", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	models, ok := body["models"].([]any)
	if !ok {
		t.Fatalf("models deveria ser uma lista: %v", body["models"])
	}
	if len(models) != 0 {
		t.Fatalf("models = %v, want 0", models)
	}
}
