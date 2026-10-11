package main

import "testing"

func TestExtractText(t *testing.T) {
	doc := `[{"type":"paragraph","content":[{"type":"text","text":"primeira linha"}]},` +
		`{"type":"paragraph","content":[{"type":"text","text":"segunda linha"}]}]`
	if got := extractText(doc); got != "primeira linha segunda linha" {
		t.Fatalf("extractText = %q", got)
	}
	if got := extractText("nao e json"); got != "" {
		t.Fatalf("esperava vazio para entrada invalida, got %q", got)
	}
	if got := extractText(`[{"type":"paragraph","content":[]}]`); got != "" {
		t.Fatalf("esperava vazio para documento sem texto, got %q", got)
	}
}
