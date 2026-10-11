// Package analyze enriches transcripts using an OpenAI-compatible API (for
// example, a local Ollama server). It is optional: when disabled, transcription
// and audio metrics keep working.
package analyze

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Config configures the analysis client.
type Config struct {
	Enabled bool
	BaseURL string
	APIKey  string
	Model   string
}

// Result is the enrichment of a transcript.
type Result struct {
	Model     string
	Sentiment float64
	Emotions  map[string]float64
	People    []string
	Places    []string
	Summary   string
	Raw       string
}

// Client talks to an OpenAI-compatible endpoint.
type Client struct {
	cfg  Config
	http *http.Client
}

// New builds a Client.
func New(cfg Config) *Client {
	return &Client{cfg: cfg, http: &http.Client{Timeout: 300 * time.Second}}
}

// Enabled reports whether analysis is turned on.
func (c *Client) Enabled() bool { return c.cfg.Enabled }

// ErrDisabled is returned when analysis is disabled.
var ErrDisabled = errors.New("analyze: disabled")

const systemPrompt = `Responda SOMENTE com um JSON valido, sem texto antes ou depois e sem markdown.
Use exatamente este formato:
{"sentiment": <numero entre -1 e 1>, "emotions": {"<emocao>": <0 a 1>}, "people": ["<nome>"], "places": ["<lugar>"], "summary": "<resumo com no maximo 15 palavras>"}
Seja breve. Nao invente pessoas ou lugares se nao houver.`

type chatRequest struct {
	Model          string        `json:"model"`
	Messages       []chatMessage `json:"messages"`
	Temperature    float64       `json:"temperature"`
	MaxTokens      int           `json:"max_tokens,omitempty"`
	ResponseFormat *respFormat   `json:"response_format,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type respFormat struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type analysisPayload struct {
	Sentiment float64            `json:"sentiment"`
	Emotions  map[string]float64 `json:"emotions"`
	People    []string           `json:"people"`
	Places    []string           `json:"places"`
	Summary   string             `json:"summary"`
}

// Analyze enriches the transcript text.
func (c *Client) Analyze(ctx context.Context, text string) (Result, error) {
	if !c.cfg.Enabled {
		return Result{}, ErrDisabled
	}
	if strings.TrimSpace(text) == "" {
		return Result{}, errors.New("analyze: texto vazio")
	}
	body := chatRequest{
		Model: c.cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: text},
		},
		Temperature:    0,
		MaxTokens:      400,
		ResponseFormat: &respFormat{Type: "json_object"},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return Result{}, err
	}
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("analyze: request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Result{}, fmt.Errorf("analyze: status %d", resp.StatusCode)
	}
	var out chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return Result{}, fmt.Errorf("analyze: decode response: %w", err)
	}
	if len(out.Choices) == 0 {
		return Result{}, errors.New("analyze: resposta sem escolhas")
	}
	content := out.Choices[0].Message.Content

	payload, err := decodeAnalysis(content)
	if err != nil {
		return Result{}, fmt.Errorf("analyze: decode content: %w", err)
	}
	return Result{
		Model:     c.cfg.Model,
		Sentiment: payload.Sentiment,
		Emotions:  payload.Emotions,
		People:    payload.People,
		Places:    payload.Places,
		Summary:   payload.Summary,
		Raw:       content,
	}, nil
}

// decodeAnalysis parses the model output, repairing truncated JSON by closing
// dangling strings/objects and dropping incomplete trailing members.
func decodeAnalysis(content string) (analysisPayload, error) {
	candidate := extractObject(content)
	for {
		if payload, ok := tryParse(candidate); ok {
			return payload, nil
		}
		if payload, ok := tryParse(closeJSON(candidate)); ok {
			return payload, nil
		}
		cut := lastBoundary(candidate)
		if cut <= 0 {
			break
		}
		candidate = strings.TrimRight(candidate[:cut], " \t\r\n")
	}
	return analysisPayload{}, errors.New("json invalido")
}

func tryParse(s string) (analysisPayload, bool) {
	var payload analysisPayload
	if err := json.Unmarshal([]byte(s), &payload); err != nil {
		return analysisPayload{}, false
	}
	return payload, true
}

// extractObject returns the substring starting at the first '{', up to the
// matching '}' when the object is complete, or the rest of the string when the
// object was truncated.
func extractObject(s string) string {
	s = strings.TrimSpace(s)
	i := strings.Index(s, "{")
	if i < 0 {
		return s
	}
	s = s[i:]
	var stack []rune
	inString, escaped := false, false
	for idx, r := range s {
		if inString {
			if escaped {
				escaped = false
			} else if r == '\\' {
				escaped = true
			} else if r == '"' {
				inString = false
			}
			continue
		}
		switch r {
		case '"':
			inString = true
		case '{', '[':
			stack = append(stack, r)
		case '}':
			if len(stack) > 0 && stack[len(stack)-1] == '{' {
				stack = stack[:len(stack)-1]
			}
		case ']':
			if len(stack) > 0 && stack[len(stack)-1] == '[' {
				stack = stack[:len(stack)-1]
			}
		}
		if len(stack) == 0 {
			return s[:idx+1]
		}
	}
	return s
}

// closeJSON closes an unterminated string and any open objects/arrays.
func closeJSON(s string) string {
	var stack []rune
	inString, escaped := false, false
	for _, r := range s {
		if inString {
			if escaped {
				escaped = false
			} else if r == '\\' {
				escaped = true
			} else if r == '"' {
				inString = false
			}
			continue
		}
		switch r {
		case '"':
			inString = true
		case '{', '[':
			stack = append(stack, r)
		case '}':
			if len(stack) > 0 && stack[len(stack)-1] == '{' {
				stack = stack[:len(stack)-1]
			}
		case ']':
			if len(stack) > 0 && stack[len(stack)-1] == '[' {
				stack = stack[:len(stack)-1]
			}
		}
	}
	s = strings.TrimRight(s, " \t\r\n,")
	if inString {
		s += `"`
	}
	for i := len(stack) - 1; i >= 0; i-- {
		if stack[i] == '{' {
			s += "}"
		} else {
			s += "]"
		}
	}
	return s
}

// lastBoundary returns the position of the last ',' (preferred) or '{', used to
// drop an incomplete trailing member.
func lastBoundary(s string) int {
	comma := strings.LastIndex(s, ",")
	if comma > 0 {
		return comma
	}
	return strings.LastIndex(s, "{")
}
