package preview

import "testing"

func TestPlain(t *testing.T) {
	markdown := "# Titulo\n\n" +
		"Um **dia** bom, com [link](https://exemplo.com/x) e ![foto](attachment:y){w=50}.\n\n" +
		"- item um\n- item dois\n\n" +
		"> citacao\n\n" +
		"```go\nfunc main() {}\n```\n\n" +
		"| a | b |\n| - | - |\n\n" +
		"Veja [outra nota](note:abc).\n"
	want := "Titulo Um dia bom, com link (https://exemplo.com/x) e imagem: foto. item um item dois citacao Veja outra nota."
	if got := Plain(markdown); got != want {
		t.Fatalf("Plain =\n%q\nwant\n%q", got, want)
	}
}

func TestShort(t *testing.T) {
	body := "# Contrato E2E\n\n" + "Primeiro paragrafo com **muito** texto. " +
		"Segundo paragrafo que nao cabe inteiro na previa da lista e precisa ser cortado numa palavra."

	got := Short(body, 60)
	if len([]rune(got)) > 61 {
		t.Fatalf("preview longa demais (%d): %q", len([]rune(got)), got)
	}
	if got[len(got)-3:] != "…" {
		t.Fatalf("preview sem reticencias: %q", got)
	}
	if want := "Contrato E2E Primeiro paragrafo com muito texto. Segundo"; got[:len(got)-3] != want {
		t.Fatalf("preview = %q", got)
	}
}

// O marcador de audio do app nao vaza para a previa nem para a contagem de
// palavras da analise.
func TestPlainSkipsAudioMarkers(t *testing.T) {
	body := "Antes.\n!audio[attachment:2df30ced81043d56234f07cc047017a2]{d=28.794}\nDepois."
	if got := Plain(body); got != "Antes. Depois." {
		t.Fatalf("Plain = %q", got)
	}
	got := Short(body, 160)
	if got != "Antes. Depois." {
		t.Fatalf("Short = %q", got)
	}
}

func TestShortKeepsSmallText(t *testing.T) {
	if got := Short("  Uma linha so.  ", 40); got != "Uma linha so." {
		t.Fatalf("Short = %q", got)
	}
}

// A previa da lista e prosa: a imagem anexada nao vira texto e as barras de
// escape do markdown somem.
func TestShortSkipsImagesAndEscapes(t *testing.T) {
	body := "![foto](attachment:abc){w=50}\n\n\\# Titulo \\*forte\\*\n\nPrimeira linha do corpo."
	want := "Titulo forte Primeira linha do corpo."
	if got := Short(body, 160); got != want {
		t.Fatalf("Short = %q, want %q", got, want)
	}
}
