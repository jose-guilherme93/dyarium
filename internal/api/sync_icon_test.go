package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestSyncManifestEntryCarriesIcon(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateEntry(ctx, store.Entry{
		ID:        "note_icon",
		Title:     "nota",
		Icon:      "🌿",
		Status:    store.EntryReady,
		Source:    "text",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, authedRequest(http.MethodGet, "/api/v1/sync/manifest?kind=entries", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Items) != 1 {
		t.Fatalf("itens = %d, want 1", len(body.Items))
	}
	if body.Items[0]["icon"] != "🌿" {
		t.Fatalf("icon = %v, want 🌿", body.Items[0]["icon"])
	}
}
