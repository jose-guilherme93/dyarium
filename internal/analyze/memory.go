package analyze

import (
	"strings"
	"unicode"
)

// MemoryEntry is one piece of the owner's curation memory injected into the
// analysis prompt by lexical recovery: the names and aliases the diarist
// already knows, plus the names that must never become entities of a kind.
type MemoryEntry struct {
	Kind     string
	Name     string
	Label    string
	Aliases  []string
	Rejected []string
}

// memoryAccents maps accented letters to their base form, the same
// normalization the store applies to entity and rejection names.
var memoryAccents = strings.NewReplacer(
	"á", "a", "à", "a", "â", "a", "ã", "a", "ä", "a",
	"é", "e", "è", "e", "ê", "e", "ë", "e",
	"í", "i", "ì", "i", "î", "i", "ï", "i",
	"ó", "o", "ò", "o", "ô", "o", "õ", "o", "ö", "o",
	"ú", "u", "ù", "u", "û", "u", "ü", "u",
	"ç", "c",
)

// normalizeMemoryText lowercases, removes accents, turns punctuation into
// spaces and collapses whitespace. It is the lexical key used to look up
// names in a block of text.
func normalizeMemoryText(s string) string {
	s = memoryAccents.Replace(strings.ToLower(strings.TrimSpace(s)))
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsSpace(r) {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// containsMemoryTerm reports whether term appears in text as a whole phrase
// (word boundaries on both sides), so "maria" does not match "marianna".
func containsMemoryTerm(text, term string) bool {
	text = " " + normalizeMemoryText(text) + " "
	term = normalizeMemoryText(term)
	if term == "" {
		return false
	}
	return strings.Contains(text, " "+term+" ")
}

// relevantMemory returns the memory entries whose name or any alias appears
// as a whole phrase in text.
func relevantMemory(text string, memory []MemoryEntry) []MemoryEntry {
	var out []MemoryEntry
	for _, entry := range memory {
		if containsMemoryTerm(text, entry.Name) {
			out = append(out, entry)
			continue
		}
		for _, alias := range entry.Aliases {
			if containsMemoryTerm(text, alias) {
				out = append(out, entry)
				break
			}
		}
	}
	return out
}

// memoryKindName is the Portuguese name of an entity kind, as it appears in
// the prompt lines.
func memoryKindName(kind string) string {
	switch strings.TrimSpace(kind) {
	case "person":
		return "pessoa"
	case "place":
		return "lugar"
	case "theme":
		return "tema"
	case "decision":
		return "decisao"
	default:
		return strings.TrimSpace(kind)
	}
}

// formatMemoryEntry renders one entry as a single objective line.
func formatMemoryEntry(entry MemoryEntry) string {
	var parts []string
	if entry.Kind != "" {
		parts = append(parts, memoryKindName(entry.Kind))
	}
	if entry.Label != "" {
		parts = append(parts, `rotulo "`+entry.Label+`"`)
	}
	if len(entry.Rejected) > 0 {
		rejected := make([]string, 0, len(entry.Rejected))
		for _, kind := range entry.Rejected {
			rejected = append(rejected, memoryKindName(kind))
		}
		parts = append(parts, "nunca "+strings.Join(rejected, ", "))
	}
	if len(parts) == 0 {
		return entry.Name + "."
	}
	return entry.Name + ": " + strings.Join(parts, "; ") + "."
}

// memoryBlock builds the curation memory block for one text. It contains only
// the entries whose name or alias appears in the text, followed by the
// instruction that limits how the model may use them. It is empty when nothing
// matches, so the prompt stays unchanged for notes without known entities.
func memoryBlock(text string, memory []MemoryEntry) string {
	relevant := relevantMemory(text, memory)
	if len(relevant) == 0 {
		return ""
	}
	lines := make([]string, 0, len(relevant)+1)
	lines = append(lines, "Memoria de curadoria (use so para nao repetir erro; nao extraia nome que nao esteja no bloco):")
	for _, entry := range relevant {
		lines = append(lines, formatMemoryEntry(entry))
	}
	return strings.Join(lines, "\n")
}

// Exported aliases, so callers and tests can use either spelling.
var (
	MemoryBlock    = memoryBlock
	RelevantMemory = relevantMemory
)
