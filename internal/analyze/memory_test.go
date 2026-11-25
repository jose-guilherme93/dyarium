package analyze

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const memoryRichResponse = `{"comprehension":80,"sentiment":{"score":0.1,"label":"neutro"},
 "emotions":[],"people":[],"places":[],"themes":[],"summary":"ok","reading":"","key_moments":[],
 "questions":[],"decisions":[],"tasks":[],"ideas":[],"events":[],"epiphanies":[]}`

func memoryAnalysisServer(t *testing.T, inspect func(system string)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if messages, ok := body["messages"].([]any); ok && len(messages) > 0 {
			if first, ok := messages[0].(map[string]any); ok {
				if content, ok := first["content"].(string); ok && inspect != nil {
					inspect(content)
				}
			}
		}
		resp := map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": memoryRichResponse}},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
}

func TestMemoryBlockRecoversOnlyRelevantNames(t *testing.T) {
	memory := []MemoryEntry{
		{Kind: "place", Name: "Paulo Ramos", Label: "escola", Rejected: []string{"person"}},
		{Kind: "person", Name: "Maria", Aliases: []string{"Mariana"}},
	}
	block := memoryBlock("Fui com Paulo Ramos para a escola.", memory)
	if !strings.Contains(block, "Paulo Ramos: lugar; rotulo \"escola\"; nunca pessoa.") {
		t.Fatalf("linha da entidade ausente: %q", block)
	}
	if strings.Contains(block, "Maria") {
		t.Fatalf("entidade nao mencionada entrou no bloco: %q", block)
	}

	rejectedBlock := memoryBlock("voce nao e pessoa", []MemoryEntry{
		{Name: "voce", Rejected: []string{"person"}},
	})
	if !strings.Contains(rejectedBlock, "voce: nunca pessoa.") {
		t.Fatalf("linha de rejeicao ausente: %q", rejectedBlock)
	}
}

func TestAnalyzeIncludesMemoryBlock(t *testing.T) {
	var gotSystem string
	server := memoryAnalysisServer(t, func(system string) { gotSystem = system })
	defer server.Close()

	client := New(Config{
		Enabled: true, BaseURL: server.URL, Model: "llama",
		Memory: []MemoryEntry{
			{Kind: "place", Name: "Paulo Ramos", Label: "escola", Rejected: []string{"person"}},
			{Kind: "person", Name: "Maria"},
		},
	})
	if _, err := client.Analyze(context.Background(), "Hoje fui com Paulo Ramos."); err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if !strings.Contains(gotSystem, "Paulo Ramos: lugar; rotulo \"escola\"; nunca pessoa.") {
		t.Fatalf("prompt sem a entrada relevante: %q", gotSystem)
	}
	if strings.Contains(gotSystem, "Maria") {
		t.Fatalf("prompt trouxe entidade nao mencionada: %q", gotSystem)
	}
	if !strings.Contains(gotSystem, "use so para nao repetir erro") {
		t.Fatalf("prompt sem a instrucao da memoria: %q", gotSystem)
	}
}

func TestAnalyzeSectionIncludesMemoryBlockFromSectionText(t *testing.T) {
	var gotSystem string
	server := memoryAnalysisServer(t, func(system string) { gotSystem = system })
	defer server.Close()

	client := New(Config{
		Enabled: true, BaseURL: server.URL, Model: "llama",
		Memory: []MemoryEntry{
			{Kind: "place", Name: "Paulo Ramos", Rejected: []string{"person"}},
		},
	})
	section := Section{Heading: "Chegada", Kind: "transcript", Text: "Paulo Ramos chegou cedo."}
	if _, err := client.AnalyzeSection(context.Background(), "Titulo", section); err != nil {
		t.Fatalf("analyze section: %v", err)
	}
	if !strings.Contains(gotSystem, "Paulo Ramos: lugar; nunca pessoa.") {
		t.Fatalf("prompt da secao sem a entrada relevante: %q", gotSystem)
	}
}
