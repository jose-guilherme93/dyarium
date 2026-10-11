package analyze

import "testing"

func TestDecodeAnalysisRepairsTruncated(t *testing.T) {
	cases := []string{
		`{"sentiment": 0.3, "emotions": {"calma": 0.6`,
		`{"sentiment": 0.3, "emotions":`,
		`{"sentiment": 0.1, "people": ["Ana"`,
		`{"sentiment": 0, "places": ["Recife"],`,
		`{"a": 1, "b": {"c":`,
		`{"summary": "texto sem fechar`,
		`aqui vai: {"sentiment": 0.2, "emotions": {"x": 1}, "summary": "ok"`,
	}
	for _, c := range cases {
		if _, err := decodeAnalysis(c); err != nil {
			t.Fatalf("reparo falhou para %q: %v", c, err)
		}
	}
}

func TestDecodeAnalysisKeepsValidObject(t *testing.T) {
	in := "```json\n{\"sentiment\": 0.5, \"summary\": \"ok\"}\n```"
	payload, err := decodeAnalysis(in)
	if err != nil {
		t.Fatalf("falhou para objeto valido %q: %v", in, err)
	}
	if payload.Sentiment != 0.5 || payload.Summary != "ok" {
		t.Fatalf("valores errados: %+v", payload)
	}
}
