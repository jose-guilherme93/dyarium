package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/crypto"
	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	t.Setenv("DIARY_TOKEN", "token-de-teste")
	t.Setenv("DIARY_MASTER_KEY", strings.Repeat("ab", 32))
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	st, err := store.Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	key, err := crypto.ParseKey(cfg.MasterKey)
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	ing := ingest.New(ingest.Config{
		MaxUploadBytes:     cfg.MaxUploadBytes,
		MaxDurationSeconds: cfg.MaxDurationSeconds,
		AllowedFormats:     cfg.AllowedFormats,
	}, st, key, t.TempDir(), nil)
	return New(Deps{Config: cfg, Store: st, Logger: logger, Version: Version{Version: "test", InstanceID: "instancia-de-teste", SyncContract: SyncContract}, Ingest: ing, Queue: jobs.NewQueue(st.DB())})
}

func TestHealthz(t *testing.T) {
	srv := newTestServer(t)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" || body["version"] != "test" {
		t.Fatalf("unexpected body: %v", body)
	}
}

// TestDashboardKeepsCrossOriginIsolation garante SharedArrayBuffer fora do
// /lab: o botao "neste PC" abre o worker na propria nota, e sem isolamento o
// llama.cpp e o ONNX ficam em uma thread.
func TestDashboardKeepsCrossOriginIsolation(t *testing.T) {
	srv := newTestServer(t)
	handler := srv.Handler()

	cases := []struct {
		path      string
		wantEmbed string
	}{
		{path: "/", wantEmbed: "credentialless"},
		{path: "/notas", wantEmbed: "credentialless"},
		{path: "/lab", wantEmbed: "require-corp"},
		{path: "/lab/", wantEmbed: "require-corp"},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if got := rec.Header().Get("Cross-Origin-Opener-Policy"); got != "same-origin" {
			t.Fatalf("%s: COOP = %q, want same-origin", tc.path, got)
		}
		if got := rec.Header().Get("Cross-Origin-Embedder-Policy"); got != tc.wantEmbed {
			t.Fatalf("%s: COEP = %q, want %q", tc.path, got, tc.wantEmbed)
		}
	}
}

func TestVersionRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	handler := srv.Handler()

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/version", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("without token: status = %d, want 401", rec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	req.Header.Set("Authorization", "Bearer token-de-teste")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("with token: status = %d, want 200", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["instance_id"] != "instancia-de-teste" {
		t.Fatalf("instance_id = %q", body["instance_id"])
	}
	if body["sync_contract"] != SyncContract {
		t.Fatalf("sync_contract = %q, want %q", body["sync_contract"], SyncContract)
	}
}
