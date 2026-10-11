package transcribe

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Deepgram transcribes audio using the Deepgram pre-recorded API.
type Deepgram struct {
	APIKey  string
	Model   string
	BaseURL string
}

// NewDeepgram builds a Deepgram client.
func NewDeepgram(apiKey, model, baseURL string) *Deepgram {
	if baseURL == "" {
		baseURL = "https://api.deepgram.com"
	}
	if model == "" {
		model = "nova-2"
	}
	return &Deepgram{APIKey: apiKey, Model: model, BaseURL: baseURL}
}

type deepgramWord struct {
	Word           string  `json:"word"`
	PunctuatedWord string  `json:"punctuated_word"`
	Start          float64 `json:"start"`
	End            float64 `json:"end"`
}

type deepgramResponse struct {
	Results struct {
		Channels []struct {
			DetectedLanguage string `json:"detected_language"`
			Alternatives     []struct {
				Transcript string         `json:"transcript"`
				Words      []deepgramWord `json:"words"`
				Paragraphs struct {
					Paragraphs []struct {
						Sentences []struct {
							Text  string  `json:"text"`
							Start float64 `json:"start"`
							End   float64 `json:"end"`
						} `json:"sentences"`
					} `json:"paragraphs"`
				} `json:"paragraphs"`
			} `json:"alternatives"`
		} `json:"channels"`
	} `json:"results"`
}

// Transcribe sends the audio file to Deepgram and returns segments. onSegment is
// called for each parsed segment (all at once, since the API is not streamed).
func (d *Deepgram) Transcribe(ctx context.Context, wavPath string, language string, onSegment func(Segment)) ([]Segment, string, error) {
	if d.APIKey == "" {
		return nil, "", fmt.Errorf("deepgram: api key ausente")
	}
	f, err := os.Open(wavPath)
	if err != nil {
		return nil, "", fmt.Errorf("deepgram: abrir audio: %w", err)
	}
	defer f.Close()

	q := url.Values{}
	q.Set("model", d.Model)
	q.Set("smart_format", "true")
	q.Set("punctuate", "true")
	q.Set("paragraphs", "true")
	if language != "" && language != "auto" {
		q.Set("language", language)
	}
	endpoint := strings.TrimRight(d.BaseURL, "/") + "/v1/listen?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, f)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Token "+d.APIKey)
	req.Header.Set("Content-Type", "audio/wav")

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("deepgram: request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("deepgram: status %d (%s)", resp.StatusCode, tail(string(body), 300))
	}

	var out deepgramResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, "", fmt.Errorf("deepgram: decode: %w", err)
	}
	segs, lang := parseDeepgram(out)
	for _, seg := range segs {
		if onSegment != nil {
			onSegment(seg)
		}
	}
	return segs, lang, nil
}

// parseDeepgram converts a Deepgram response into segments and the detected
// language.
func parseDeepgram(out deepgramResponse) ([]Segment, string) {
	if len(out.Results.Channels) == 0 || len(out.Results.Channels[0].Alternatives) == 0 {
		return nil, out.detectedLanguage()
	}
	channel := out.Results.Channels[0]
	alt := channel.Alternatives[0]

	var segments []Segment
	for _, p := range alt.Paragraphs.Paragraphs {
		for _, s := range p.Sentences {
			text := strings.TrimSpace(s.Text)
			if text == "" {
				continue
			}
			segments = append(segments, Segment{StartMS: int64(s.Start * 1000), EndMS: int64(s.End * 1000), Text: text})
		}
	}
	if len(segments) == 0 {
		segments = wordsToSegments(alt.Words)
	}
	if len(segments) == 0 {
		if text := strings.TrimSpace(alt.Transcript); text != "" {
			segments = []Segment{{StartMS: 0, EndMS: 0, Text: text}}
		}
	}
	return segments, channel.DetectedLanguage
}

func (out deepgramResponse) detectedLanguage() string {
	if len(out.Results.Channels) > 0 {
		return out.Results.Channels[0].DetectedLanguage
	}
	return ""
}

// wordsToSegments groups words into segments, breaking on pauses longer than
// 800 ms.
func wordsToSegments(words []deepgramWord) []Segment {
	var segments []Segment
	var current *Segment
	for _, w := range words {
		text := w.PunctuatedWord
		if text == "" {
			text = w.Word
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		start := int64(w.Start * 1000)
		end := int64(w.End * 1000)
		if current == nil {
			current = &Segment{StartMS: start, EndMS: end, Text: text}
			continue
		}
		if start-current.EndMS > 800 {
			segments = append(segments, *current)
			current = &Segment{StartMS: start, EndMS: end, Text: text}
		} else {
			current.EndMS = end
			current.Text += " " + text
		}
	}
	if current != nil {
		segments = append(segments, *current)
	}
	return segments
}
