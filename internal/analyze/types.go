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

// Result is the rich enrichment of a transcript.
type Result struct {
	Sentiment  Sentiment   `json:"sentiment"`
	Emotions   []Emotion   `json:"emotions"`
	People     []Person    `json:"people"`
	Places     []Place     `json:"places"`
	Themes     []Theme     `json:"themes"`
	Summary    string      `json:"summary"`
	KeyMoments []KeyMoment `json:"key_moments"`
	Questions  []string    `json:"questions"`
	Decisions  []string    `json:"decisions"`

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
