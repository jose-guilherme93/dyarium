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
	return &Client{cfg: cfg, http: &http.Client{Timeout: 120 * time.Second}}
}

// Enabled reports whether analysis is turned on.
func (c *Client) Enabled() bool { return c.cfg.Enabled }

// ErrDisabled is returned when analysis is disabled.
var ErrDisabled = errors.New("analyze: disabled")

const systemPrompt = `Voce analisa transcricoes de um diario falado em portugues.
Responda APENAS com um objeto JSON, sem texto adicional, com os campos:
"sentiment": numero entre -1 e 1 (negativo a positivo),
"emotions": objeto com rotulos e intensidades entre 0 e 1,
"people": lista de nomes de pessoas mencionadas,
"places": lista de lugares mencionados,
"summary": resumo curto em uma ou duas frases.`

type chatRequest struct {
	Model          string        `json:"model"`
	Messages       []chatMessage `json:"messages"`
	Temperature    float64       `json:"temperature"`
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

	var payload analysisPayload
	if err := json.Unmarshal([]byte(extractJSON(content)), &payload); err != nil {
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

// extractJSON tolerates models that wrap the JSON in prose or code fences.
func extractJSON(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "{"); i >= 0 {
		if j := strings.LastIndex(s, "}"); j > i {
			return s[i : j+1]
		}
	}
	return s
}
