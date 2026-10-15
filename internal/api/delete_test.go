package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

func TestDeleteEntryEnqueuesCleanup(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	entry := store.Entry{ID: id.New(), Title: "nota", Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}
	if err := srv.deps.Store.CreateEntry(ctx, entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/entries/"+entry.ID, nil)
	req.Header.Set("Authorization", "Bearer token-de-teste")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}

	var count int
	if err := srv.deps.Store.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM jobs WHERE idempotency_key = ? AND type = ?`,
		"cleanup:"+entry.ID, "cleanup").Scan(&count); err != nil {
		t.Fatalf("query job: %v", err)
	}
	if count != 1 {
		t.Fatalf("jobs de limpeza = %d, want 1", count)
	}
}

func TestDeleteMissingEntryReturnsNotFound(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/entries/en_inexistente", nil)
	req.Header.Set("Authorization", "Bearer token-de-teste")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
