package analyze_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/joseti/dyarium/internal/analyze"
)

const richResponse = `{"sentiment":{"score":0.6,"label":"positivo"},
 "emotions":[{"name":"alegria","intensity":0.8}],
 "people":[{"name":"Ana","count":3,"relation":"irma","sentiment":0.5}],
 "places":[{"name":"Recife","count":2}],
 "themes":[{"name":"familia","confidence":0.9}],
 "summary":"Dia produtivo.",
 "key_moments":[{"start_ms":12000,"text":"comecei cedo"}],
 "questions":["devo continuar?"],
 "decisions":["vou treinar mais"]}`

func analysisServer(t *testing.T, inspect func(r *http.Request, body map[string]any)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if inspect != nil {
			inspect(r, body)
		}
		resp := map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": richResponse}},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
}

func TestAnalyzeParsesRichResponse(t *testing.T) {
	server := analysisServer(t, nil)
	defer server.Close()

	client := analyze.New(analyze.Config{Enabled: true, BaseURL: server.URL, Model: "llama"})
	result, err := client.Analyze(context.Background(), "texto da transcricao")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if result.Sentiment.Score != 0.6 || result.Sentiment.Label != "positivo" {
		t.Fatalf("sentiment = %+v", result.Sentiment)
	}
	if len(result.Emotions) != 1 || result.Emotions[0].Name != "alegria" || result.Emotions[0].Intensity != 0.8 {
		t.Fatalf("emotions = %+v", result.Emotions)
	}
	if len(result.People) != 1 || result.People[0].Name != "Ana" || result.People[0].Relation != "irma" {
		t.Fatalf("people = %+v", result.People)
	}
	if len(result.Themes) != 1 || result.Themes[0].Name != "familia" {
		t.Fatalf("themes = %+v", result.Themes)
	}
	if len(result.KeyMoments) != 1 || result.KeyMoments[0].StartMS != 12000 {
		t.Fatalf("key moments = %+v", result.KeyMoments)
	}
	if result.Model != "llama" || result.Raw == "" {
		t.Fatalf("model/raw nao preenchidos: %q / %q", result.Model, result.Raw)
	}
}

func TestAnalyzeUsesPreferredThemes(t *testing.T) {
	var gotSystem string
	server := analysisServer(t, func(_ *http.Request, body map[string]any) {
		if messages, ok := body["messages"].([]any); ok && len(messages) > 0 {
			if first, ok := messages[0].(map[string]any); ok {
				gotSystem, _ = first["content"].(string)
			}
		}
	})
	defer server.Close()

	client := analyze.New(analyze.Config{
		Enabled: true, BaseURL: server.URL, Model: "llama",
		Themes: []string{"trabalho", "casa"},
	})
	if _, err := client.Analyze(context.Background(), "texto"); err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if !strings.Contains(gotSystem, "trabalho, casa") {
		t.Fatalf("prompt nao contem os temas configurados: %q", gotSystem)
	}
}

func TestAnalyzeFallsBackToJSONObject(t *testing.T) {
	var attempts int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		format, _ := body["response_format"].(map[string]any)
		if format["type"] == "json_schema" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"json_schema nao suportado"}}`))
			return
		}
		resp := map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": richResponse}}},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := analyze.New(analyze.Config{Enabled: true, BaseURL: server.URL, Model: "llama"})
	if _, err := client.Analyze(context.Background(), "texto"); err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("tentativas = %d, queria 2 (schema + fallback)", attempts)
	}
}

func TestListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer chave" {
			t.Errorf("authorization = %q", got)
		}
		resp := map[string]any{
			"data": []map[string]string{{"id": "modelo-a"}, {"id": "modelo-b"}, {"id": "modelo-a"}},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := analyze.New(analyze.Config{BaseURL: server.URL, APIKey: "chave"})
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 2 || models[0] != "modelo-a" || models[1] != "modelo-b" {
		t.Fatalf("models = %v", models)
	}
}

func TestParseModelRef(t *testing.T) {
	cases := map[string][2]string{
		"opencode-go/qwen3.8-flash": {"opencode-go", "qwen3.8-flash"},
		"deepseek-chat":             {"", "deepseek-chat"},
		"":                          {"", ""},
	}
	for in, want := range cases {
		providerID, modelID := analyze.ParseModelRef(in)
		if providerID != want[0] || modelID != want[1] {
			t.Fatalf("ParseModelRef(%q) = %q,%q; queria %q,%q", in, providerID, modelID, want[0], want[1])
		}
	}
}

func TestOpenCodeGenerate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/experimental/generate" {
			t.Errorf("path = %s", r.URL.Path)
		}
		wantAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("opencode:segredo"))
		if got := r.Header.Get("Authorization"); got != wantAuth {
			t.Errorf("authorization = %q", got)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["prompt"].(string); !ok {
			t.Errorf("prompt ausente: %v", body)
		}
		model, _ := body["model"].(map[string]any)
		if model["providerID"] != "opencode-go" || model["id"] != "qwen3.8-flash" {
			t.Errorf("model = %v", model)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"text": richResponse}})
	}))
	defer server.Close()

	client := analyze.New(analyze.Config{
		Enabled: true, Provider: analyze.ProviderOpenCode,
		BaseURL: server.URL, APIKey: "segredo", Model: "opencode-go/qwen3.8-flash",
	})
	result, err := client.Analyze(context.Background(), "texto")
	if err != nil {
		t.Fatalf("analyze opencode: %v", err)
	}
	if result.Sentiment.Score != 0.6 || len(result.People) != 1 {
		t.Fatalf("resultado = %+v", result)
	}
}

func TestOpenCodeListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/model" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"id": "qwen3.8-flash", "providerID": "opencode-go"},
				{"id": "deepseek-chat", "providerID": "deepseek"},
			},
		})
	}))
	defer server.Close()

	client := analyze.New(analyze.Config{Provider: analyze.ProviderOpenCode, BaseURL: server.URL, APIKey: "segredo"})
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 2 || models[0] != "opencode-go/qwen3.8-flash" || models[1] != "deepseek/deepseek-chat" {
		t.Fatalf("models = %v", models)
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
