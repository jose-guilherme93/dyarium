package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestActivitiesListsFinishedProcesses(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	entry := store.Entry{
		ID: "e1", Title: "Reunião de segunda", Status: store.EntryReady, Source: "audio",
		CreatedAt: now.Add(-time.Hour), UpdatedAt: now,
	}
	if err := srv.deps.Store.CreateEntry(ctx, entry); err != nil {
		t.Fatalf("entry: %v", err)
	}
	// Entrada apagada nao entra no menu.
	if err := srv.deps.Store.CreateEntry(ctx, store.Entry{
		ID: "e2", Title: "apagada", Status: store.EntryReady, Source: "audio",
		CreatedAt: now, UpdatedAt: now, DeletedAt: &now,
	}); err != nil {
		t.Fatalf("deleted entry: %v", err)
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t1", EntryID: "e1", Model: "whisper", Text: "fala",
		CreatedAt: now.Add(-2 * time.Minute),
	}, nil); err != nil {
		t.Fatalf("transcript: %v", err)
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t2", EntryID: "e2", Model: "whisper", Text: "apagada",
		CreatedAt: now,
	}, nil); err != nil {
		t.Fatalf("deleted transcript: %v", err)
	}
	for _, run := range []store.AnalysisRun{
		{
			ID: "r1", EntryID: "e1", Runtime: "server", Provider: "openai", Model: "m",
			Outcome: "ok", StartedAt: now.Add(-90 * time.Second), FinishedAt: now.Add(-time.Minute),
		},
		{
			ID: "r2", EntryID: "e1", Runtime: "server", Provider: "openai", Model: "m",
			Outcome: "error", ErrorClass: "rate_limit",
			StartedAt: now.Add(-30 * time.Second), FinishedAt: now.Add(-20 * time.Second),
		},
	} {
		if err := srv.deps.Store.SaveAnalysisRun(ctx, run); err != nil {
			t.Fatalf("run %s: %v", run.ID, err)
		}
	}

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/activities", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	activities, _ := body["activities"].([]any)
	if len(activities) != 2 {
		t.Fatalf("atividades = %+v, queria transcricao + analise", body["activities"])
	}
	first, _ := activities[0].(map[string]any)
	if first["kind"] != "analysis" || first["entry_id"] != "e1" ||
		first["title"] != "Reunião de segunda" {
		t.Fatalf("primeira atividade = %v", first)
	}
	second, _ := activities[1].(map[string]any)
	if second["kind"] != "transcription" || second["entry_id"] != "e1" {
		t.Fatalf("segunda atividade = %v", second)
	}

	rec, body = doJSON(t, srv, http.MethodGet, "/api/v1/activities?limit=1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("limit status = %d", rec.Code)
	}
	if activities, _ := body["activities"].([]any); len(activities) != 1 {
		t.Fatalf("limite ignorado: %+v", body["activities"])
	}
}
