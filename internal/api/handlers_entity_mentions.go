package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/store"
)

const (
	// O painel do mapa mostra o detalhe de uma bola; um punhado de notas e de
	// trechos por nota ja da o caminho de volta para o texto.
	mentionEntryLimit   = 12
	mentionPerEntryMax  = 2
	mentionTotalMax     = 24
	mentionDisplayChars = 320
	mentionCommentChars = 260
)

// entityMention is one passage where an entity was found: a transcript segment
// with its audio offset or a sentence from the written note. Comment is the
// note's analysis reading, shown next to the passage.
type entityMention struct {
	EntryID string    `json:"entry_id"`
	Title   string    `json:"title"`
	Date    time.Time `json:"date"`
	Source  string    `json:"source"`
	Text    string    `json:"text"`
	// Term is the spelling that matched, so the client can highlight it even
	// after a rename.
	Term    string `json:"term"`
	StartMS *int64 `json:"start_ms,omitempty"`
	EndMS   *int64 `json:"end_ms,omitempty"`
	Comment string `json:"comment,omitempty"`
}

// handleEntityMentions returns the passages that prove why an entity exists on
// the map. The name is resolved through aliases: after a rename, the transcript
// still has the old spelling, and the reader needs to find it.
func (s *Server) handleEntityMentions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	kind := r.PathValue("kind")
	if !store.ValidEntityKind(kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind deve ser person, place, theme ou decision")
		return
	}
	summary, entries, ok, err := s.deps.Store.GetEntity(ctx, kind, r.PathValue("name"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "entidade inexistente")
		return
	}
	aliases, err := s.deps.Store.EntityAliases(ctx, summary.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	terms := append([]string{summary.Name}, aliases...)

	mentions := make([]entityMention, 0, 16)
	for i, entry := range entries {
		if i >= mentionEntryLimit {
			break
		}
		comment := s.entityComment(ctx, entry.EntryID)
		base := entityMention{
			EntryID: entry.EntryID,
			Title:   entry.Title,
			Date:    entry.Date,
			Comment: comment,
		}

		found, err := s.transcriptMentions(ctx, base, terms)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		mentions = append(mentions, found...)
		if len(mentions) >= mentionTotalMax {
			mentions = mentions[:mentionTotalMax]
			break
		}

		found, err = s.noteMentions(ctx, base, terms)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		mentions = append(mentions, found...)
		if len(mentions) >= mentionTotalMax {
			mentions = mentions[:mentionTotalMax]
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"mentions": mentions})
}

func (s *Server) transcriptMentions(ctx context.Context, base entityMention, terms []string) ([]entityMention, error) {
	transcript, err := s.deps.Store.LatestTranscript(ctx, base.EntryID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	segments, err := s.deps.Store.ListSegments(ctx, transcript.ID)
	if err != nil {
		return nil, err
	}
	out := make([]entityMention, 0, 2)
	for _, segment := range segments {
		text := strings.TrimSpace(segment.Revised)
		if text == "" {
			text = strings.TrimSpace(segment.Text)
		}
		term, ok := matchEntityTerm(text, terms)
		if !ok {
			continue
		}
		start, end := segment.StartMS, segment.EndMS
		item := base
		item.Source = "transcript"
		item.Text = truncateMention(text, mentionDisplayChars)
		item.Term = term
		item.StartMS = &start
		item.EndMS = &end
		out = append(out, item)
		if len(out) >= mentionPerEntryMax {
			break
		}
	}
	return out, nil
}

func (s *Server) noteMentions(ctx context.Context, base entityMention, terms []string) ([]entityMention, error) {
	notes, err := s.deps.Store.ListNotes(ctx, base.EntryID)
	if err != nil {
		return nil, err
	}
	out := make([]entityMention, 0, 2)
	for _, note := range notes {
		text := analyze.CleanText(note.ContentMarkdown)
		for _, sentence := range splitMentionSentences(text) {
			term, ok := matchEntityTerm(sentence, terms)
			if !ok {
				continue
			}
			item := base
			item.Source = "text"
			item.Text = truncateMention(sentence, mentionDisplayChars)
			item.Term = term
			out = append(out, item)
			if len(out) >= mentionPerEntryMax {
				return out, nil
			}
		}
	}
	return out, nil
}

// entityComment is the analysis reading of one note. It is the "comentado"
// side of the excerpt; the text itself stays exactly as written or spoken.
func (s *Server) entityComment(ctx context.Context, entryID string) string {
	analysis, ok, err := s.deps.Store.GetAnalysis(ctx, entryID)
	if err != nil {
		if s.deps.Logger != nil {
			s.deps.Logger.Warn("api: leitura da entidade", "erro", err)
		}
		return ""
	}
	if !ok {
		return ""
	}
	if data := strings.TrimSpace(analysis.Data); data != "" {
		var result analyze.Result
		if json.Unmarshal([]byte(data), &result) == nil {
			if reading := strings.TrimSpace(result.Reading); reading != "" {
				return truncateMention(reading, mentionCommentChars)
			}
			if summary := strings.TrimSpace(result.Summary); summary != "" {
				return truncateMention(summary, mentionCommentChars)
			}
		}
	}
	return truncateMention(strings.TrimSpace(analysis.Summary), mentionCommentChars)
}

// matchEntityTerm finds the first registered spelling that occurs as a whole
// word in text. Comparison ignores case and Portuguese accents; the returned
// term is the spelling stored in the entity, not a slice of the text.
func matchEntityTerm(text string, terms []string) (string, bool) {
	for _, term := range terms {
		if containsFolded(text, term) {
			return term, true
		}
	}
	return "", false
}

func containsFolded(text, term string) bool {
	haystack := foldMention(text)
	needle := foldMention(term)
	if needle == "" {
		return false
	}
	from := 0
	for {
		index := strings.Index(haystack[from:], needle)
		if index < 0 {
			return false
		}
		index += from
		end := index + len(needle)
		before := true
		if index > 0 {
			r, _ := utf8.DecodeLastRuneInString(haystack[:index])
			before = !unicode.IsLetter(r) && !unicode.IsDigit(r)
		}
		after := true
		if end < len(haystack) {
			r, _ := utf8.DecodeRuneInString(haystack[end:])
			after = !unicode.IsLetter(r) && !unicode.IsDigit(r)
		}
		if before && after {
			return true
		}
		from = index + len(needle)
	}
}

// foldMention lowercases, strips Portuguese accents and collapses spaces.
func foldMention(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range strings.ToLower(value) {
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
	return strings.Join(strings.Fields(b.String()), " ")
}

// splitMentionSentences keeps the punctuation and splits on sentence endings,
// so a note excerpt reads like the original text instead of a fragment.
func splitMentionSentences(text string) []string {
	runes := []rune(text)
	var out []string
	start := 0
	for i, r := range runes {
		if r != '.' && r != '!' && r != '?' {
			continue
		}
		end := i + 1
		for end < len(runes) && (runes[end] == '.' || runes[end] == '!' || runes[end] == '?') {
			end++
		}
		if sentence := strings.TrimSpace(string(runes[start:end])); sentence != "" {
			out = append(out, sentence)
		}
		start = end
	}
	if rest := strings.TrimSpace(string(runes[start:])); rest != "" {
		out = append(out, rest)
	}
	return out
}

func truncateMention(text string, max int) string {
	text = strings.Join(strings.Fields(text), " ")
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return strings.TrimSpace(string(runes[:max-1])) + "…"
}
