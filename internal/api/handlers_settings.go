package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/jose-guilherme93/dyarium/internal/jobs"
	"github.com/jose-guilherme93/dyarium/internal/store"
)

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.deps.Store.ListSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	whisperModel := settings["whisper_model"]
	if whisperModel == "" {
		whisperModel = s.deps.Config.WhisperModel
	}
	analyzeEnabled := settings["analyze_enabled"]
	if analyzeEnabled == "" {
		analyzeEnabled = strconv.FormatBool(s.deps.Config.AnalyzeEnabled)
	}
	analyzeBaseURL := settings["analyze_base_url"]
	if analyzeBaseURL == "" {
		analyzeBaseURL = s.deps.Config.AnalyzeBaseURL
	}
	analyzeModel := settings["analyze_model"]
	if analyzeModel == "" {
		analyzeModel = s.deps.Config.AnalyzeModel
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"trim_silence":         settings["trim_silence"] == "true",
		"max_whisper_rss_mb":   toInt(settings["max_whisper_rss_mb"]),
		"whisper_model":        whisperModel,
		"whisper_language":     settings["whisper_language"],
		"transcribe_provider":  defaultString(settings["transcribe_provider"], "whisper"),
		"deepgram_model":       defaultString(settings["deepgram_model"], "nova-2"),
		"deepgram_api_key_set": settings["deepgram_api_key"] != "",
		"analyze_enabled":      analyzeEnabled == "true",
		"analyze_base_url":     analyzeBaseURL,
		"analyze_model":        analyzeModel,
		"analyze_api_key_set":  settings["analyze_api_key"] != "",
	})
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	ctx := r.Context()
	set := func(key, value string) bool {
		if err := s.deps.Store.SetSetting(ctx, key, value); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return false
		}
		return true
	}
	for key, value := range body {
		switch key {
		case "trim_silence":
			b, err := toBool(value)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid_value", "trim_silence deve ser booleano")
				return
			}
			if !set(key, strconv.FormatBool(b)) {
				return
			}
		case "max_whisper_rss_mb":
			n, err := toNumber(value)
			if err != nil || n < 0 {
				writeError(w, http.StatusBadRequest, "invalid_value", "max_whisper_rss_mb deve ser inteiro >= 0")
				return
			}
			if !set(key, strconv.Itoa(n)) {
				return
			}
		case "whisper_model", "whisper_language", "analyze_base_url", "analyze_model", "analyze_api_key",
			"transcribe_provider", "deepgram_api_key", "deepgram_model":
			str, ok := value.(string)
			if !ok {
				writeError(w, http.StatusBadRequest, "invalid_value", key+" deve ser texto")
				return
			}
			if !set(key, str) {
				return
			}
		case "analyze_enabled":
			b, err := toBool(value)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid_value", "analyze_enabled deve ser booleano")
				return
			}
			if !set(key, strconv.FormatBool(b)) {
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

func (*boolError) Error() string { return "valor invalido" }

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

func toInt(s string) int {
	n, _ := strconv.Atoi(s)
	return n
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
		"emotions":  rawJSON(a.Emotions),
		"people":    rawJSON(a.People),
		"places":    rawJSON(a.Places),
		"summary":   a.Summary,
	})
}

// rawJSON embeds a stored JSON string as a real JSON value (object/array),
// returning nil when the stored value is empty or invalid.
func rawJSON(s string) any {
	s = strings.TrimSpace(s)
	if s == "" || !json.Valid([]byte(s)) {
		return nil
	}
	return json.RawMessage(s)
}

func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !s.analyzeEnabled(ctx) {
		writeError(w, http.StatusConflict, "analyze_disabled", "analise desligada")
		return
	}
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

func (s *Server) analyzeEnabled(ctx context.Context) bool {
	v, ok, err := s.deps.Store.GetSetting(ctx, "analyze_enabled")
	if err != nil || !ok {
		return s.deps.Config.AnalyzeEnabled
	}
	return v == "true"
}

func analyzeKey(entryID, model string) string {
	return "analyze:" + entryID + ":" + model
}
