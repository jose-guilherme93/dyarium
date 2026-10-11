// Package analyze enriches transcripts using an OpenAI-compatible API (for
// example, a local Ollama server or a hosted provider). It is optional: when
// disabled, transcription and audio metrics keep working.
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
	// Themes is the preferred theme list sent to the model. Empty means
	// DefaultThemes.
	Themes []string
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

// errUnsupportedFormat signals that the provider rejected the structured
// response format, so the caller can fall back to a plain JSON object.
var errUnsupportedFormat = errors.New("analyze: formato estruturado nao suportado")

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
	Type       string          `json:"type"`
	JSONSchema *jsonSchemaSpec `json:"json_schema,omitempty"`
}

type jsonSchemaSpec struct {
	Name   string          `json:"name"`
	Strict bool            `json:"strict"`
	Schema json.RawMessage `json:"schema"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// analysisSchemaJSON is the JSON schema requested when the provider supports
// structured outputs. It mirrors the Result type.
const analysisSchemaJSON = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["sentiment", "emotions", "people", "places", "themes", "summary", "key_moments", "questions", "decisions"],
  "properties": {
    "sentiment": {"type": "object", "additionalProperties": false, "required": ["score", "label"],
      "properties": {"score": {"type": "number"}, "label": {"type": "string"}}},
    "emotions": {"type": "array", "items": {"type": "object", "additionalProperties": false,
      "required": ["name", "intensity"], "properties": {"name": {"type": "string"}, "intensity": {"type": "number"}}}},
    "people": {"type": "array", "items": {"type": "object", "additionalProperties": false,
      "required": ["name", "count", "relation", "sentiment"],
      "properties": {"name": {"type": "string"}, "count": {"type": "integer"}, "relation": {"type": "string"}, "sentiment": {"type": "number"}}}},
    "places": {"type": "array", "items": {"type": "object", "additionalProperties": false,
      "required": ["name", "count"], "properties": {"name": {"type": "string"}, "count": {"type": "integer"}}}},
    "themes": {"type": "array", "items": {"type": "object", "additionalProperties": false,
      "required": ["name", "confidence"], "properties": {"name": {"type": "string"}, "confidence": {"type": "number"}}}},
    "summary": {"type": "string"},
    "key_moments": {"type": "array", "items": {"type": "object", "additionalProperties": false,
      "required": ["start_ms", "text"], "properties": {"start_ms": {"type": "integer"}, "text": {"type": "string"}}}},
    "questions": {"type": "array", "items": {"type": "string"}},
    "decisions": {"type": "array", "items": {"type": "string"}}
  }
}`

// Analyze enriches a single window of transcript text.
func (c *Client) Analyze(ctx context.Context, text string) (Result, error) {
	if !c.cfg.Enabled {
		return Result{}, ErrDisabled
	}
	if strings.TrimSpace(text) == "" {
		return Result{}, errors.New("analyze: texto vazio")
	}
	content, err := c.do(ctx, c.systemPrompt(), text, 1500)
	if err != nil {
		return Result{}, err
	}
	result, err := decodeJSONRepair[Result](content)
	if err != nil {
		return Result{}, fmt.Errorf("analyze: decode content: %w", err)
	}
	result.Model = c.cfg.Model
	result.Raw = content
	return result, nil
}

// ListModels returns the model ids advertised by the provider's /models
// endpoint (OpenAI-compatible).
func (c *Client) ListModels(ctx context.Context) ([]string, error) {
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/models"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("analyze: list models: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("analyze: list models: status %d", resp.StatusCode)
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("analyze: list models: %w", err)
	}
	var ids []string
	seen := map[string]bool{}
	add := func(id string) {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, m := range payload.Data {
		add(m.ID)
	}
	for _, m := range payload.Models {
		if m.ID != "" {
			add(m.ID)
		} else {
			add(m.Name)
		}
	}
	return ids, nil
}

// Summarize combines the partial summaries into a single one (meta-summary).
func (c *Client) Summarize(ctx context.Context, summaries []string) (string, error) {
	joined := strings.TrimSpace(strings.Join(summaries, "\n"))
	if joined == "" {
		return "", nil
	}
	content, err := c.do(ctx, summarySystemPrompt, joined, 300)
	if err != nil {
		return "", err
	}
	payload, err := decodeJSONRepair[summaryPayload](content)
	if err != nil {
		return "", fmt.Errorf("analyze: decode summary: %w", err)
	}
	return payload.Summary, nil
}

// do performs a chat completion, trying a strict JSON schema first and falling
// back to a plain JSON object when the provider rejects it.
func (c *Client) do(ctx context.Context, system, user string, maxTokens int) (string, error) {
	content, err := c.call(ctx, system, user, maxTokens, true)
	if errors.Is(err, errUnsupportedFormat) {
		return c.call(ctx, system, user, maxTokens, false)
	}
	return content, err
}

func (c *Client) call(ctx context.Context, system, user string, maxTokens int, useSchema bool) (string, error) {
	body := chatRequest{
		Model: c.cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		Temperature: 0,
		MaxTokens:   maxTokens,
	}
	if useSchema {
		body.ResponseFormat = &respFormat{
			Type: "json_schema",
			JSONSchema: &jsonSchemaSpec{
				Name:   "analysis",
				Strict: true,
				Schema: json.RawMessage(analysisSchemaJSON),
			},
		}
	} else {
		body.ResponseFormat = &respFormat{Type: "json_object"}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("analyze: request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if useSchema && (resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnprocessableEntity) {
			return "", fmt.Errorf("%w: status %d", errUnsupportedFormat, resp.StatusCode)
		}
		return "", fmt.Errorf("analyze: status %d", resp.StatusCode)
	}
	var out chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("analyze: decode response: %w", err)
	}
	if len(out.Choices) == 0 {
		return "", errors.New("analyze: resposta sem escolhas")
	}
	content := out.Choices[0].Message.Content
	if strings.TrimSpace(content) == "" {
		return "", errors.New("analyze: resposta sem conteudo")
	}
	return content, nil
}

// systemPrompt builds the pt-BR analyst prompt with the preferred theme list.
func (c *Client) systemPrompt() string {
	themes := c.cfg.Themes
	if len(themes) == 0 {
		themes = DefaultThemes
	}
	return strings.Replace(systemPromptTemplate, "{themes}", strings.Join(themes, ", "), 1)
}

const systemPromptTemplate = `Voce analisa a transcricao de um diario pessoal falado em portugues.
Responda SOMENTE com um objeto JSON valido, sem texto antes ou depois e sem markdown.
Use exatamente este formato:
{"sentiment": {"score": <-1 a 1>, "label": "positivo|neutro|negativo"},
 "emotions": [{"name": "<emocao em pt-BR>", "intensity": <0 a 1>}],
 "people": [{"name": "<nome>", "count": <numero de mencoes>, "relation": "<relacao com o autor ou vazio>", "sentiment": <-1 a 1>}],
 "places": [{"name": "<lugar>", "count": <numero de mencoes>}],
 "themes": [{"name": "<tema>", "confidence": <0 a 1>}],
 "summary": "<resumo curto, ate 60 palavras>",
 "key_moments": [{"start_ms": <tempo em milissegundos>, "text": "<trecho marcante>"}],
 "questions": ["<pergunta que o autor fez>"],
 "decisions": ["<decisao que o autor tomou>"]}
Regras: seja fiel ao texto e nao invente pessoas, lugares ou fatos; preencha "relation" e "sentiment" de pessoas
somente quando for inferivel; use os tempos [mm:ss] presentes no texto para calcular "start_ms"; prefira os temas:
{themes}; liste no maximo 5 momentos-chave; perguntas e decisoes devem ser curtas, no maximo 5 cada.`

const summarySystemPrompt = `Voce resume analises parciais de um diario falado.
Recebe, em ordem, os resumos dos trechos e devolve SOMENTE um JSON no formato
{"summary": "<resumo unico, ate 60 palavras, em pt-BR>"}.
Combine os resumos sem inventar fatos.`

type summaryPayload struct {
	Summary string `json:"summary"`
}

// decodeJSONRepair parses the model output, repairing truncated JSON by closing
// dangling strings/objects and dropping incomplete trailing members.
func decodeJSONRepair[T any](content string) (T, error) {
	candidate := extractObject(content)
	for {
		var value T
		if json.Unmarshal([]byte(candidate), &value) == nil {
			return value, nil
		}
		var closed T
		if json.Unmarshal([]byte(closeJSON(candidate)), &closed) == nil {
			return closed, nil
		}
		cut := lastBoundary(candidate)
		if cut <= 0 {
			break
		}
		candidate = strings.TrimRight(candidate[:cut], " \t\r\n")
	}
	var zero T
	return zero, errors.New("json invalido")
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
