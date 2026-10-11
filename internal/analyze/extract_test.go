package analyze

import "testing"

func TestDecodeRepairsTruncated(t *testing.T) {
	cases := []string{
		`{"sentiment": {"score": 0.3, "label": "positivo"}, "emotions": [{"name": "calma", "intensity": 0.6`,
		`{"sentiment": {"score": 0.3, "label": "positivo"}, "emotions":`,
		`{"sentiment": {"score": 0.1}, "people": [{"name": "Ana"`,
		`{"sentiment": {"score": 0}, "places": [{"name": "Recife", "count": 1}],`,
		`{"summary": "texto sem fechar`,
		`aqui vai: {"sentiment": {"score": 0.2}, "emotions": [{"name": "x", "intensity": 1}], "summary": "ok"`,
	}
	for _, c := range cases {
		if _, err := decodeJSONRepair[Result](c); err != nil {
			t.Fatalf("reparo falhou para %q: %v", c, err)
		}
	}
}

func TestDecodeKeepsValidObject(t *testing.T) {
	in := "```json\n{\"sentiment\": {\"score\": 0.5, \"label\": \"positivo\"}, \"summary\": \"ok\"}\n```"
	result, err := decodeJSONRepair[Result](in)
	if err != nil {
		t.Fatalf("falhou para objeto valido %q: %v", in, err)
	}
	if result.Sentiment.Score != 0.5 || result.Summary != "ok" {
		t.Fatalf("valores errados: %+v", result)
	}
}
