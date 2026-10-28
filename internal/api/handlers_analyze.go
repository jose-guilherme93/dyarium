package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/analyze"
)

// analyzeClientConfig merges the environment defaults with the stored settings.
func (s *Server) analyzeClientConfig(ctx context.Context) analyze.Config {
	cfg := analyze.Config{
		Enabled:  true,
		Provider: s.deps.Config.AnalyzeProvider,
		BaseURL:  s.deps.Config.AnalyzeBaseURL,
		APIKey:   s.deps.Config.AnalyzeAPIKey,
		Model:    s.deps.Config.AnalyzeModel,
	}
	if settings, err := s.deps.Store.ListSettings(ctx); err == nil {
		if v := settings["analyze_provider"]; v != "" {
			cfg.Provider = v
		}
		if v := settings["analyze_base_url"]; v != "" {
			cfg.BaseURL = v
		}
		if v, ok := settings["analyze_api_key"]; ok {
			cfg.APIKey = v
		}
		if v := settings["analyze_model"]; v != "" {
			cfg.Model = v
		}
		if v := settings["analyze_local_runtime"]; v != "" {
			cfg.LocalRuntime = v
		}
	}
	s.applyLocalRuntime(&cfg)
	return cfg
}

// handleListAnalyzeModels queries the configured provider for its model list,
// so the dashboard can offer them without exposing the API key.
func (s *Server) handleListAnalyzeModels(w http.ResponseWriter, r *http.Request) {
	cfg := s.analyzeClientConfig(r.Context())
	if strings.TrimSpace(cfg.BaseURL) == "" {
		writeError(w, http.StatusBadRequest, "no_base_url", "configure a base URL da analise")
		return
	}
	timeout := 20 * time.Second
	if cfg.LocalRuntime == localRuntimeEmbedded {
		timeout = 90 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	if cfg.LocalRuntime == localRuntimeEmbedded {
		release, err := s.acquireLocalAI(ctx, cfg.Model)
		if err != nil {
			writeError(w, http.StatusBadGateway, "local_unavailable", analyze.FriendlyError(err))
			return
		}
		defer release()
	}
	models, err := analyze.New(cfg).ListModels(ctx)
	if err != nil {
		if s.deps.Logger != nil {
			s.deps.Logger.Warn("api: listar modelos de analise", "erro", err)
		}
		writeError(w, http.StatusBadGateway, "provider_error", "nao foi possivel consultar os modelos do provedor")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}
