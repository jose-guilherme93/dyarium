package analyze

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildWindowsSinglePass(t *testing.T) {
	segments := []Segment{
		{StartMS: 0, Text: "bom dia"},
		{StartMS: 65000, Text: "boa tarde"},
	}
	windows := buildWindows(segments)
	if len(windows) != 1 {
		t.Fatalf("janelas = %d, queria 1", len(windows))
	}
	if !strings.Contains(windows[0].text, "[00:00] bom dia") || !strings.Contains(windows[0].text, "[01:05] boa tarde") {
		t.Fatalf("texto anotado errado: %q", windows[0].text)
	}
}

func TestBuildWindowsSplitsWithoutCuttingSegments(t *testing.T) {
	var segments []Segment
	for i := 0; i < 200; i++ {
		segments = append(segments, Segment{StartMS: i * 1000, Text: strings.Repeat("palavra ", 20)})
	}
	windows := buildWindows(segments)
	if len(windows) < 2 {
		t.Fatalf("janelas = %d, queria >= 2", len(windows))
	}
	totalParts := 0
	for _, w := range windows {
		for _, line := range strings.Split(w.text, "\n") {
			if !strings.HasPrefix(line, "[") || !strings.Contains(line, "] ") {
				t.Fatalf("linha de segmento incompleta: %q", line)
			}
			totalParts++
		}
	}
	if totalParts != len(segments) {
		t.Fatalf("segmentos preservados = %d, queria %d", totalParts, len(segments))
	}
}

func TestMergeResults(t *testing.T) {
	a := Result{
		Sentiment: Sentiment{Score: 1.0},
		Emotions:  []Emotion{{Name: "alegria", Intensity: 0.4}},
		People:    []Person{{Name: "Ana", Count: 1, Relation: "irma", Sentiment: 0.2}},
		Places:    []Place{{Name: "Recife", Count: 1}},
		Themes:    []Theme{{Name: "familia", Confidence: 0.5}},
		Questions: []string{"devo ir?"},
	}
	b := Result{
		Sentiment:  Sentiment{Score: -1.0},
		Emotions:   []Emotion{{Name: "alegria", Intensity: 0.9}, {Name: "saudade", Intensity: 0.3}},
		People:     []Person{{Name: "ana", Count: 4, Sentiment: -0.7}},
		Places:     []Place{{Name: "recife", Count: 2}},
		Themes:     []Theme{{Name: "familia", Confidence: 0.9}},
		KeyMoments: []KeyMoment{{StartMS: 5000, Text: "x"}},
		Questions:  []string{"devo ir?"},
	}
	merged := mergeResults([]Result{a, b}, []int{1, 3})

	// (1*1 + -1*3) / 4 = -0.5
	if merged.Sentiment.Score != -0.5 || merged.Sentiment.Label != "negativo" {
		t.Fatalf("sentiment = %+v", merged.Sentiment)
	}
	if len(merged.Emotions) != 2 {
		t.Fatalf("emotions = %+v", merged.Emotions)
	}
	for _, e := range merged.Emotions {
		if e.Name == "alegria" && e.Intensity != 0.9 {
			t.Fatalf("alegria deveria ter intensidade maxima: %+v", merged.Emotions)
		}
	}
	if len(merged.People) != 1 || merged.People[0].Count != 5 || merged.People[0].Relation != "irma" {
		t.Fatalf("people = %+v", merged.People)
	}
	if merged.People[0].Sentiment != -0.7 {
		t.Fatalf("sentiment da pessoa deveria vir da mencao mais frequente: %+v", merged.People[0])
	}
	if len(merged.Places) != 1 || merged.Places[0].Count != 3 {
		t.Fatalf("places = %+v", merged.Places)
	}
	if len(merged.Themes) != 1 || merged.Themes[0].Confidence != 0.9 {
		t.Fatalf("themes = %+v", merged.Themes)
	}
	if len(merged.Questions) != 1 {
		t.Fatalf("perguntas duplicadas: %+v", merged.Questions)
	}
}

func TestPipelineRunMergesAndSummarizes(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		messages, _ := body["messages"].([]any)
		system, _ := messages[0].(map[string]any)
		content, _ := system["content"].(string)

		var reply string
		if strings.Contains(content, "resume analises parciais") {
			reply = `{"summary":"resumo unico"}`
		} else {
			reply = `{"sentiment":{"score":0.2,"label":"positivo"},"emotions":[],"people":[],"places":[],"themes":[],"summary":"parte","key_moments":[],"questions":[],"decisions":[]}`
		}
		resp := map[string]any{"choices": []map[string]any{{"message": map[string]string{"content": reply}}}}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := New(Config{Enabled: true, BaseURL: server.URL, Model: "llama"})
	var segments []Segment
	for i := 0; i < 300; i++ {
		segments = append(segments, Segment{StartMS: i * 1000, Text: strings.Repeat("conteudo ", 15)})
	}
	result, err := NewPipeline(client).Run(context.Background(), segments)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if result.Summary != "resumo unico" {
		t.Fatalf("meta-resumo nao aplicado: %q", result.Summary)
	}
	// N janelas + 1 meta-resumo.
	if calls < 3 {
		t.Fatalf("chamadas = %d, queria multiplas janelas + meta-resumo", calls)
	}
}

func TestPipelineRunEmpty(t *testing.T) {
	client := New(Config{Enabled: true, BaseURL: "http://127.0.0.1:0"})
	if _, err := NewPipeline(client).Run(context.Background(), nil); err == nil {
		t.Fatal("esperava erro para transcricao vazia")
	}
}
