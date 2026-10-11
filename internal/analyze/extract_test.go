package analyze

import (
	"encoding/json"
	"testing"
)

func TestExtractJSONRepairsTruncated(t *testing.T) {
	cases := []string{
		`{"sentiment": 0.3, "emotions": {"calma": 0.6`,
		`aqui vai: {"sentiment": 0.1, "people": ["Ana"`,
		`{"sentiment": 0, "places": ["Recife"],`,
	}
	for _, c := range cases {
		got := extractJSON(c)
		var v map[string]any
		if err := json.Unmarshal([]byte(got), &v); err != nil {
			t.Fatalf("reparo falhou para %q -> %q: %v", c, got, err)
		}
	}
}

func TestExtractJSONKeepsValidObject(t *testing.T) {
	in := "```json\n{\"sentiment\": 0.5}\n```"
	got := extractJSON(in)
	var v map[string]any
	if err := json.Unmarshal([]byte(got), &v); err != nil {
		t.Fatalf("falhou para objeto valido %q -> %q: %v", in, got, err)
	}
	if v["sentiment"].(float64) != 0.5 {
		t.Fatalf("valor errado: %v", v["sentiment"])
	}
}
