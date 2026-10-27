package analyze

import (
	"strings"
	"unicode"
)

// The analysis exists to produce metrics: sentiment, emotions, people, places,
// themes and key moments. The prose is a caption, not a report — the dashboard
// reads numbers. These caps are enforced in code, not only asked in the prompt.
const (
	summaryMaxSentences = 1
	summaryMaxChars     = 140
	readingMaxSentences = 2
	readingMaxChars     = 280
)

// shortenProse normalizes the model prose to at most maxSentences sentences and
// maxChars characters, in a single line. It never returns a paragraph: the
// prompt asks for little text and the code guarantees it.
func shortenProse(text string, maxSentences, maxChars int) string {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return ""
	}
	text = cutSentences(text, maxSentences)
	runes := []rune(text)
	if len(runes) > maxChars {
		cut := string(runes[:maxChars])
		if index := strings.LastIndex(cut, " "); index > maxChars/2 {
			cut = cut[:index]
		}
		text = strings.TrimRight(cut, " ,;:-") + "..."
	}
	return strings.TrimSpace(text)
}

// cutSentences keeps the first maxSentences sentences. A terminator counts only
// when a space or the end follows it, so decimals and ellipses do not split.
func cutSentences(text string, maxSentences int) string {
	if maxSentences <= 0 {
		return ""
	}
	runes := []rune(text)
	count := 0
	for i, r := range runes {
		if r != '.' && r != '!' && r != '?' {
			continue
		}
		next := rune(' ')
		if i+1 < len(runes) {
			next = runes[i+1]
		}
		if i+1 < len(runes) && !unicode.IsSpace(next) {
			continue
		}
		count++
		if count == maxSentences {
			return strings.TrimSpace(string(runes[:i+1]))
		}
	}
	return strings.TrimSpace(text)
}

// limitProse applies the prose caps to a result, including each section.
func limitProse(result Result) Result {
	result.Summary = shortenProse(result.Summary, summaryMaxSentences, summaryMaxChars)
	result.Reading = shortenProse(result.Reading, readingMaxSentences, readingMaxChars)
	for i := range result.Sections {
		result.Sections[i].Summary = shortenProse(result.Sections[i].Summary, summaryMaxSentences, summaryMaxChars)
		result.Sections[i].Reading = shortenProse(result.Sections[i].Reading, readingMaxSentences, readingMaxChars)
	}
	return result
}
