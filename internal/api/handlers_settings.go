package api

import (
	"net/http"
	"strconv"

	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
)

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.deps.Store.ListSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"trim_silence":       settings["trim_silence"] == "true",
		"max_whisper_rss_mb": toInt(settings["max_whisper_rss_mb"]),
		"analyze_enabled":    s.deps.Config.AnalyzeEnabled,
		"analyze_base_url":   s.deps.Config.AnalyzeBaseURL,
		"analyze_model":      s.deps.Config.AnalyzeModel,
		"whisper_model":      s.deps.Config.WhisperModel,
	})
}

func toInt(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	ctx := r.Context()
	for key, value := range body {
		switch key {
		case "trim_silence":
			b, err := toBool(value)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid_value", "trim_silence deve ser booleano")
				return
			}
			if err := s.deps.Store.SetSetting(ctx, "trim_silence", strconv.FormatBool(b)); err != nil {
				writeError(w, http.StatusInternalServerError, "internal", err.Error())
				return
			}
		case "max_whisper_rss_mb":
			n, err := toNumber(value)
			if err != nil || n < 0 {
				writeError(w, http.StatusBadRequest, "invalid_value", "max_whisper_rss_mb deve ser um inteiro >= 0")
				return
			}
			if err := s.deps.Store.SetSetting(ctx, "max_whisper_rss_mb", strconv.Itoa(n)); err != nil {
				writeError(w, http.StatusInternalServerError, "internal", err.Error())
				return
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func toBool(v any) (bool, error) {
	switch t := v.(type) {
	case bool:
		return t, nil
	case string:
		return strconv.ParseBool(t)
	default:
		return false, errInvalidBool
	}
}

var errInvalidBool = &boolError{}

type boolError struct{}

func (*boolError) Error() string { return "valor booleano invalido" }

func toNumber(v any) (int, error) {
	switch t := v.(type) {
	case float64:
		return int(t), nil
	case int:
		return t, nil
	case string:
		return strconv.Atoi(t)
	default:
		return 0, errInvalidBool
	}
}

func (s *Server) handleGetAnalysis(w http.ResponseWriter, r *http.Request) {
	a, ok, err := s.deps.Store.GetAnalysis(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "analise indisponivel")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"model":     a.Model,
		"sentiment": a.Sentiment,
		"emotions":  a.Emotions,
		"people":    a.People,
		"places":    a.Places,
		"summary":   a.Summary,
	})
}

func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	if s.deps.Analyzer == nil || !s.deps.Analyzer.Enabled() {
		writeError(w, http.StatusConflict, "analyze_disabled", "analise desligada")
		return
	}
	ctx := r.Context()
	id := r.PathValue("id")
	if _, err := s.deps.Store.GetEntry(ctx, id); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	if _, err := s.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, analyzeKey(id, s.deps.Config.AnalyzeModel), jobs.AnalyzePayload{EntryID: id}); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, id, store.EntryAnalyzing)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": id, "status": store.EntryAnalyzing})
	writeJSON(w, http.StatusAccepted, map[string]string{"status": store.EntryAnalyzing})
}

func analyzeKey(entryID, model string) string {
	return "analyze:" + entryID + ":" + model
}
