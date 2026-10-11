package analyze

import (
	"strings"
	"testing"
)

func TestSystemPromptIncludesThemesAndLanguage(t *testing.T) {
	prompt := New(Config{Themes: []string{"trabalho", "casa"}}).systemPrompt()
	if !strings.Contains(prompt, "trabalho, casa") {
		t.Fatalf("prompt sem os temas: %q", prompt)
	}
	if !strings.Contains(prompt, "o mesmo idioma da transcricao") {
		t.Fatalf("prompt deveria pedir o idioma da transcricao por padrao: %q", prompt)
	}
}

func TestSystemPromptLanguage(t *testing.T) {
	if got := New(Config{Language: "en"}).systemPrompt(); !strings.Contains(got, "ingles") {
		t.Fatalf("prompt sem o idioma ingles: %q", got)
	}
	if got := New(Config{Language: "pt"}).systemPrompt(); !strings.Contains(got, "portugues") {
		t.Fatalf("prompt sem o idioma portugues: %q", got)
	}
}

func TestLanguageName(t *testing.T) {
	cases := map[string]string{
		"pt": "portugues",
		"en": "ingles",
		"es": "espanhol",
		"":   "o mesmo idioma da transcricao",
		"xx": "o mesmo idioma da transcricao",
	}
	for code, want := range cases {
		if got := languageName(code); got != want {
			t.Fatalf("languageName(%q) = %q; queria %q", code, got, want)
		}
	}
}
