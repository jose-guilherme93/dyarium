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

func TestAuthorLineByRole(t *testing.T) {
	cases := []struct {
		name   string
		config Config
		want   string
	}{
		{"dono com nome", Config{Author: "self", OwnerName: "Ana"}, "Ana"},
		{"dono sem nome", Config{Author: "self"}, "o proprio autor do diario"},
		{"outra pessoa", Config{Author: "other", OwnerName: "Ana"}, "outra pessoa"},
		{"misto", Config{Author: "mixed", OwnerName: "Ana"}, "Ana"},
		{"sem autor", Config{}, "Nao se sabe quem gravou"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := New(tc.config).authorLine(); !strings.Contains(got, tc.want) {
				t.Fatalf("authorLine = %q; queria conter %q", got, tc.want)
			}
		})
	}
}

func TestPromptsCarryAuthor(t *testing.T) {
	client := New(Config{Author: "other", OwnerName: "Ana", Themes: []string{"casa"}})
	if got := client.systemPrompt(); !strings.Contains(got, "outra pessoa") {
		t.Fatalf("system prompt sem autor: %q", got)
	}
	if got := sectionSystemPrompt([]string{"casa"}, "portugues", "Casa", client.authorLine()); !strings.Contains(got, "outra pessoa") {
		t.Fatalf("section prompt sem autor: %q", got)
	}
}

func TestConfigFromSettingsAuthorDefaults(t *testing.T) {
	got := ConfigFromSettings(Config{}, map[string]string{"owner_name": " Ana ", "all_notes_mine": "false"})
	if got.OwnerName != "Ana" || got.AllNotesMine {
		t.Fatalf("autor das settings = %+v", got)
	}
	got = ConfigFromSettings(Config{AllNotesMine: true}, nil)
	if !got.AllNotesMine {
		t.Fatalf("sem settings deveria manter o padrao ligado")
	}
	got = ConfigFromSettings(Config{}, map[string]string{})
	if !got.AllNotesMine {
		t.Fatalf("instancia nova deveria ter all_notes_mine ligado")
	}
}
