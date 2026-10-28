package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/joseti/dyarium/internal/store"
)

// O clique em "Analisar" e uma promessa: antes de enfileirar, o servidor testa
// o provedor. Chave ou modelo quebrados aparecem na hora, e a nota nao volta
// para "falhou" por causa de uma chamada que nunca teria funcionado.
func TestAnalyzeChecksProviderBeforeQueueing(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	seedPlainEntry(t, srv, "e_preflight")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"invalid api key"}}`)
	}))
	defer provider.Close()
	// O ping usa a configuracao salva, a mesma que a analise vai usar.
	for key, value := range map[string]string{
		"analyze_enabled":  "true",
		"analyze_provider": "openai",
		"analyze_base_url": provider.URL,
		"analyze_api_key":  "chave-invalida",
		"analyze_model":    "modelo",
	} {
		if err := srv.deps.Store.SetSetting(ctx, key, value); err != nil {
			t.Fatalf("setting %s: %v", key, err)
		}
	}

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries/e_preflight/analyze", nil)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, queria 502: %s", rec.Code, rec.Body.String())
	}
	errBody, _ := body["error"].(map[string]any)
	message, _ := errBody["message"].(string)
	if !strings.Contains(message, "chave") {
		t.Fatalf("mensagem = %q (corpo: %v)", message, body)
	}

	entry, err := srv.deps.Store.GetEntry(ctx, "e_preflight")
	if err != nil {
		t.Fatalf("entry: %v", err)
	}
	if entry.Status == store.EntryAnalyzing || entry.Status == store.EntryFailed {
		t.Fatalf("nota mudou de estado sem provedor: %s", entry.Status)
	}
	var queued int
	if err := srv.deps.Store.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM jobs WHERE type = 'analyze'`).Scan(&queued); err != nil {
		t.Fatalf("contar jobs: %v", err)
	}
	if queued != 0 {
		t.Fatalf("enfileirou analise com provedor fora: %d", queued)
	}
}

// Com o provedor respondendo, o clique enfileira e marca a nota como analisando.
func TestAnalyzeQueuesAfterProviderAnswers(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	seedPlainEntry(t, srv, "e_ok")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`)
	}))
	defer provider.Close()
	for key, value := range map[string]string{
		"analyze_enabled":  "true",
		"analyze_provider": "openai",
		"analyze_base_url": provider.URL,
		"analyze_api_key":  "chave",
		"analyze_model":    "modelo",
	} {
		if err := srv.deps.Store.SetSetting(ctx, key, value); err != nil {
			t.Fatalf("setting %s: %v", key, err)
		}
	}

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries/e_ok/analyze", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, queria 202: %s", rec.Code, rec.Body.String())
	}
	if body["status"] != store.EntryAnalyzing {
		t.Fatalf("resposta = %v", body)
	}
	entry, err := srv.deps.Store.GetEntry(ctx, "e_ok")
	if err != nil {
		t.Fatalf("entry: %v", err)
	}
	if entry.Status != store.EntryAnalyzing {
		t.Fatalf("status da nota = %s", entry.Status)
	}
}
