package analyze

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// The model reads prose, not a document. Before the prompt, everything that is
// not the author's writing or speech is removed: HTML tags and entities, code
// fences, tables, images, links, bare URLs, audio markers, time stamps, emoji,
// invisible characters and lines that only carry symbols. Paragraphs survive:
// they are the unit of the analysis plan.
//
// This mirrors the app's `toAnalysisText` (mobile/src/core/analysisText.ts) on
// purpose: the text the phone reads and the text the server reads follow the
// same rules, so the two analyses of the same note stay comparable.

var (
	htmlComment = regexp.MustCompile(`(?s)<!--.*?-->`)
	// RE2 nao tem referencia para tras: cada tag opaco ganha a sua expressao.
	htmlOpaque = []*regexp.Regexp{
		regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script\s*>`),
		regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style\s*>`),
		regexp.MustCompile(`(?is)<template\b[^>]*>.*?</template\s*>`),
		regexp.MustCompile(`(?is)<svg\b[^>]*>.*?</svg\s*>`),
		regexp.MustCompile(`(?is)<math\b[^>]*>.*?</math\s*>`),
		regexp.MustCompile(`(?is)<iframe\b[^>]*>.*?</iframe\s*>`),
	}
	htmlBreak  = regexp.MustCompile(`(?i)<(br|hr)\s*/?>`)
	htmlBlock  = regexp.MustCompile(`(?i)</(p|div|li|tr|h[1-6]|blockquote|section|article|pre)\s*>`)
	htmlTag    = regexp.MustCompile(`<[^>]*>`)
	htmlEntity = regexp.MustCompile(`&(#x?[0-9a-fA-F]+|[a-zA-Z]+);`)

	imageMark = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)(?:\{w=\d+\})?`)
	// An audio marker in the document carries no text: the transcript comes in
	// through its own section.
	audioMark = regexp.MustCompile(`!audio\[[^\]]*\](?:\{d=[^}]*\})?`)
	mdLink    = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	// A URL is not speech; the link label already carries the meaning.
	bareURL = regexp.MustCompile(`(?i)\b(?:https?://|www\.)[^\s<>"']*[^\s<>"'.,;:!?)]`)
	// "rotulo ()" depois de tirar a URL nao acrescenta nada.
	emptyParen = regexp.MustCompile(`\(\s*\)`)
	// Fenced code is dropped whole, including the fence lines.
	codeFence  = regexp.MustCompile("(?m)(^|\\n)[ \\t]*(?:```|~~~)[^\\n]*\\n[\\s\\S]*?(?:\\n[ \\t]*(?:```|~~~)[^\\n]*|$)")
	inlineCode = regexp.MustCompile("`{1,3}([^`\\n]{0,120})`{1,3}")
	listMark   = regexp.MustCompile(`(?m)(^|\n)[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]+`)
	quoteMark  = regexp.MustCompile(`(?m)(^|\n)[ \t]*>[ \t]?`)
	headMark   = regexp.MustCompile(`(?m)(^|\n)[ \t]*#{1,6}[ \t]+`)
	emphasis   = regexp.MustCompile(`[*_~]{1,3}`)
	timestamp  = regexp.MustCompile(`\[\d{1,2}:\d{2}(?::\d{2})?\]`)
	symbols    = regexp.MustCompile(`[\x{1F000}-\x{1FAFF}\x{1F1E6}-\x{1F1FF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0E}\x{FE0F}\x{200D}\x{20E3}]`)
	invisible  = regexp.MustCompile(`[\x{00AD}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}\x{FEFF}]`)
	control    = regexp.MustCompile(`[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}]`)
	spacePunct = regexp.MustCompile(`[ \t]+([.,;:!?])`)
)

var namedEntities = map[string]string{
	"nbsp": " ", "ensp": " ", "emsp": " ", "thinsp": " ",
	"amp": "&", "lt": "<", "gt": ">", "quot": `"`, "apos": "'",
	"ndash": "-", "mdash": "-", "hellip": "...",
	"lsquo": "'", "rsquo": "'", "ldquo": `"`, "rdquo": `"`,
	"bull": " ", "middot": " ", "copy": "", "reg": "", "trade": "",
}

func decodeEntities(value string) string {
	return htmlEntity.ReplaceAllStringFunc(value, func(match string) string {
		body := strings.TrimSuffix(strings.TrimPrefix(match, "&"), ";")
		key := strings.ToLower(body)
		if strings.HasPrefix(key, "#x") {
			if code, err := strconv.ParseInt(key[2:], 16, 32); err == nil && code > 0 && code <= 0x10FFFF {
				return string(rune(code))
			}
			return " "
		}
		if strings.HasPrefix(key, "#") {
			if code, err := strconv.ParseInt(key[1:], 10, 32); err == nil && code > 0 && code <= 0x10FFFF {
				return string(rune(code))
			}
			return " "
		}
		// An unknown entity must not become a word the model reads as prose.
		text, ok := namedEntities[key]
		if !ok {
			return " "
		}
		return text
	})
}

func hasWord(line string) bool {
	for _, r := range line {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

// CleanText is the pure text of a note for the analysis prompt. It is
// idempotent: cleaning an already clean text changes nothing. The stored note
// and the revision are never touched; this is only the copy that enters the
// model.
func CleanText(value string) string {
	if value == "" {
		return ""
	}
	text := strings.ReplaceAll(value, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")

	text = htmlComment.ReplaceAllString(text, " ")
	for _, opaque := range htmlOpaque {
		text = opaque.ReplaceAllString(text, " ")
	}
	text = htmlBreak.ReplaceAllString(text, "\n")
	text = htmlBlock.ReplaceAllString(text, "\n\n")
	text = htmlTag.ReplaceAllString(text, " ")
	text = decodeEntities(text)

	text = imageMark.ReplaceAllString(text, " ")
	text = audioMark.ReplaceAllString(text, " ")
	text = mdLink.ReplaceAllString(text, "$1")
	text = bareURL.ReplaceAllString(text, " ")
	text = emptyParen.ReplaceAllString(text, " ")

	text = codeFence.ReplaceAllString(text, "\n")
	text = inlineCode.ReplaceAllString(text, "$1")
	text = listMark.ReplaceAllString(text, "$1")
	text = quoteMark.ReplaceAllString(text, "$1")
	text = headMark.ReplaceAllString(text, "$1")
	text = emphasis.ReplaceAllString(text, "")
	text = timestamp.ReplaceAllString(text, " ")

	text = symbols.ReplaceAllString(text, " ")
	text = invisible.ReplaceAllString(text, " ")
	text = control.ReplaceAllString(text, " ")
	text = spacePunct.ReplaceAllString(text, "$1")

	paragraphs := make([]string, 0, 8)
	lines := make([]string, 0, 8)
	flush := func() {
		if len(lines) > 0 {
			paragraphs = append(paragraphs, strings.Join(lines, " "))
			lines = lines[:0]
		}
	}
	for _, raw := range strings.Split(text, "\n") {
		line := strings.Join(strings.Fields(raw), " ")
		if line == "" {
			flush()
			continue
		}
		if !hasWord(line) {
			continue
		}
		lines = append(lines, line)
	}
	flush()
	return strings.Join(paragraphs, "\n\n")
}
