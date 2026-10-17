package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/ollama"
)

// localPullTimeout is generous: a model download may take several minutes on a
// slow connection, and it keeps running after the HTTP response is sent.
const localPullTimeout = 30 * time.Minute

// localPullState is the download in flight (or the last one), so the dashboard
// can show progress by polling the same endpoint it used to start it.
type localPullState struct {
	Model   string `json:"model"`
	Percent int    `json:"percent"`
	Done    bool   `json:"done"`
	Error   string `json:"error,omitempty"`
}

// handleLocalAnalysis reports whether the local Ollama is reachable and which
// models are installed, without exposing the API key (there is none).
func (s *Server) handleLocalAnalysis(w http.ResponseWriter, r *http.Request) {
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
		"available": err == nil,
		"base_url":  root + "/v1",
		"models":    models,
		"model":     s.deps.Config.OllamaModel,
	}
	if pull := s.localPull(); pull != nil {
		body["pull"] = pull
	}
	writeJSON(w, http.StatusOK, body)
}

// handleSetupLocalAnalysis turns local analysis on in one request: it makes
// sure the model exists (downloading it in the background when needed) and
// saves the provider, base URL and model together.
func (s *Server) handleSetupLocalAnalysis(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model string `json:"model"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	root := ollama.Endpoint(s.deps.Config.OllamaURL)
	model := strings.TrimSpace(req.Model)
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
			"ollama nao encontrado; suba o servico local e tente de novo")
		return
	}
	base := root + "/v1"
	if err := s.deps.Store.SetSettings(ctx, map[string]string{
		"analyze_enabled":  "true",
		"analyze_provider": "openai",
		"analyze_base_url": base,
		"analyze_model":    model,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	installed := ollama.HasModel(models, model)
	if !installed {
		s.startLocalPull(root, model)
	}
	status := "ready"
	if !installed {
		status = "downloading"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    status,
		"model":     model,
		"base_url":  base,
		"installed": installed,
	})
}

// localPull returns a copy of the current pull state, if any.
func (s *Server) localPull() *localPullState {
	s.pullsMu.Lock()
	defer s.pullsMu.Unlock()
	if s.pull == nil {
		return nil
	}
	current := *s.pull
	return &current
}

// startLocalPull downloads a model in the background. A pull already running
// for the same model is reused, so a double click does not download twice.
func (s *Server) startLocalPull(root, model string) {
	s.pullsMu.Lock()
	if s.pull != nil && !s.pull.Done && s.pull.Model == model {
		s.pullsMu.Unlock()
		return
	}
	state := &localPullState{Model: model}
	s.pull = state
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
		s.pullsMu.Lock()
		state.Done = true
		if err != nil {
			state.Error = "falha ao baixar o modelo"
			s.pullsMu.Unlock()
			if s.deps.Logger != nil {
				s.deps.Logger.Error("api: baixar modelo do ollama", "modelo", model, "erro", err)
			}
			return
		}
		state.Percent = 100
		s.pullsMu.Unlock()
		if s.deps.Logger != nil {
			s.deps.Logger.Info("api: modelo do ollama pronto", "modelo", model)
		}
	}()
}
