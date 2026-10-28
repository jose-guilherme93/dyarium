package analyze

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// revisionServer answers a revision window with the given texts and records the
// payloads it received.
func revisionServer(t *testing.T, texts func(call int, payload map[string]any) []string) (*httptest.Server, *[]map[string]any) {
	t.Helper()
	var calls []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("corpo invalido: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var payload map[string]any
		if len(body.Messages) < 2 {
			t.Errorf("mensagens = %d", len(body.Messages))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if err := json.Unmarshal([]byte(body.Messages[1].Content), &payload); err != nil {
			t.Errorf("payload invalido: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		calls = append(calls, payload)
		result, _ := json.Marshal(map[string]any{
			"comprehension": 80,
			"segments":      texts(len(calls)-1, payload),
		})
		content, _ := json.Marshal(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": string(result)}}},
		})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(content)
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

func TestReviseKeepsOneTextPerSegment(t *testing.T) {
	server, calls := revisionServer(t, func(_ int, payload map[string]any) []string {
		trechos := payload["trechos"].([]any)
		out := make([]string, len(trechos))
		for i, trecho := range trechos {
			out[i] = strings.Replace(trecho.(string), "ne", "ne?", 1)
		}
		return out
	})
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "teste"})
	segments := []Segment{
		{Text: "bom dia ne"},
		{Text: "tudo certo ne"},
		{Text: "ate logo ne"},
	}
	revision, err := NewPipeline(client).Revise(context.Background(), segments, ReviseOptions{Window: 2}, nil)
	if err != nil {
		t.Fatalf("Revise: %v", err)
	}
	if revision.Changed() != 3 {
		t.Fatalf("trechos revisados = %d, queria 3", revision.Changed())
	}
	if revision.Comprehension != 80 {
		t.Fatalf("compreensao = %d, queria 80", revision.Comprehension)
	}
	if len(*calls) != 2 {
		t.Fatalf("chamadas = %d, queria 2", len(*calls))
	}
	// A segunda janela recebe o ultimo trecho da primeira como contexto.
	if got := (*calls)[1]["contexto"]; got != "tudo certo ne?" {
		t.Fatalf("contexto = %v", got)
	}
}

func TestReviseRejectsWindowWithWrongCount(t *testing.T) {
	server, _ := revisionServer(t, func(_ int, _ map[string]any) []string {
		return []string{"uma linha so"}
	})
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "teste"})
	segments := []Segment{{Text: "primeira"}, {Text: "segunda"}}
	if _, err := NewPipeline(client).Revise(context.Background(), segments, ReviseOptions{Window: 2}, nil); err == nil {
		t.Fatal("esperava erro quando o modelo devolve menos trechos que recebeu")
	}
}

func TestReviseKeepsRejectedText(t *testing.T) {
	server, _ := revisionServer(t, func(_ int, payload map[string]any) []string {
		// Troca os numeros: a trava recusa e o original permanece.
		return []string{"foram 9 pessoas no total"}
	})
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "teste"})
	segments := []Segment{{Text: "foram 3 pessoas no total"}}
	revision, err := NewPipeline(client).Revise(context.Background(), segments, ReviseOptions{Window: 1}, nil)
	if err != nil {
		t.Fatalf("Revise: %v", err)
	}
	if revision.Changed() != 0 || revision.Rejected != 1 {
		t.Fatalf("revisados = %d, recusados = %d", revision.Changed(), revision.Rejected)
	}
	if revision.Texts[0] != "" {
		t.Fatalf("texto rejeitado aplicado: %q", revision.Texts[0])
	}
}

func TestReviseLiteralChangesThePrompt(t *testing.T) {
	if !strings.Contains(reviseSystemPrompt("pt", true), "Mantenha hesitacoes") {
		t.Fatal("prompt literal nao pede para manter hesitacoes")
	}
	if !strings.Contains(reviseSystemPrompt("pt", false), "Remova apenas hesitacao") {
		t.Fatal("prompt padrao nao pede para remover hesitacoes")
	}
}

// A janela revisada e publicada antes de a passada terminar: e o que deixa o
// painel mostrar o texto se montando em vez de esperar a transcricao inteira.
func TestReviseReportsEachWindow(t *testing.T) {
	server, _ := revisionServer(t, func(_ int, payload map[string]any) []string {
		trechos := payload["trechos"].([]any)
		out := make([]string, len(trechos))
		for i, trecho := range trechos {
			out[i] = strings.Replace(trecho.(string), "ne", "ne?", 1)
		}
		return out
	})
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "teste"})
	segments := []Segment{{Text: "bom dia ne"}, {Text: "tudo certo ne"}, {Text: "ate logo ne"}}
	type window struct {
		start, end int
		texts      []string
		rejected   int
	}
	var windows []window
	_, err := NewPipeline(client).Revise(context.Background(), segments, ReviseOptions{
		Window: 2,
		OnWindow: func(start, end int, texts []string, rejected int) error {
			windows = append(windows, window{start, end, append([]string(nil), texts...), rejected})
			return nil
		},
	}, nil)
	if err != nil {
		t.Fatalf("Revise: %v", err)
	}
	if len(windows) != 2 {
		t.Fatalf("janelas = %d, queria 2", len(windows))
	}
	if windows[0].start != 0 || windows[0].end != 2 || windows[1].start != 2 || windows[1].end != 3 {
		t.Fatalf("faixas = %+v", windows)
	}
	if windows[0].texts[0] != "bom dia ne?" || windows[0].texts[1] != "tudo certo ne?" {
		t.Fatalf("primeira janela = %v", windows[0].texts)
	}
	if windows[1].texts[0] != "ate logo ne?" {
		t.Fatalf("segunda janela = %v", windows[1].texts)
	}
	if windows[0].rejected != 0 || windows[1].rejected != 0 {
		t.Fatalf("recusados = %+v", windows)
	}
}

// Uma janela recusada ainda avisa quem grava, com a contagem acumulada: o painel
// precisa distinguir "ficou sem revisao" de "terminou sem nada".
func TestReviseReportsRejectedWindow(t *testing.T) {
	server, _ := revisionServer(t, func(call int, payload map[string]any) []string {
		if call == 1 {
			return []string{"uma linha so"}
		}
		trechos := payload["trechos"].([]any)
		out := make([]string, len(trechos))
		for i, trecho := range trechos {
			out[i] = strings.Replace(trecho.(string), "ne", "ne?", 1)
		}
		return out
	})
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "teste"})
	segments := []Segment{{Text: "bom dia ne"}, {Text: "tudo certo ne"}, {Text: "ate logo ne"}, {Text: "foi isso ne"}}
	var last struct {
		texts    []string
		rejected int
	}
	_, err := NewPipeline(client).Revise(context.Background(), segments, ReviseOptions{
		Window: 2,
		OnWindow: func(_ int, _ int, texts []string, rejected int) error {
			last.texts = append([]string(nil), texts...)
			last.rejected = rejected
			return nil
		},
	}, nil)
	if err != nil {
		t.Fatalf("Revise: %v", err)
	}
	if last.rejected != 2 {
		t.Fatalf("recusados = %d, queria 2", last.rejected)
	}
	if last.texts[0] != "" || last.texts[1] != "" {
		t.Fatalf("janela recusada deveria seguir crua: %v", last.texts)
	}
}

// Se a gravacao da janela falha, a passada para: nao adianta revisar o resto
// para jogar fora.
func TestReviseAbortsWhenWindowSaveFails(t *testing.T) {
	server, _ := revisionServer(t, func(_ int, payload map[string]any) []string {
		trechos := payload["trechos"].([]any)
		out := make([]string, len(trechos))
		for i, trecho := range trechos {
			out[i] = trecho.(string) + "!"
		}
		return out
	})
	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "teste"})
	_, err := NewPipeline(client).Revise(context.Background(), []Segment{{Text: "um"}, {Text: "dois"}},
		ReviseOptions{Window: 1, OnWindow: func(int, int, []string, int) error {
			return context.Canceled
		}}, nil)
	if err == nil {
		t.Fatal("a passada deveria abortar quando a gravacao falha")
	}
}
