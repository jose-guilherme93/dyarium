// Package analyze enriches transcripts using an OpenAI-compatible API (for
// example, a local Ollama server). It is optional: when disabled, transcription
// and audio metrics keep working. This phase defines the surface.
package analyze

import (
	"context"
	"errors"
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
}

// Client talks to an OpenAI-compatible endpoint.
type Client struct {
	cfg Config
}

// New builds a Client.
func New(cfg Config) *Client { return &Client{cfg: cfg} }

// Enabled reports whether analysis is turned on.
func (c *Client) Enabled() bool { return c.cfg.Enabled }

// ErrDisabled is returned when analysis is disabled.
var ErrDisabled = errors.New("analyze: disabled")

// Analyze enriches text. It is implemented in a later phase.
func (c *Client) Analyze(context.Context, string) (Result, error) {
	if !c.cfg.Enabled {
		return Result{}, ErrDisabled
	}
	return Result{}, ErrDisabled
}
