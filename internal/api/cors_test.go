package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCORSFechadoPorPadrao garante que sem DIARY_CORS_ORIGINS a API continua
// como antes: nenhum cabecalho de outra origem.
func TestCORSFechadoPorPadrao(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "https://dashboard.exemplo")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin = %q, want vazio", got)
	}
}

// TestCORSLiberaOrigemConfigurada prova o caso do dashboard hospedado lendo a
// instancia: origem exata recebe o cabecalho e o preflight responde 204.
func TestCORSLiberaOrigemConfigurada(t *testing.T) {
	t.Setenv("DIARY_CORS_ORIGINS", "https://dashboard.exemplo,https://outro.exemplo")
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "https://dashboard.exemplo")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://dashboard.exemplo" {
		t.Fatalf("Allow-Origin = %q, want a origem da lista", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got == "" {
		t.Fatal("Allow-Headers vazio: o navegador nao enviaria Authorization")
	}

	preflight := httptest.NewRequest(http.MethodOptions, "/api/v1/entries", nil)
	preflight.Header.Set("Origin", "https://dashboard.exemplo")
	preflight.Header.Set("Access-Control-Request-Method", http.MethodGet)
	pre := httptest.NewRecorder()
	srv.Handler().ServeHTTP(pre, preflight)
	if pre.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", pre.Code)
	}
	if got := pre.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Fatal("Allow-Methods vazio no preflight")
	}
}

// TestCORSRecusaOrigemForaDaLista: origem desconhecida nao ganha cabecalho, mas
// a requisicao segue (CORS e do navegador, nao do servidor).
func TestCORSRecusaOrigemForaDaLista(t *testing.T) {
	t.Setenv("DIARY_CORS_ORIGINS", "https://dashboard.exemplo")
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "https://site-qualquer.exemplo")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin = %q, want vazio para origem fora da lista", got)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
