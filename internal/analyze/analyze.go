// Package analyze enriches transcripts using an OpenAI-compatible API (for
// example, a local Ollama server or a hosted provider). It is optional: when
// disabled, transcription and audio metrics keep working.
package analyze

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Provider kinds.
const (
	ProviderOpenAI   = "openai"   // OpenAI-compatible /chat/completions
	ProviderOpenCode = "opencode" // local OpenCode server
)

// Config configures the analysis client.
type Config struct {
	Enabled bool
	// Provider selects the API shape: "openai" (default) or "opencode" (local
	// OpenCode server, using the user's OpenCode login instead of an API key).
	Provider string
	BaseURL  string
	APIKey   string
	Model    string
	// Language is the transcript language code (e.g. "pt", "en"). The model is
	// asked to answer in this language. Empty means "same as the transcript".
	Language string
	// Themes is the preferred theme list sent to the model. Empty means
	// DefaultThemes.
	Themes []string
	// Author is the effective author role of the note being analyzed:
	// self, other, mixed or empty (unknown). The prompt uses it to interpret
	// first person and the relation of the people mentioned.
	Author string
	// OwnerName is the name the diarist chose, used only to make the prompt
	// concrete. Empty is fine.
	OwnerName string
	// AllNotesMine is the app default used when a note has no explicit author.
	AllNotesMine bool
}

// languageName maps a language code to a pt-BR name used in the prompt.
func languageName(code string) string {
	switch strings.ToLower(strings.TrimSpace(code)) {
	case "pt", "pt-br", "pt_br":
		return "portugues"
	case "en", "en-us", "en-gb":
		return "ingles"
	case "es":
		return "espanhol"
	case "fr":
		return "frances"
	case "de":
		return "alemao"
	case "it":
		return "italiano"
	case "ja":
		return "japones"
	case "zh":
		return "chines"
	case "ru":
		return "russo"
	case "ar":
		return "arabe"
	case "hi":
		return "hindi"
	default:
		return "o mesmo idioma da transcricao"
	}
}

// ParseModelRef splits a "provider/model" reference. Without a slash the model
// id is returned alone.
func ParseModelRef(ref string) (providerID, modelID string) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", ""
	}
	if i := strings.IndexByte(ref, '/'); i >= 0 {
		return ref[:i], ref[i+1:]
	}
	return "", ref
}

// Client talks to an OpenAI-compatible endpoint.
type Client struct {
	cfg       Config
	http      *http.Client
	sessionID string

	usageMu          sync.Mutex
	promptTokens     int
	completionTokens int
}

// Usage returns the accumulated tokens of the calls made by this client. The
// OpenCode provider does not report usage, so its counters stay at zero.
func (c *Client) Usage() (prompt, completion int) {
	c.usageMu.Lock()
	defer c.usageMu.Unlock()
	return c.promptTokens, c.completionTokens
}

func (c *Client) addUsage(prompt, completion int) {
	if prompt <= 0 && completion <= 0 {
		return
	}
	c.usageMu.Lock()
	c.promptTokens += prompt
	c.completionTokens += completion
	c.usageMu.Unlock()
}

// New builds a Client. The session id is what the OpenCode gateway uses to
// route and cache a conversation; it stays stable for the whole analysis run.
func New(cfg Config) *Client {
	return &Client{cfg: cfg, http: &http.Client{Timeout: 300 * time.Second}, sessionID: newSessionID()}
}

func newSessionID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("dyarium-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw[:])
}

// gatewayHeaders identifies the client and, on the OpenCode gateway, sends the
// session id the service requires (without it every request is rejected with
// 400 MissingSessionID, even with a valid key).
func (c *Client) gatewayHeaders(req *http.Request) {
	req.Header.Set("User-Agent", "dyarium/1.0")
	if strings.Contains(c.cfg.BaseURL, "opencode.ai") && c.sessionID != "" {
		req.Header.Set("x-opencode-session", c.sessionID)
	}
}

// Enabled reports whether analysis is turned on.
func (c *Client) Enabled() bool { return c.cfg.Enabled }

// ErrDisabled is returned when analysis is disabled.
var ErrDisabled = errors.New("analyze: disabled")

// errUnsupportedFormat signals that the provider rejected the structured
// response format, so the caller can fall back to a plain JSON object.
var errUnsupportedFormat = errors.New("analyze: formato estruturado nao suportado")

// FriendlyError maps a provider error to a short pt-BR message safe to show to
// the user. The technical detail stays in the server log.
func FriendlyError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	switch {
	case strings.Contains(message, "status 400"):
		return "o provedor recusou a requisicao (confira modelo, endpoint e chave)"
	case strings.Contains(message, "status 401"), strings.Contains(message, "status 403"):
		return "chave da API invalida ou sem permissao no provedor"
	case strings.Contains(message, "status 402"):
		return "sem saldo ou cota no provedor de IA"
	case strings.Contains(message, "status 404"):
		return "modelo nao encontrado no provedor"
	case strings.Contains(message, "status 429"):
		return "limite de uso do provedor atingido, tente mais tarde"
	case strings.Contains(message, "status 5"):
		return "provedor de IA indisponivel no momento"
	case strings.Contains(message, "texto vazio"), strings.Contains(message, "transcricao vazia"),
		strings.Contains(message, "transcricao indisponivel"):
		return "nao ha texto para analisar nesta nota"
	case strings.Contains(message, "json invalido"):
		return "a IA respondeu em um formato inesperado"
	case strings.Contains(message, "resposta sem conteudo"):
		return "a IA nao devolveu texto; tente analisar de novo"
	case strings.Contains(message, "connection refused"), strings.Contains(message, "dial tcp"),
		strings.Contains(message, "no such host"), strings.Contains(message, "timeout"),
		strings.Contains(message, "context deadline exceeded"):
		return "nao foi possivel conectar ao provedor de IA (verifique a URL e a rede)"
	default:
		return "falha ao analisar com a IA"
	}
}

// Retryable reports whether a failed analysis may succeed on a new attempt. A
// wrong key, model or endpoint will not fix itself, so it is final; rate limits,
// timeouts and provider outages are worth retrying.
func Retryable(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	for _, code := range []int{400, 401, 402, 403, 404, 422} {
		if strings.Contains(message, fmt.Sprintf("status %d", code)) {
			return false
		}
	}
	return true
}

// ErrorClass maps a provider error to a stable, content-free class for the
// diagnostics. The raw error stays in the job log; the run row only stores this.
func ErrorClass(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "stopped"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "status 401"), strings.Contains(message, "status 403"):
		return "auth"
	case strings.Contains(message, "status 402"):
		return "quota"
	case strings.Contains(message, "status 429"):
		return "rate_limit"
	case strings.Contains(message, "status 5"):
		return "provider"
	case strings.Contains(message, "decode content"), strings.Contains(message, "decode summary"),
		strings.Contains(message, "json invalido"):
		return "invalid_json"
	case strings.Contains(message, "timeout"), strings.Contains(message, "deadline"):
		return "timeout"
	case strings.Contains(message, "connection refused"), strings.Contains(message, "dial tcp"),
		strings.Contains(message, "no such host"):
		return "network"
	default:
		return "unknown"
	}
}

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
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

// providerAnswer is one answer with the metadata that says whether it was cut
// short. A reasoning model can spend the whole budget thinking and return
// finish_reason "length" with empty content.
type providerAnswer struct {
	content string
	finish  string
	usage   struct {
		prompt     int
		completion int
	}
}

// maxReasoningTokens is the floor of the ceiling reached when the budget has to
// grow. A reasoning model needs room for the thoughts and for the answer.
const maxReasoningTokens = 8000

// providerTokenCeiling is the hard ceiling most providers accept for one answer.
// The product does not choose a smaller one: the budget follows the content.
const providerTokenCeiling = 32000

// answerBudget is how many tokens the answer may take, derived from the size of
// the text being read. A fixed 1500 cut long notes; the limit now is the
// content itself, bounded only by the provider's ceiling.
func answerBudget(text string) int {
	budget := 2000 + len([]rune(text))/4
	if budget < 2000 {
		budget = 2000
	}
	if budget > providerTokenCeiling {
		budget = providerTokenCeiling
	}
	return budget
}

// budgetCeiling is how far the retry may grow the starting budget.
func budgetCeiling(start int) int {
	ceiling := start * 8
	if ceiling < maxReasoningTokens {
		ceiling = maxReasoningTokens
	}
	if ceiling > providerTokenCeiling {
		ceiling = providerTokenCeiling
	}
	return ceiling
}

// analysisSchemaJSON is the JSON schema requested when the provider supports
// structured outputs. It mirrors the Result type.
const analysisSchemaJSON = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["comprehension", "sentiment", "emotions", "people", "places", "themes", "summary", "reading", "key_moments", "questions", "decisions"],
  "properties": {
    "comprehension": {"type": "integer"},
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
    "reading": {"type": "string"},
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
	content, err := c.do(ctx, c.systemPrompt(), text, answerBudget(text))
	if err != nil {
		return Result{}, err
	}
	result, err := decodeJSONRepair[Result](content)
	if err != nil {
		return Result{}, fmt.Errorf("analyze: decode content: %w", err)
	}
	// A prosa e legenda das metricas: no maximo duas frases, uma linha.
	result = limitProse(result)
	result.Model = c.cfg.Model
	result.Raw = content
	return result, nil
}

// ListModels returns the model ids advertised by the provider's /models
// endpoint (OpenAI-compatible).
func (c *Client) ListModels(ctx context.Context) ([]string, error) {
	if c.cfg.Provider == ProviderOpenCode {
		return c.listModelsOpenCode(ctx)
	}
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/models"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	c.gatewayHeaders(req)
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
	content, err := c.do(ctx, summarySystemPrompt(languageName(c.cfg.Language)), joined, 300)
	if err != nil {
		return "", err
	}
	payload, err := decodeJSONRepair[summaryPayload](content)
	if err != nil {
		return "", fmt.Errorf("analyze: decode summary: %w", err)
	}
	return shortenProse(payload.Summary, summaryMaxSentences, summaryMaxChars), nil
}

// do performs a chat completion, trying a strict JSON schema first and falling
// back to a plain JSON object when the provider rejects it.
func (c *Client) do(ctx context.Context, system, user string, maxTokens int) (string, error) {
	return c.doWithSchema(ctx, system, user, maxTokens, "analysis", analysisSchemaJSON)
}

// doWithSchema runs one completion asking for a JSON schema, falling back to a
// plain JSON object when the provider rejects strict schemas.
func (c *Client) doWithSchema(ctx context.Context, system, user string, maxTokens int, name, schema string) (string, error) {
	content, err := c.call(ctx, system, user, maxTokens, true, name, schema)
	if errors.Is(err, errUnsupportedFormat) {
		return c.call(ctx, system, user, maxTokens, false, name, schema)
	}
	return content, err
}

func (c *Client) call(ctx context.Context, system, user string, maxTokens int, useSchema bool, name, schema string) (string, error) {
	if c.cfg.Provider == ProviderOpenCode {
		return c.callOpenCode(ctx, system, user)
	}
	format := formatJSON
	if useSchema {
		format = formatSchema
	}
	budget := maxTokens
	for attempt := 0; ; attempt++ {
		answer, err := c.postChat(ctx, system, user, budget, format, name, schema)
		if err != nil {
			return "", err
		}
		content := strings.TrimSpace(answer.content)
		// Modelo de raciocinio: o teto pode ser gasto pensando, e a resposta
		// volta vazia ou cortada. Dobrar o orcamento resolve; repetir com o
		// mesmo teto produziria o mesmo corte (foi assim que uma nota inteira
		// ficou marcada como falha cinco vezes seguidas).
		ceiling := budgetCeiling(maxTokens)
		if (content == "" || answer.finish == "length") && attempt < 3 && budget < ceiling {
			budget *= 2
			if budget > ceiling {
				budget = ceiling
			}
			continue
		}
		if content == "" {
			return "", errors.New("analyze: resposta sem conteudo")
		}
		c.addUsage(answer.usage.prompt, answer.usage.completion)
		return content, nil
	}
}

// Ping confirma que o provedor responde antes de a analise comecar: chave,
// endpoint e modelo. Sem isso o usuario so descobria que a IA nao respondia
// depois de a nota inteira falhar.
func (c *Client) Ping(ctx context.Context) error {
	if !c.cfg.Enabled {
		return ErrDisabled
	}
	if c.cfg.Provider == ProviderOpenCode {
		_, err := c.callOpenCode(ctx, "", "ping")
		return err
	}
	// Uma resposta vazia ainda e um provedor saudavel: o modelo de raciocinio
	// pode gastar o teto pensando. O que o ping mede e chave, endpoint e modelo
	// respondendo, nao a qualidade da resposta.
	// Sem formato de resposta: pedir JSON sem falar de JSON no prompt faz o
	// provedor recusar a requisicao com 400, e o ping acusaria a IA errada.
	_, err := c.postChat(ctx, "Responda apenas: ok", "ping", 256, formatNone, "ping", "")
	return err
}

// callFormat is what the request asks the provider to return.
type callFormat int

const (
	// formatSchema asks for the strict JSON schema.
	formatSchema callFormat = iota
	// formatJSON asks for any JSON object.
	formatJSON
	// formatNone asks for plain text (the preflight ping).
	formatNone
)

// postChat performs one chat completion. It returns the answer with its finish
// reason so the caller can tell a cut answer from a complete one.
func (c *Client) postChat(ctx context.Context, system, user string, maxTokens int, format callFormat, name, schema string) (providerAnswer, error) {
	var out providerAnswer
	body := chatRequest{
		Model: c.cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		Temperature: 0,
		MaxTokens:   maxTokens,
	}
	switch format {
	case formatSchema:
		body.ResponseFormat = &respFormat{
			Type: "json_schema",
			JSONSchema: &jsonSchemaSpec{
				Name:   name,
				Strict: true,
				Schema: json.RawMessage(schema),
			},
		}
	case formatJSON:
		body.ResponseFormat = &respFormat{Type: "json_object"}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return out, err
	}
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	c.gatewayHeaders(req)
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return out, fmt.Errorf("analyze: request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		detail := strings.TrimSpace(string(snippet))
		if format == formatSchema && (resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnprocessableEntity) {
			return out, fmt.Errorf("%w: status %d: %s", errUnsupportedFormat, resp.StatusCode, detail)
		}
		return out, fmt.Errorf("analyze: status %d: %s", resp.StatusCode, detail)
	}
	var decoded chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return out, fmt.Errorf("analyze: decode response: %w", err)
	}
	if len(decoded.Choices) == 0 {
		return out, errors.New("analyze: resposta sem escolhas")
	}
	out.content = decoded.Choices[0].Message.Content
	out.finish = decoded.Choices[0].FinishReason
	out.usage.prompt = decoded.Usage.PromptTokens
	out.usage.completion = decoded.Usage.CompletionTokens
	return out, nil
}

// authBasic builds the HTTP Basic header used by the local OpenCode server
// (username "opencode", password from the service registration).
func (c *Client) authBasic() string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte("opencode:"+c.cfg.APIKey))
}

// callOpenCode runs a one-shot generation on the local OpenCode server, which
// authenticates the user via their OpenCode login.
func (c *Client) callOpenCode(ctx context.Context, system, user string) (string, error) {
	prompt := user
	if strings.TrimSpace(system) != "" {
		prompt = system + "\n\n" + user
	}
	body := map[string]any{"prompt": prompt}
	if providerID, modelID := ParseModelRef(c.cfg.Model); providerID != "" && modelID != "" {
		body["model"] = map[string]string{"providerID": providerID, "id": modelID}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/api/experimental/generate"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", c.authBasic())
	c.gatewayHeaders(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("analyze: opencode: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("analyze: status %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
	var out struct {
		Data struct {
			Text string `json:"text"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("analyze: opencode decode: %w", err)
	}
	if strings.TrimSpace(out.Data.Text) == "" {
		return "", errors.New("analyze: opencode resposta vazia")
	}
	return out.Data.Text, nil
}

// listModelsOpenCode lists "provider/model" ids from the local OpenCode server.
func (c *Client) listModelsOpenCode(ctx context.Context) ([]string, error) {
	url := strings.TrimRight(c.cfg.BaseURL, "/") + "/api/model"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.authBasic())
	c.gatewayHeaders(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("analyze: opencode models: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("analyze: opencode models: status %d", resp.StatusCode)
	}
	var payload any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("analyze: opencode models decode: %w", err)
	}
	var ids []string
	seen := map[string]bool{}
	var walk func(value any)
	walk = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			id, _ := node["id"].(string)
			providerID, _ := node["providerID"].(string)
			if id != "" && providerID != "" {
				ref := providerID + "/" + id
				if !seen[ref] {
					seen[ref] = true
					ids = append(ids, ref)
				}
			}
			for _, child := range node {
				walk(child)
			}
		case []any:
			for _, item := range node {
				walk(item)
			}
		}
	}
	walk(payload)
	return ids, nil
}

// systemPrompt builds the analyst prompt with the preferred theme list and the
// transcript language.
func (c *Client) systemPrompt() string {
	themes := c.cfg.Themes
	if len(themes) == 0 {
		themes = DefaultThemes
	}
	prompt := strings.Replace(systemPromptTemplate, "{themes}", strings.Join(themes, ", "), 1)
	prompt = strings.Replace(prompt, "{author}", c.authorLine(), 1)
	return strings.Replace(prompt, "{language}", languageName(c.cfg.Language), 1)
}

// authorLine is the only place the model learns who recorded the note. When the
// role is empty it says so instead of guessing: a private diary can hold a
// quoted speech or an imported audio that is not the diarist's.
func (c *Client) authorLine() string {
	name := strings.TrimSpace(c.cfg.OwnerName)
	switch c.cfg.Author {
	case "self":
		if name != "" {
			return "Quem gravou este audio foi o proprio autor do diario (" + name + "); a primeira pessoa no texto e ele."
		}
		return "Quem gravou este audio foi o proprio autor do diario; a primeira pessoa no texto e ele."
	case "other":
		if name != "" {
			return "Quem gravou este audio foi outra pessoa, nao o autor do diario (" + name + "); nao trate a primeira pessoa do texto como o autor."
		}
		return "Quem gravou este audio foi outra pessoa, nao o autor do diario; nao trate a primeira pessoa do texto como o autor."
	case "mixed":
		if name != "" {
			return "Este audio tem o autor do diario (" + name + ") e outras pessoas; so atribua a primeira pessoa ao autor quando o texto deixar claro."
		}
		return "Este audio tem o autor do diario e outras pessoas; so atribua a primeira pessoa ao autor quando o texto deixar claro."
	default:
		return "Nao se sabe quem gravou este audio; nao assuma que a primeira pessoa do texto e o autor do diario."
	}
}

const systemPromptTemplate = `Voce analisa uma nota de diario pessoal: o texto que a pessoa escreveu e/ou a
transcricao do audio. Leia o material inteiro antes de responder; nao resuma so o comeco.
{author}
Responda SOMENTE com um objeto JSON valido, sem texto antes ou depois e sem markdown.
Use exatamente este formato:
{"comprehension": <0 a 100>,
 "sentiment": {"score": <-1 a 1>, "label": "positivo|neutro|negativo"},
 "emotions": [{"name": "<emocao em pt-BR>", "intensity": <0 a 1>}],
 "people": [{"name": "<nome>", "count": <numero de mencoes>, "relation": "<relacao com o autor ou vazio>", "sentiment": <-1 a 1>}],
 "places": [{"name": "<lugar>", "count": <numero de mencoes>}],
 "themes": [{"name": "<tema>", "confidence": <0 a 1>}],
 "summary": "<uma frase com o que foi dito, ate 15 palavras>",
 "reading": "<no maximo 2 frases curtas sobre o que o texto revela>",
 "key_moments": [{"start_ms": <tempo em milissegundos>, "text": "<trecho marcante>"}],
 "questions": ["<pergunta que o autor fez>"],
 "decisions": ["<decisao que o autor tomou>"]}
"comprehension" e uma estimativa textual de 0 a 100 de quanto o texto representa a fala com logica, sintaxe e
concordancia: 100 para um texto perfeito, 0 para um texto incompreensivel. Voce nao ouve o audio.
"reading" tem no maximo 2 frases e 280 caracteres: diga o que o texto revela (tensao, repeticao, o que fica
em aberto), sem paragrafo e sem rotulo generico ("tom negativo", "texto pessoal"). O que importa sao as
metricas: sentimento, emocoes, pessoas, lugares, temas e momentos-chave. Nao escreva relatorio.
Regras: seja fiel ao texto e nao invente pessoas, lugares ou fatos; preencha "relation" e "sentiment" de pessoas
somente quando for inferivel; use os tempos [mm:ss] presentes no texto para calcular "start_ms"; prefira os temas:
{themes}; liste ate 8 momentos-chave quando o texto for longo; perguntas e decisoes devem ser curtas, ate 8 cada.
Escreva todo o conteudo textual (resumo, analise, nomes de emocoes, relacoes, perguntas e decisoes) em {language}.
Texto curto: cada campo textual e uma linha, sem paragrafo.`

// sectionSystemPrompt scopes the analysis to one part of the note. Each section
// gets its own reading, so a long note is not one label for everything.
func sectionSystemPrompt(themes []string, language, heading, author string) string {
	if len(themes) == 0 {
		themes = DefaultThemes
	}
	prompt := `Voce analisa UMA secao de uma nota de diario pessoal. Leia o trecho inteiro; nao pare no comeco.
A secao se chama "` + heading + `" (vazia significa o texto antes do primeiro titulo).
` + author + `
Responda SOMENTE com um objeto JSON valido, sem markdown, no formato:
{"comprehension": <0 a 100>,
 "sentiment": {"score": <-1 a 1>, "label": "positivo|neutro|negativo"},
 "emotions": [{"name": "<emocao em pt-BR>", "intensity": <0 a 1>}],
 "people": [{"name": "<nome>", "count": <mencoes>, "relation": "<relacao ou vazio>", "sentiment": <-1 a 1>}],
 "places": [{"name": "<lugar>", "count": <mencoes>}],
 "themes": [{"name": "<tema>", "confidence": <0 a 1>}],
 "summary": "<uma frase com o que esta secao diz, ate 15 palavras>",
 "reading": "<no maximo 2 frases curtas sobre o que a secao revela>",
 "key_moments": [{"start_ms": <ms>, "text": "<trecho marcante>"}],
 "questions": ["<pergunta do autor>"],
 "decisions": ["<decisao do autor>"]}
"reading" tem no maximo 2 frases e 280 caracteres: interprete o que o trecho revela, apoiado em algo dito,
sem paragrafo. Use os tempos [mm:ss] presentes no texto para calcular "start_ms"; se a secao nao tiver
tempos, devolva "key_moments" vazio. O que importa sao as metricas da secao: sentimento, emocoes, pessoas,
lugares, temas e momentos. Prefira os temas: ` + strings.Join(themes, ", ") + `. Escreva em ` + language + `.`
	return prompt
}

const synthesisPromptTemplate = `Voce le as analises das secoes de uma nota de diario pessoal e escreve a sintese da nota.
Recebe um JSON com o titulo e as secoes ja analisadas. Responda SOMENTE com um JSON no formato:
{"summary": "<uma frase com o que a nota inteira diz, ate 15 palavras>",
 "reading": "<no maximo 2 frases curtas ligando as secoes>",
 "sentiment": {"score": <-1 a 1>, "label": "positivo|neutro|negativo"},
 "themes": [{"name": "<tema>", "confidence": <0 a 1>}]}
Nao invente fatos que nao estejam nas secoes. Nao repita as secoes uma a uma: diga o que elas juntas revelam,
em no maximo 2 frases e 280 caracteres, sem paragrafo. Escreva em {language}.`

const synthesisSchemaJSON = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "reading", "sentiment", "themes"],
  "properties": {
    "summary": {"type": "string"},
    "reading": {"type": "string"},
    "sentiment": {"type": "object", "additionalProperties": false, "required": ["score", "label"],
      "properties": {"score": {"type": "number"}, "label": {"type": "string"}}},
    "themes": {"type": "array", "items": {"type": "object", "additionalProperties": false,
      "required": ["name", "confidence"], "properties": {"name": {"type": "string"}, "confidence": {"type": "number"}}}}
  }
}`

// AnalyzeSection reads one section of a note and returns its own analysis.
func (c *Client) AnalyzeSection(ctx context.Context, title string, section Section) (Result, error) {
	if !c.cfg.Enabled {
		return Result{}, ErrDisabled
	}
	text := strings.TrimSpace(section.Text)
	if text == "" {
		return Result{}, errors.New("analyze: secao vazia")
	}
	themes := c.cfg.Themes
	if len(themes) == 0 {
		themes = DefaultThemes
	}
	system := sectionSystemPrompt(themes, languageName(c.cfg.Language), section.Heading, c.authorLine())
	user := text
	if t := strings.TrimSpace(title); t != "" {
		user = "Titulo da nota: " + t + "\n\n" + text
	}
	content, err := c.do(ctx, system, user, answerBudget(text))
	if err != nil {
		return Result{}, err
	}
	result, err := decodeJSONRepair[Result](content)
	if err != nil {
		return Result{}, fmt.Errorf("analyze: decode secao: %w", err)
	}
	result = limitProse(result)
	result.Model = c.cfg.Model
	result.Raw = content
	return result, nil
}

// Synthesize writes the note-level analysis from the section analyses.
func (c *Client) Synthesize(ctx context.Context, title string, sections []SectionAnalysis) (Result, error) {
	if !c.cfg.Enabled {
		return Result{}, ErrDisabled
	}
	if len(sections) == 0 {
		return Result{}, errors.New("analyze: nenhuma secao para sintetizar")
	}
	payload := map[string]any{"titulo": strings.TrimSpace(title), "secoes": sections}
	raw, err := json.Marshal(payload)
	if err != nil {
		return Result{}, err
	}
	system := strings.Replace(synthesisPromptTemplate, "{language}", languageName(c.cfg.Language), 1)
	content, err := c.doWithSchema(ctx, system, string(raw), answerBudget(string(raw)), "synthesis", synthesisSchemaJSON)
	if err != nil {
		return Result{}, err
	}
	result, err := decodeJSONRepair[Result](content)
	if err != nil {
		return Result{}, fmt.Errorf("analyze: decode sintese: %w", err)
	}
	result = limitProse(result)
	result.Model = c.cfg.Model
	result.Raw = content
	return result, nil
}

func summarySystemPrompt(language string) string {
	return fmt.Sprintf(`Voce resume analises parciais de um diario falado.
Recebe, em ordem, os resumos dos trechos e devolve SOMENTE um JSON no formato
{"summary": "<uma frase unica, ate 20 palavras, em %s>"}.
Combine os resumos sem inventar fatos.`, language)
}

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
