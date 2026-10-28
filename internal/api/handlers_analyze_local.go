package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/llm"
	"github.com/joseti/dyarium/internal/ollama"
)

// localPullTimeout is generous: a model download may take several minutes on a
// slow connection, and it keeps running after the HTTP response is sent.
const localPullTimeout = 30 * time.Minute

const (
	localRuntimeOllama   = "ollama"
	localRuntimeEmbedded = "embedded"
)

// localPullState is the download in flight (or the last one), so the dashboard
// can show progress by polling the same endpoint it used to start it.
type localPullState struct {
	Model   string `json:"model"`
	Percent int    `json:"percent"`
	Done    bool   `json:"done"`
	Error   string `json:"error,omitempty"`
}

// handleLocalAnalysis reports the state of one local runtime: the Ollama
// service (default, for compatibility) or the embedded llama.cpp server.
func (s *Server) handleLocalAnalysis(w http.ResponseWriter, r *http.Request) {
	runtime := strings.TrimSpace(r.URL.Query().Get("runtime"))
	if runtime == "" {
		runtime = localRuntimeOllama
	}
	switch runtime {
	case localRuntimeOllama:
		s.handleOllamaStatus(w, r)
	case localRuntimeEmbedded:
		s.handleEmbeddedStatus(w, r)
	default:
		writeError(w, http.StatusBadRequest, "invalid_runtime", "runtime local desconhecido")
	}
}

func (s *Server) handleOllamaStatus(w http.ResponseWriter, r *http.Request) {
	root := ollama.Endpoint(s.deps.Config.OllamaURL)
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	models, err := ollama.Tags(ctx, root)
	if err != nil && s.deps.Logger != nil {
		s.deps.Logger.Debug("api: ollama indisponivel", "url", root, "erro", err)
	}
	if models == nil {
		models = []string{}
	}
	body := map[string]any{
		"runtime":    localRuntimeOllama,
		"available":  err == nil,
		"base_url":   root + "/v1",
		"models":     models,
		"model":      s.deps.Config.OllamaModel,
		"downloaded": ollama.HasModel(models, s.deps.Config.OllamaModel),
	}
	if pull := s.localPull(localRuntimeOllama); pull != nil {
		body["pull"] = pull
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleEmbeddedStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	model := s.embeddedModel(ctx)
	downloaded := s.deps.LLMModels != nil && s.deps.LLMModels.Downloaded(model)
	available := s.deps.LocalAI != nil && s.deps.LocalAI.Available()
	running := s.deps.LocalAI != nil && s.deps.LocalAI.Running()

	models := []string{}
	if downloaded {
		models = append(models, model)
	}
	size := 0
	if info, ok := llm.Find(model); ok {
		size = info.SizeMB
	}
	body := map[string]any{
		"runtime":    localRuntimeEmbedded,
		"available":  available,
		"base_url":   s.embeddedBaseURL(),
		"models":     models,
		"model":      model,
		"downloaded": downloaded,
		"running":    running,
		"size_mb":    size,
	}
	if pull := s.localPull(localRuntimeEmbedded); pull != nil {
		body["pull"] = pull
	}
	writeJSON(w, http.StatusOK, body)
}

// handleSetupLocalAnalysis turns local analysis on in one request. Ollama and
// the embedded runtime share the contract: make sure the model exists, save the
// provider/base/model together, and download in the background when needed.
func (s *Server) handleSetupLocalAnalysis(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Runtime string `json:"runtime"`
		Model   string `json:"model"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	runtime := strings.TrimSpace(req.Runtime)
	if runtime == "" {
		runtime = localRuntimeOllama
	}
	switch runtime {
	case localRuntimeOllama:
		s.setupOllama(w, r, strings.TrimSpace(req.Model))
	case localRuntimeEmbedded:
		s.setupEmbedded(w, r, strings.TrimSpace(req.Model))
	default:
		writeError(w, http.StatusBadRequest, "invalid_runtime", "runtime local desconhecido")
	}
}

func (s *Server) setupOllama(w http.ResponseWriter, r *http.Request, model string) {
	root := ollama.Endpoint(s.deps.Config.OllamaURL)
	if model == "" {
		model = s.deps.Config.OllamaModel
	}
	if !ollama.ValidModel(model) {
		writeError(w, http.StatusBadRequest, "invalid_model", "nome de modelo invalido")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	models, err := ollama.Tags(ctx, root)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "local_unavailable",
			"ollama nao encontrado; confira se o servico ollama esta no ar")
		return
	}
	base := root + "/v1"
	if err := s.deps.Store.SetSettings(ctx, map[string]string{
		"analyze_enabled":       "true",
		"analyze_provider":      "openai",
		"analyze_base_url":      base,
		"analyze_model":         model,
		"analyze_local_runtime": localRuntimeOllama,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	installed := ollama.HasModel(models, model)
	if !installed {
		s.startOllamaPull(root, model)
	}
	status := "ready"
	if !installed {
		status = "downloading"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"runtime":   localRuntimeOllama,
		"status":    status,
		"model":     model,
		"base_url":  base,
		"installed": installed,
	})
}

func (s *Server) setupEmbedded(w http.ResponseWriter, r *http.Request, model string) {
	if model == "" {
		model = s.deps.Config.LlamaModel
	}
	if model == "" {
		model = llm.DefaultModel
	}
	info, ok := llm.Find(model)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_model", "modelo local desconhecido")
		return
	}
	if s.deps.LocalAI == nil || s.deps.LLMModels == nil {
		writeError(w, http.StatusServiceUnavailable, "local_unavailable",
			"analise embutida indisponivel nesta instalacao")
		return
	}
	if !s.deps.LocalAI.Available() {
		writeError(w, http.StatusServiceUnavailable, "local_unavailable",
			"llama.cpp embutido nao esta disponivel nesta imagem")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	base := s.deps.LocalAI.BaseURL()
	if err := s.deps.Store.SetSettings(ctx, map[string]string{
		"analyze_enabled":       "true",
		"analyze_provider":      "openai",
		"analyze_base_url":      base,
		"analyze_model":         model,
		"analyze_local_runtime": localRuntimeEmbedded,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	installed := s.deps.LLMModels.Downloaded(model)
	if !installed {
		s.startEmbeddedPull(model)
	}
	status := "ready"
	if !installed {
		status = "downloading"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"runtime":   localRuntimeEmbedded,
		"status":    status,
		"model":     model,
		"base_url":  base,
		"installed": installed,
		"size_mb":   info.SizeMB,
	})
}

// localPull returns a copy of the current pull state of a runtime, if any.
func (s *Server) localPull(runtime string) *localPullState {
	s.pullsMu.Lock()
	defer s.pullsMu.Unlock()
	current := s.pulls[runtime]
	if current == nil {
		return nil
	}
	copied := *current
	return &copied
}

func (s *Server) setPull(runtime string, update func(*localPullState)) {
	s.pullsMu.Lock()
	defer s.pullsMu.Unlock()
	if state := s.pulls[runtime]; state != nil {
		update(state)
	}
}

// startOllamaPull downloads an Ollama model in the background. A pull already
// running for the same model is reused, so a double click does not download
// twice.
func (s *Server) startOllamaPull(root, model string) {
	s.pullsMu.Lock()
	if s.pulls[localRuntimeOllama] != nil && !s.pulls[localRuntimeOllama].Done &&
		s.pulls[localRuntimeOllama].Model == model {
		s.pullsMu.Unlock()
		return
	}
	state := &localPullState{Model: model}
	s.pulls[localRuntimeOllama] = state
	s.pullsMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), localPullTimeout)
	go func() {
		defer cancel()
		err := ollama.Pull(ctx, root, model, func(progress ollama.Progress) {
			s.pullsMu.Lock()
			if progress.Total > 0 {
				state.Percent = min(100, int(progress.Completed*100/progress.Total))
			}
			s.pullsMu.Unlock()
		})
		s.finishPull(localRuntimeOllama, err)
		if err != nil {
			if s.deps.Logger != nil {
				s.deps.Logger.Error("api: baixar modelo do ollama", "modelo", model, "erro", err)
			}
			return
		}
		if s.deps.Logger != nil {
			s.deps.Logger.Info("api: modelo do ollama pronto", "modelo", model)
		}
	}()
}

// startEmbeddedPull downloads a GGUF model in the background.
func (s *Server) startEmbeddedPull(model string) {
	s.pullsMu.Lock()
	if s.pulls[localRuntimeEmbedded] != nil && !s.pulls[localRuntimeEmbedded].Done &&
		s.pulls[localRuntimeEmbedded].Model == model {
		s.pullsMu.Unlock()
		return
	}
	state := &localPullState{Model: model}
	s.pulls[localRuntimeEmbedded] = state
	s.pullsMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), localPullTimeout)
	go func() {
		defer cancel()
		err := s.deps.LLMModels.Download(ctx, model, func(progress llm.Progress) {
			s.pullsMu.Lock()
			if progress.Total > 0 {
				state.Percent = min(100, int(progress.Received*100/progress.Total))
			}
			s.pullsMu.Unlock()
		})
		s.finishPull(localRuntimeEmbedded, err)
		if err != nil {
			if s.deps.Logger != nil {
				s.deps.Logger.Error("api: baixar modelo embutido", "modelo", model, "erro", err)
			}
			return
		}
		if s.deps.Logger != nil {
			s.deps.Logger.Info("api: modelo embutido pronto", "modelo", model)
		}
	}()
}

func (s *Server) finishPull(runtime string, err error) {
	s.pullsMu.Lock()
	defer s.pullsMu.Unlock()
	state := s.pulls[runtime]
	if state == nil {
		return
	}
	state.Done = true
	if err != nil {
		state.Error = "falha ao baixar o modelo"
		return
	}
	state.Percent = 100
}

// embeddedModel is the catalog model of the embedded runtime. It uses the
// saved model when it is a valid GGUF; otherwise it falls back to the config.
func (s *Server) embeddedModel(ctx context.Context) string {
	model := s.deps.Config.LlamaModel
	if model == "" {
		model = llm.DefaultModel
	}
	if s.deps.Store == nil {
		return model
	}
	settings, err := s.deps.Store.ListSettings(ctx)
	if err != nil || settings["analyze_local_runtime"] != localRuntimeEmbedded {
		return model
	}
	if saved := strings.TrimSpace(settings["analyze_model"]); saved != "" {
		if _, ok := llm.Find(saved); ok {
			return saved
		}
	}
	return model
}

func (s *Server) embeddedBaseURL() string {
	if s.deps.LocalAI != nil {
		return s.deps.LocalAI.BaseURL()
	}
	port := s.deps.Config.LlamaPort
	if port == 0 {
		port = 11435
	}
	return fmt.Sprintf("http://127.0.0.1:%d/v1", port)
}

// applyLocalRuntime points the analysis client at the embedded server when the
// saved runtime is the embedded one. The process itself is started lazily by
// acquireConfiguredLocalAI before the first request.
func (s *Server) applyLocalRuntime(cfg *analyze.Config) {
	if cfg == nil || cfg.LocalRuntime != localRuntimeEmbedded {
		return
	}
	cfg.BaseURL = s.embeddedBaseURL()
}

// acquireConfiguredLocalAI starts the embedded server when the saved runtime
// needs it. It returns a no-op release for every other provider.
func (s *Server) acquireConfiguredLocalAI(ctx context.Context) (func(), error) {
	if s.deps.Store == nil {
		return func() {}, nil
	}
	settings, err := s.deps.Store.ListSettings(ctx)
	if err != nil || settings["analyze_local_runtime"] != localRuntimeEmbedded {
		return func() {}, nil
	}
	model := strings.TrimSpace(settings["analyze_model"])
	if model == "" {
		model = s.deps.Config.LlamaModel
	}
	return s.acquireLocalAI(ctx, model)
}

func (s *Server) acquireLocalAI(ctx context.Context, model string) (func(), error) {
	if s.deps.LocalAI == nil || s.deps.LLMModels == nil {
		return nil, fmt.Errorf("%w: runtime embutido indisponivel", llm.ErrUnavailable)
	}
	path, ok := s.deps.LLMModels.Path(model)
	if !ok {
		return nil, fmt.Errorf("%w: modelo %s fora do catalogo", llm.ErrUnavailable, model)
	}
	return s.deps.LocalAI.Acquire(ctx, path)
}
