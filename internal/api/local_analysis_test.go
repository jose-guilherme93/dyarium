package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeOllama serves the two endpoints the setup uses. When pulled is not nil,
// it receives the model name of every /api/pull request.
func fakeOllama(t *testing.T, installed []string, pulled chan<- string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			type model struct {
				Name string `json:"name"`
			}
			payload := struct {
				Models []model `json:"models"`
			}{}
			for _, name := range installed {
				payload.Models = append(payload.Models, model{Name: name})
			}
			_ = json.NewEncoder(w).Encode(payload)
		case "/api/pull":
			var body struct {
				Name string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("pull decode: %v", err)
			}
			if pulled != nil {
				pulled <- body.Name
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "success"})
		default:
			http.NotFound(w, r)
		}
	}))
}

// O painel descobre sozinho se o Ollama local esta no ar e quais modelos tem.
func TestLocalAnalysisReportsAvailability(t *testing.T) {
	server := fakeOllama(t, []string{"qwen2.5:0.5b"}, nil)
	defer server.Close()
	t.Setenv("DIARY_OLLAMA_URL", server.URL)

	srv := newTestServer(t)
	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/analyze/local", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	if body["available"] != true {
		t.Fatalf("available = %v", body["available"])
	}
	if body["base_url"] != server.URL+"/v1" {
		t.Fatalf("base_url = %v", body["base_url"])
	}
	models, _ := body["models"].([]any)
	if len(models) != 1 || models[0] != "qwen2.5:0.5b" {
		t.Fatalf("models = %v", body["models"])
	}
}

// Um clique: salva provedor/base/model e, se o modelo nao estiver instalado,
// baixa em segundo plano.
func TestSetupLocalAnalysisSavesSettingsAndDownloadsTheModel(t *testing.T) {
	pulled := make(chan string, 1)
	server := fakeOllama(t, nil, pulled)
	defer server.Close()
	t.Setenv("DIARY_OLLAMA_URL", server.URL)
	t.Setenv("DIARY_OLLAMA_MODEL", "qwen2.5:0.5b")

	srv := newTestServer(t)
	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/analyze/local",
		strings.NewReader(`{"model":"qwen2.5:0.5b"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	if body["status"] != "downloading" {
		t.Fatalf("status = %v, want downloading", body["status"])
	}

	select {
	case name := <-pulled:
		if name != "qwen2.5:0.5b" {
			t.Fatalf("modelo baixado = %q", name)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("o download do modelo nao foi disparado")
	}

	_, settings := doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
	if settings["analyze_enabled"] != true ||
		settings["analyze_provider"] != "openai" ||
		settings["analyze_base_url"] != server.URL+"/v1" ||
		settings["analyze_model"] != "qwen2.5:0.5b" {
		t.Fatalf("settings = %v", settings)
	}

	// O estado do download fica visivel para o painel acompanhar.
	deadline := time.Now().Add(2 * time.Second)
	for {
		_, status := doJSON(t, srv, http.MethodGet, "/api/v1/analyze/local", nil)
		if pull, ok := status["pull"].(map[string]any); ok && pull["done"] == true {
			if pull["model"] != "qwen2.5:0.5b" {
				t.Fatalf("pull = %v", pull)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("download nao terminou: %v", status["pull"])
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// Modelo ja instalado: configura na hora, sem baixar nada.
func TestSetupLocalAnalysisUsesInstalledModel(t *testing.T) {
	pulled := make(chan string, 1)
	server := fakeOllama(t, []string{"qwen2.5:0.5b"}, pulled)
	defer server.Close()
	t.Setenv("DIARY_OLLAMA_URL", server.URL)

	srv := newTestServer(t)
	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/analyze/local",
		strings.NewReader(`{"model":"qwen2.5:0.5b"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	if body["status"] != "ready" || body["installed"] != true {
		t.Fatalf("body = %v", body)
	}
	select {
	case name := <-pulled:
		t.Fatalf("nao deveria baixar, mas pediu %q", name)
	case <-time.After(200 * time.Millisecond):
	}
}

// Sem Ollama no ar, a resposta e generica e nada e salvo: melhor recusar do que
// deixar a analise apontando para um servidor que nao existe.
func TestSetupLocalAnalysisWithoutOllamaDoesNotSave(t *testing.T) {
	t.Setenv("DIARY_OLLAMA_URL", "http://127.0.0.1:1")

	srv := newTestServer(t)
	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/analyze/local",
		strings.NewReader(`{"model":"qwen2.5:0.5b"}`))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != "local_unavailable" {
		t.Fatalf("erro = %v", errObj)
	}
	_, settings := doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
	if settings["analyze_enabled"] != false {
		t.Fatalf("analyze_enabled = %v, nao deveria ter ligado", settings["analyze_enabled"])
	}
}
