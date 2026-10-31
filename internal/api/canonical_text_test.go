package api

import (
	"testing"

	"github.com/joseti/dyarium/internal/store"
)

// A reescrita do texto corrige grafia de nome, nunca gramatica: o pronome "eu"
// nao pode virar o nome do diarista ("Joseti fiz isso porque Joseti quis").
func TestCanonicalizeAnalysisTextKeepsGrammar(t *testing.T) {
	pairs := []store.EntityNamePair{
		{Old: "eu", New: "Joseti"},
		{Old: "a gente", New: "Joseti"},
		{Old: "wenes", New: "Wennys"},
	}
	got := canonicalizeAnalysisText("eu fiz isso porque eu quis; a wenes viu e a gente foi", pairs)
	want := "eu fiz isso porque eu quis; a Wennys viu e a gente foi"
	if got != want {
		t.Fatalf("texto = %q, want %q", got, want)
	}
}

// So a palavra inteira: "ana" nao pode trocar dentro de "banana".
func TestCanonicalizeAnalysisTextWholeWords(t *testing.T) {
	pairs := []store.EntityNamePair{{Old: "ana", New: "Ana Maria"}}
	got := canonicalizeAnalysisText("ana comeu banana; Ana saiu.", pairs)
	want := "Ana Maria comeu banana; Ana Maria saiu."
	if got != want {
		t.Fatalf("texto = %q, want %q", got, want)
	}
}
