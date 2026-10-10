package analyze_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/joseti/dyarium/internal/analyze"
)

func TestAnalyzeParsesResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %s", r.URL.Path)
		}
		content := `{"sentiment":0.6,"emotions":{"alegria":0.8},"people":["Ana"],"places":["Recife"],"summary":"Dia produtivo."}`
		resp := map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": content}},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := analyze.New(analyze.Config{Enabled: true, BaseURL: server.URL, Model: "llama"})
	result, err := client.Analyze(context.Background(), "texto da transcricao")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if result.Sentiment != 0.6 {
		t.Fatalf("sentiment = %v", result.Sentiment)
	}
	if result.Emotions["alegria"] != 0.8 {
		t.Fatalf("emotions = %v", result.Emotions)
	}
	if len(result.People) != 1 || result.People[0] != "Ana" {
		t.Fatalf("people = %v", result.People)
	}
	if result.Summary != "Dia produtivo." {
		t.Fatalf("summary = %q", result.Summary)
	}
}

func TestAnalyzeDisabled(t *testing.T) {
	client := analyze.New(analyze.Config{Enabled: false})
	if client.Enabled() {
		t.Fatal("client deveria estar desligado")
	}
	if _, err := client.Analyze(context.Background(), "x"); err != analyze.ErrDisabled {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
}
