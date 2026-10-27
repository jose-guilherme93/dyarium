package analyze

// Sentiment is the overall tone of an entry.
type Sentiment struct {
	Score float64 `json:"score"`
	Label string  `json:"label"`
}

// Emotion is a feeling with its intensity (0 a 1).
type Emotion struct {
	Name      string  `json:"name"`
	Intensity float64 `json:"intensity"`
}

// Person is a mentioned person with the number of mentions, the relation to the
// author (when inferable) and the associated sentiment.
type Person struct {
	Name      string  `json:"name"`
	Count     int     `json:"count"`
	Relation  string  `json:"relation"`
	Sentiment float64 `json:"sentiment"`
}

// Place is a mentioned place with the number of mentions.
type Place struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Theme is a topic with a confidence (0 a 1).
type Theme struct {
	Name       string  `json:"name"`
	Confidence float64 `json:"confidence"`
}

// KeyMoment is a relevant excerpt with its offset in the audio (ms).
type KeyMoment struct {
	StartMS int    `json:"start_ms"`
	Text    string `json:"text"`
}

// Section is one analyzable part of a note: a heading section of the written
// text or the audio transcript. A long note is analyzed section by section, so
// the result is an analysis of each part and of the whole — not one label for
// five thousand words.
type Section struct {
	// Heading is the section title (a markdown heading) or the kind of content,
	// e.g. "Transcrição do áudio". Empty for text before the first heading.
	Heading string
	Text    string
	// Kind is "text" or "transcript"; transcript sections keep their segments so
	// key moments can carry an audio offset.
	Kind     string
	Segments []Segment
}

// SectionAnalysis is what the model read in one section, kept with the note
// analysis so the insights can be read part by part.
type SectionAnalysis struct {
	Heading    string      `json:"heading"`
	Kind       string      `json:"kind"`
	Reading    string      `json:"reading"`
	Summary    string      `json:"summary"`
	Sentiment  Sentiment   `json:"sentiment"`
	Themes     []Theme     `json:"themes"`
	KeyMoments []KeyMoment `json:"key_moments"`
	Questions  []string    `json:"questions"`
	Decisions  []string    `json:"decisions"`
}

// Result is the rich enrichment of a note.
type Result struct {
	// Comprehension is the model estimate (0-100) of how well the text it read
	// represents the speech. The revision pass overrides it with its own
	// estimate when it runs.
	Comprehension int       `json:"comprehension"`
	Sentiment     Sentiment `json:"sentiment"`
	Emotions      []Emotion `json:"emotions"`
	People        []Person  `json:"people"`
	Places        []Place   `json:"places"`
	Themes        []Theme   `json:"themes"`
	Summary       string    `json:"summary"`
	// Reading is the actual analysis: a few sentences on what the note says,
	// what it means and what repeats. Proportional to the text, not a label.
	Reading    string      `json:"reading"`
	KeyMoments []KeyMoment `json:"key_moments"`
	Questions  []string    `json:"questions"`
	Decisions  []string    `json:"decisions"`
	// Sections holds the per-section reading, in reading order.
	Sections []SectionAnalysis `json:"sections,omitempty"`

	Model string `json:"-"`
	Raw   string `json:"-"`
}

// Segment is a piece of the transcript with its time offset in the audio.
type Segment struct {
	StartMS int
	EndMS   int
	Text    string
}

// DefaultThemes is the fixed theme list used when none is configured.
var DefaultThemes = []string{
	"familia", "trabalho", "saude", "relacionamentos", "dinheiro",
	"fe", "viagem", "estudos", "lazer", "casa", "amigos",
}

// sentimentLabel maps a score in [-1, 1] to a pt-BR label.
func sentimentLabel(score float64) string {
	switch {
	case score <= -0.15:
		return "negativo"
	case score >= 0.15:
		return "positivo"
	default:
		return "neutro"
	}
}
