package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

type analysisRunAggregateResponse struct {
	Runtime         string  `json:"runtime,omitempty"`
	Provider        string  `json:"provider,omitempty"`
	Model           string  `json:"model,omitempty"`
	Runs            int     `json:"runs"`
	OK              int     `json:"ok"`
	Failed          int     `json:"failed"`
	Fallback        int     `json:"fallback"`
	SuccessRate     float64 `json:"success_rate"`
	SimplifiedRate  float64 `json:"simplified_rate"`
	AvgDurationMS   float64 `json:"avg_duration_ms"`
	TokensPerSecond float64 `json:"tokens_per_second"`
}

func analysisRunAggregateJSON(aggregate store.AnalysisRunAggregate) analysisRunAggregateResponse {
	return analysisRunAggregateResponse{
		Runtime:         aggregate.Runtime,
		Provider:        aggregate.Provider,
		Model:           aggregate.Model,
		Runs:            aggregate.Runs,
		OK:              aggregate.OK,
		Failed:          aggregate.Failed,
		Fallback:        aggregate.Fallback,
		SuccessRate:     aggregate.SuccessRate,
		SimplifiedRate:  aggregate.SimplifiedRate,
		AvgDurationMS:   aggregate.AvgDurationMS,
		TokensPerSecond: aggregate.TokensPerSecond,
	}
}

// handleAnalysisRunsSummary returns the diagnostics aggregate of the analysis
// attempts. The app's Configs > Avancado reads it; no note content is exposed.
func (s *Server) handleAnalysisRunsSummary(w http.ResponseWriter, r *http.Request) {
	days := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			days = n
		}
	}
	if days > 365 {
		days = 365
	}
	since := time.Now().UTC().AddDate(0, 0, -days)
	summary, err := s.deps.Store.AnalysisRunSummary(r.Context(), since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	models := make([]analysisRunAggregateResponse, 0, len(summary.Models))
	for _, model := range summary.Models {
		models = append(models, analysisRunAggregateJSON(model))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"days":   days,
		"since":  summary.Since,
		"totals": analysisRunAggregateJSON(summary.Totals),
		"models": models,
	})
}
