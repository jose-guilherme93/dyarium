package ollama

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestEndpoint(t *testing.T) {
	cases := map[string]string{
		"http://ollama:11434/v1":     "http://ollama:11434",
		"http://ollama:11434/v1/":    "http://ollama:11434",
		"http://127.0.0.1:11434":     "http://127.0.0.1:11434",
		"  http://ollama:11434/v1  ": "http://ollama:11434",
		"":                           "",
	}
	for input, want := range cases {
		if got := Endpoint(input); got != want {
			t.Errorf("Endpoint(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestValidModel(t *testing.T) {
	for _, name := range []string{"qwen2.5:0.5b", "llama3.2", "hf.co/user/model:q4", "qwen3.8-flash"} {
		if !ValidModel(name) {
			t.Errorf("ValidModel(%q) = false", name)
		}
	}
	for _, name := range []string{"", " ", "model with space", "model;rm", "../etc/passwd"} {
		if ValidModel(name) {
			t.Errorf("ValidModel(%q) = true", name)
		}
	}
}

func TestTagsListsInstalledModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/tags" {
			t.Errorf("path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"models":[{"name":"qwen2.5:0.5b"},{"name":"llama3.2"},{"name":"qwen2.5:0.5b"}]}`))
	}))
	defer server.Close()

	models, err := Tags(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("Tags: %v", err)
	}
	if len(models) != 2 || models[0] != "qwen2.5:0.5b" || models[1] != "llama3.2" {
		t.Fatalf("models = %v", models)
	}
	if !HasModel(models, "llama3.2") || HasModel(models, "outro") {
		t.Fatalf("HasModel errado para %v", models)
	}
}

func TestPullReportsProgressUntilSuccess(t *testing.T) {
	var gotName string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/pull" {
			t.Errorf("path = %q", r.URL.Path)
		}
		var body struct {
			Name   string `json:"name"`
			Stream bool   `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode: %v", err)
		}
		gotName = body.Name
		if !body.Stream {
			t.Errorf("stream = false, want true")
		}
		encoder := json.NewEncoder(w)
		for _, event := range []map[string]any{
			{"status": "pulling manifest"},
			{"status": "downloading", "total": 100, "completed": 50},
			{"status": "success"},
		} {
			_ = encoder.Encode(event)
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}))
	defer server.Close()

	var progress []Progress
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := Pull(ctx, server.URL, "qwen2.5:0.5b", func(p Progress) { progress = append(progress, p) }); err != nil {
		t.Fatalf("Pull: %v", err)
	}
	if gotName != "qwen2.5:0.5b" {
		t.Fatalf("nome enviado = %q", gotName)
	}
	if len(progress) != 3 || progress[1].Total != 100 || progress[1].Completed != 50 {
		t.Fatalf("progresso = %+v", progress)
	}
}

func TestPullSurfacesServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"error":"modelo nao existe"}` + "\n"))
	}))
	defer server.Close()

	err := Pull(context.Background(), server.URL, "nao/existe:1", nil)
	if err == nil || !strings.Contains(err.Error(), "modelo nao existe") {
		t.Fatalf("err = %v", err)
	}
}
