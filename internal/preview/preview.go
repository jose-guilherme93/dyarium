// Package preview turns a stored note body into the one or two lines the lists
// show. The rules mirror what the dashboard renders (web/src/editor) so the
// preview and the editor agree: markdown syntax never leaks into the list.
package preview

import (
	"regexp"
	"strings"
)

// DefaultLimit is how many characters a list preview carries. Two lines in the
// narrow sidebar fit about this much as a serif sentence.
const DefaultLimit = 160

// Plain is the plain text of a markdown body: the same view the analysis reads,
// so the dashboard counts words from what the person sees. Markdown that
// carries no prose (fenced code, table rows, a mention to another note) is
// dropped.
func Plain(markdown string) string {
	plain := markdown
	for _, rule := range rules {
		plain = rule.re.ReplaceAllString(plain, rule.replacement)
	}
	return strings.Join(strings.Fields(plain), " ")
}

// Short is Plain cut to at most limit characters, without breaking a word. A
// list preview does not announce attached images and does not keep the
// backslash escapes that markdown uses for punctuation: the row is prose.
func Short(markdown string, limit int) string {
	markdown = imageLine.ReplaceAllString(markdown, "")
	markdown = escapedPunctuation.ReplaceAllString(markdown, "$1")
	plain := Plain(markdown)
	if limit <= 0 {
		limit = DefaultLimit
	}
	runes := []rune(plain)
	if len(runes) <= limit {
		return plain
	}
	cut := string(runes[:limit])
	if space := strings.LastIndexByte(cut, ' '); space > limit/2 {
		cut = cut[:space]
	}
	return strings.TrimRight(cut, " ,.;:") + "…"
}

// imageLine and escapedPunctuation clean a preview before Plain runs.
var (
	imageLine          = regexp.MustCompile(`!\[[^\]]*\]\([^)\s]*\)(?:\{w=\d+\})?`)
	escapedPunctuation = regexp.MustCompile(`\\([\\` + "`" + `*_{}\[\]()#+.!-])`)
)

var rules = []struct {
	re          *regexp.Regexp
	replacement string
}{
	{regexp.MustCompile("(?ms)^```.*?^```[^\\n]*$"), ""},
	{regexp.MustCompile(`(?m)^\|.*\|$`), ""},
	// Audio anexado nao tem texto para a previa nem para a analise: o marcador
	// sai do texto e a transcricao (quando existe) entra por outro caminho.
	{regexp.MustCompile(`!audio\[[^\]]*\](?:\{d=[^}]*\})?`), ""},
	// Imagem entra pela legenda/arquivo: e o que um modelo de texto consegue ler
	// do anexo (o conteudo visual exigiria um modelo com visao).
	{regexp.MustCompile(`!\[([^\]]*)\]\([^)\s]*\)\{w=\d+\}`), "imagem: ${1}"},
	{regexp.MustCompile(`!\[([^\]]*)\]\([^)\s]*\)`), "imagem: ${1}"},
	// Mencao a outra nota: fica o rotulo (a secao de links traz o titulo).
	{regexp.MustCompile(`\[([^\]]*)\]\(note:[^)\s]+\)`), "${1}"},
	// Link externo: rotulo e URL, para a analise saber para onde aponta.
	{regexp.MustCompile(`\[([^\]]*)\]\(([^)\s]+)\)`), "${1} (${2})"},
	{regexp.MustCompile(`(?m)^#{1,6}\s+`), ""},
	{regexp.MustCompile(`(?m)^>\s?`), ""},
	{regexp.MustCompile(`(?m)^\s*[-*+]\s+`), ""},
	{regexp.MustCompile(`(?m)^\s*\d+\.\s+`), ""},
	{regexp.MustCompile("[*_~`]"), ""},
}
