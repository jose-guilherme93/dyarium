package analyze

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A analise serve para metrificar (sentimento, emocoes, pessoas, momentos), nao
// para escrever relatorio. O modelo pode devolver texto longo; o cliente corta em
// no maximo duas frases para a leitura e uma para o resumo, sempre em uma linha.
func TestAnalyzeKeepsProseShort(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		answer := map[string]any{
			"comprehension": 90,
			"sentiment":     map[string]any{"score": 0.3, "label": "positivo"},
			"summary":       "O autor fala do trabalho. Depois fala da familia. E termina cansado.",
			"reading":       "Primeira frase sobre o dia.\nSegunda frase sobre o cansaco. Terceira frase que sobra. Quarta frase que sobra.",
			"key_moments":   []any{map[string]any{"start_ms": 1000, "text": "trecho"}},
		}
		content, _ := json.Marshal(answer)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": string(content)}}},
		})
	}))
	defer server.Close()

	result, err := New(Config{Enabled: true, BaseURL: server.URL, Model: "modelo"}).
		Analyze(context.Background(), "texto do dia")
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if result.Reading != "Primeira frase sobre o dia. Segunda frase sobre o cansaco." {
		t.Fatalf("reading = %q", result.Reading)
	}
	if strings.Contains(result.Reading, "\n") {
		t.Fatalf("reading tem quebra de linha: %q", result.Reading)
	}
	if result.Summary != "O autor fala do trabalho." {
		t.Fatalf("summary = %q", result.Summary)
	}
	if len(result.KeyMoments) != 1 || result.Sentiment.Label != "positivo" {
		t.Fatalf("metricas perdidas: %+v", result)
	}
}

// Sem pontuacao, o corte e por tamanho: a leitura nunca passa do limite.
func TestShortenProseCapsBySize(t *testing.T) {
	got := shortenProse(strings.Repeat("palavra ", 100), readingMaxSentences, readingMaxChars)
	if len([]rune(got)) > readingMaxChars+3 {
		t.Fatalf("leitura com %d caracteres", len([]rune(got)))
	}
	if !strings.HasSuffix(got, "...") {
		t.Fatalf("corte sem indicacao: %q", got)
	}
	if shortenProse("  ", readingMaxSentences, readingMaxChars) != "" {
		t.Fatal("texto vazio deveria continuar vazio")
	}
}
