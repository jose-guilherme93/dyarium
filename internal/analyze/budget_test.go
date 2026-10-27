package analyze

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Um modelo de raciocinio gasta o teto de tokens pensando e devolve vazio com
// finish_reason "length". Repetir com o mesmo teto produz o mesmo corte: o
// cliente precisa crescer o orcamento, senao a nota fica marcada como falha em
// todas as tentativas.
func TestAnalyzeGrowsTheBudgetWhenReasoningEatsIt(t *testing.T) {
	var budgets []int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MaxTokens int `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("corpo: %v", err)
			return
		}
		budgets = append(budgets, body.MaxTokens)
		w.Header().Set("Content-Type", "application/json")
		if body.MaxTokens < 3000 {
			_, _ = io.WriteString(w, `{"choices":[{"message":{"content":""},"finish_reason":"length"}],`+
				`"usage":{"prompt_tokens":2500,"completion_tokens":1500}}`)
			return
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":`+
			`"{\"comprehension\":70,\"sentiment\":{\"score\":0.1,\"label\":\"neutro\"},\"summary\":\"ok\"}"},`+
			`"finish_reason":"stop"}],"usage":{"prompt_tokens":2500,"completion_tokens":300}}`)
	}))
	defer server.Close()

	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "modelo"})
	result, err := client.Analyze(context.Background(), "texto da nota")
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if result.Summary != "ok" {
		t.Fatalf("resumo = %q", result.Summary)
	}
	if len(budgets) != 2 {
		t.Fatalf("chamadas = %d, queria 2 (a segunda com mais tokens)", len(budgets))
	}
	// O orcamento inicial vem do tamanho do texto, nao de um numero fixo: o
	// limite e o conteudo. A segunda chamada cresce porque a primeira foi cortada.
	if budgets[0] < 2000 || budgets[1] <= budgets[0] {
		t.Fatalf("orcamentos = %v", budgets)
	}
}

// O ping confirma o provedor, nao a resposta: um modelo de raciocinio pode
// devolver conteudo vazio e continuar saudavel.
func TestPingAcceptsAnEmptyAnswer(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":""},"finish_reason":"length"}]}`)
	}))
	defer server.Close()
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "modelo"})
	if err := client.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	// O ping nao pede formato: exigir json_object sem a palavra "json" no prompt
	// faz o provedor recusar com 400 e o ping acusa a IA errada.
	if _, ok := body["response_format"]; ok {
		t.Fatalf("ping pediu formato de resposta: %v", body["response_format"])
	}
}

// Chave errada tem que aparecer no clique, nao depois de a nota falhar.
func TestPingReportsProviderFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"invalid api key"}}`)
	}))
	defer server.Close()
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "modelo"})
	if err := client.Ping(context.Background()); err == nil {
		t.Fatal("Ping deveria falhar com 401")
	}
}

// A nota e lida secao por secao e depois sintetizada: dois titulos viram duas
// leituras + uma sintese, e a analise da nota liga as duas.
func TestRunSectionsAnalyzesEachSectionAndSynthesizes(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("corpo: %v", err)
			return
		}
		user := body.Messages[len(body.Messages)-1].Content
		calls = append(calls, user)
		var answer map[string]any
		if strings.Contains(user, `"secoes"`) {
			answer = map[string]any{
				"summary":   "sintese da nota",
				"reading":   "leitura da nota inteira",
				"sentiment": map[string]any{"score": 0.5, "label": "positivo"},
				"themes":    []any{map[string]any{"name": "trabalho", "confidence": 0.9}},
			}
		} else {
			answer = map[string]any{
				"comprehension": 80,
				"sentiment":     map[string]any{"score": 0.2, "label": "neutro"},
				"summary":       "resumo da secao",
				"reading":       "leitura da secao",
				"themes":        []any{map[string]any{"name": "casa", "confidence": 0.6}},
				"people": []any{map[string]any{
					"name": "Ana", "count": 2, "relation": "irma", "sentiment": 0.4,
				}},
			}
		}
		content, _ := json.Marshal(answer)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": string(content)}}},
		})
	}))
	defer server.Close()
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "modelo"})
	sections := []Section{
		{Heading: "Primeira", Kind: "text", Text: "primeiro trecho escrito"},
		{Heading: "Segunda", Kind: "text", Text: "segundo trecho escrito"},
	}

	result, err := NewPipeline(client).RunSections(context.Background(), "diario", sections, nil)
	if err != nil {
		t.Fatalf("RunSections: %v", err)
	}
	if len(calls) != 3 {
		t.Fatalf("chamadas = %d, queria 2 secoes + 1 sintese", len(calls))
	}
	if len(result.Sections) != 2 {
		t.Fatalf("secoes analisadas = %d", len(result.Sections))
	}
	if result.Sections[0].Heading != "Primeira" || result.Sections[0].Reading != "leitura da secao" {
		t.Fatalf("primeira secao = %+v", result.Sections[0])
	}
	if result.Reading != "leitura da nota inteira" || result.Summary != "sintese da nota" {
		t.Fatalf("sintese = %q / %q", result.Reading, result.Summary)
	}
	if result.Sentiment.Label != "positivo" {
		t.Fatalf("sentimento da sintese = %+v", result.Sentiment)
	}
	if len(result.People) != 1 || result.People[0].Count != 4 {
		t.Fatalf("pessoas somadas = %+v", result.People)
	}
}

// Secao maior que o limite de uma chamada e lida em janelas, sem cortar texto.
func TestRunSectionsWindowsALongSection(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		calls++
		answer := map[string]any{
			"comprehension": 70,
			"sentiment":     map[string]any{"score": 0, "label": "neutro"},
			"summary":       "parte",
			"reading":       "leitura da parte",
		}
		content, _ := json.Marshal(answer)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": string(content)}}},
		})
	}))
	defer server.Close()
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "modelo"})
	long := strings.Repeat("palavra ", 4000) // bem acima de singlePassLimit
	_, err := NewPipeline(client).RunSections(context.Background(), "longa", []Section{
		{Heading: "Longa", Kind: "text", Text: long},
	}, nil)
	if err != nil {
		t.Fatalf("RunSections: %v", err)
	}
	if calls < 3 {
		t.Fatalf("chamadas = %d, queria a secao em janelas + a sintese", calls)
	}
}
