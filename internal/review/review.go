// Package review holds the pure rules of the AI transcript revision: how the
// speech is counted, which rewrites are accepted, and the window sizes. The
// prompt and the network live in internal/analyze; keeping the rules here makes
// them testable without a model and identical between the server and the app.
package review

import (
	"regexp"
	"strings"
	"unicode"
)

// PromptVersion identifies the revision prompt and rules. It is part of the
// cache key: changing the prompt means an old revision is not reused.
const PromptVersion = 1

// ServerWindow is the number of segments sent to the model per call on the
// server. DeviceWindow is the smaller one used by local models on the phone.
const (
	ServerWindow = 10
	DeviceWindow = 3
)

// Counts is the speech measurement of a transcript: total words plus the two
// disfluency series the analysis stores. They are counted on the raw whisper
// text, never on the revision, so the series is stable across models.
type Counts struct {
	Words      int
	Stutter    int
	Hesitation int
}

// hesitationWords are fillers that carry no meaning. "um" is left out on
// purpose: it is also the article and would inflate the series.
var hesitationWords = map[string]bool{
	"ah": true, "ahh": true, "ahn": true, "eh": true, "ehh": true, "ehm": true,
	"hm": true, "hmm": true, "hum": true, "humm": true, "ih": true, "mhm": true,
	"mm": true, "mmm": true, "uh": true, "uhm": true, "uhum": true,
}

// emphaticRepeats are legitimate repetitions that are not stutter.
var emphaticRepeats = map[string]bool{"nao": true, "sim": true}

// Speak counts the words, stutters and hesitations of one text. A stutter is a
// word repeated immediately ("eu eu"); a hesitation is a filler ("ee", "hum").
func Speak(text string) Counts {
	tokens := tokenize(text)
	var counts Counts
	previous := ""
	for _, token := range tokens {
		folded := fold(token)
		if folded == "" {
			continue
		}
		counts.Words++
		if isHesitation(folded) {
			counts.Hesitation++
			previous = ""
			continue
		}
		if folded == previous && !emphaticRepeats[folded] {
			counts.Stutter++
		}
		previous = folded
	}
	return counts
}

// PerHundred converts a count to a rate per 100 words (0 when there is no word).
func PerHundred(count, words int) float64 {
	if words <= 0 {
		return 0
	}
	return float64(count) * 100 / float64(words)
}

// tokenize splits on spaces and drops punctuation-only tokens, keeping the
// letters (an apostrophe or hyphen inside a word stays with it).
func tokenize(text string) []string {
	return strings.FieldsFunc(text, func(r rune) bool {
		return unicode.IsSpace(r)
	})
}

func trimToken(token string) string {
	return strings.TrimFunc(token, func(r rune) bool {
		return unicode.IsPunct(r) || unicode.IsSymbol(r)
	})
}

// fold lowercases and removes accents, so "ééé" and "eee" are the same filler.
func fold(token string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(trimToken(token)) {
		switch r {
		case 'á', 'à', 'â', 'ã', 'ä':
			b.WriteRune('a')
		case 'é', 'è', 'ê', 'ë':
			b.WriteRune('e')
		case 'í', 'ì', 'î', 'ï':
			b.WriteRune('i')
		case 'ó', 'ò', 'ô', 'õ', 'ö':
			b.WriteRune('o')
		case 'ú', 'ù', 'û', 'ü':
			b.WriteRune('u')
		case 'ç':
			b.WriteRune('c')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// isHesitation recognizes fillers: known filler words and a single letter
// repeated ("éé", "ãã", "mmm").
func isHesitation(folded string) bool {
	if hesitationWords[folded] {
		return true
	}
	if len([]rune(folded)) < 2 {
		return false
	}
	first := rune(0)
	for _, r := range folded {
		if !strings.ContainsRune("aeiouhmn", r) {
			return false
		}
		if first == 0 {
			first = r
			continue
		}
		if r != first {
			return false
		}
	}
	return true
}

var numberRe = regexp.MustCompile(`\d+(?:[.,]\d+)*`)

// maxGlossWords is the longest parenthetical explanation accepted in a segment.
const maxGlossWords = 6

// Accept decides whether a revision can replace the visible text of a segment.
// It rejects rewrites that add or drop facts (numbers), that change the text too
// much (length and word overlap) and that explain more than one thing. The
// reason is for logs and tests; it never reaches the user.
func Accept(original, revised string) (bool, string) {
	original = strings.TrimSpace(original)
	revised = strings.TrimSpace(revised)
	switch {
	case revised == "":
		return false, "vazio"
	case original == "":
		return true, ""
	}
	glossLen, ok := glossWithinLimit(original, revised)
	if !ok {
		return false, "explicacao demais"
	}
	origLen := len([]rune(original))
	revLen := len([]rune(revised))
	if revLen < origLen*7/10 {
		return false, "curto demais"
	}
	// A explicacao de sigla e conteudo legitimo: ela ganha espaco proprio.
	if revLen > origLen*14/10+glossLen {
		return false, "longo demais"
	}
	if !sameNumbers(original, revised) {
		return false, "numeros diferentes"
	}
	if !similarEnough(original, revised) {
		return false, "mudou demais"
	}
	return true, ""
}

// sameNumbers requires every number of the original to survive and forbids new
// ones. It is the cheapest guard against invented facts.
func sameNumbers(original, revised string) bool {
	before := map[string]int{}
	for _, n := range numberRe.FindAllString(original, -1) {
		before[n]++
	}
	after := map[string]int{}
	for _, n := range numberRe.FindAllString(revised, -1) {
		after[n]++
	}
	if len(before) != len(after) {
		return false
	}
	for n, count := range before {
		if after[n] != count {
			return false
		}
	}
	return true
}

// glossWithinLimit allows one short explanation in parentheses per segment,
// such as expanding "pt" to "pt (Partido dos Trabalhadores)". It returns the
// runes added by the gloss (zero when there is none).
func glossWithinLimit(original, revised string) (int, bool) {
	added := strings.Count(revised, "(") - strings.Count(original, "(")
	if added <= 0 {
		return 0, true
	}
	if added > 1 {
		return 0, false
	}
	start := strings.Index(revised, "(")
	end := strings.Index(revised[start:], ")")
	if end < 0 {
		return 0, false
	}
	gloss := revised[start+1 : start+end]
	if len(strings.Fields(gloss)) > maxGlossWords {
		return 0, false
	}
	return len([]rune(gloss)) + 2, true
}

// similarEnough compares the word sets. Very short segments skip the check: one
// changed word would look like a rewrite.
func similarEnough(original, revised string) bool {
	before := wordSet(original)
	after := wordSet(revised)
	if len(before) < 4 || len(after) < 4 {
		return true
	}
	common := 0
	for word := range before {
		if after[word] {
			common++
		}
	}
	union := len(before) + len(after) - common
	return union > 0 && float64(common)/float64(union) >= 0.45
}

func wordSet(text string) map[string]bool {
	set := map[string]bool{}
	for _, token := range tokenize(text) {
		if folded := fold(token); folded != "" {
			set[folded] = true
		}
	}
	return set
}
