package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/store"
)

// newSetupServer builds a server whose instance has not been claimed yet.
func newSetupServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "diary.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(Deps{
		Config:  config.Config{DataDir: dir},
		Store:   st,
		Logger:  logger,
		Version: Version{Version: "test"},
		Tokens:  NewTokenSource("token-temporario", true),
	})
	return srv, dir
}

func TestSetupStateIsPublic(t *testing.T) {
	srv, _ := newSetupServer(t)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/setup/state", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["required"] != true {
		t.Fatalf("required = %v, want true", body["required"])
	}
}

func TestSetupClaimOpensAccess(t *testing.T) {
	srv, dir := newSetupServer(t)
	handler := srv.Handler()

	// A protected route stays closed while setup is pending.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/version", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("antes do claim: status = %d, want 401", rec.Code)
	}

	// Claim with a token that is too short is rejected.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/setup", strings.NewReader(`{"token":"curto"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("token curto: status = %d, want 400", rec.Code)
	}

	// A valid claim works and persists the token.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/setup", strings.NewReader(`{"token":"token-escolhido"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("claim: status = %d, want 200", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "token")); err != nil {
		t.Fatalf("token nao persistido: %v", err)
	}

	// The chosen token now unlocks the protected routes.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	req.Header.Set("Authorization", "Bearer token-escolhido")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("apos claim: status = %d, want 200", rec.Code)
	}

	// Setup is closed: a second claim is refused.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/setup", strings.NewReader(`{"token":"outro-token"}`)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("segundo claim: status = %d, want 409", rec.Code)
	}
}
