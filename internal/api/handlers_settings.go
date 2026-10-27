package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
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
	analysisThemes := settings["analysis_themes"]
	if strings.TrimSpace(analysisThemes) == "" {
		analysisThemes = strings.Join(analyze.DefaultThemes, ", ")
	}
	analyzeProvider := settings["analyze_provider"]
	if analyzeProvider == "" {
		analyzeProvider = defaultString(s.deps.Config.AnalyzeProvider, analyze.ProviderOpenAI)
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
		"analyze_provider":     analyzeProvider,
		"analyze_base_url":     analyzeBaseURL,
		"analyze_model":        analyzeModel,
		"analyze_api_key_set":  settings["analyze_api_key"] != "",
		"analysis_themes":      analysisThemes,
		"review_enabled":       settings["review_enabled"] == "true",
		"literal_transcript":   settings["literal_transcript"] == "true",
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
		case "whisper_model", "whisper_language", "analyze_provider", "analyze_base_url", "analyze_model",
			"analyze_api_key", "transcribe_provider", "deepgram_api_key", "deepgram_model", "analysis_themes":
			str, ok := value.(string)
			if !ok {
				writeError(w, http.StatusBadRequest, "invalid_value", key+" deve ser texto")
				return
			}
			if !set(key, str) {
				return
			}
		case "review_enabled", "literal_transcript":
			b, err := toBool(value)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid_value", key+" deve ser booleano")
				return
			}
			if !set(key, strconv.FormatBool(b)) {
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
	body := map[string]any{
		"model":           a.Model,
		"sentiment":       a.Sentiment,
		"sentiment_label": a.SentimentLabel,
		"emotions":        rawJSON(a.Emotions),
		"people":          rawJSON(a.People),
		"places":          rawJSON(a.Places),
		"summary":         a.Summary,
		// Compreensao logica da transcricao (0 a 100); -1 quando nao medida.
		"comprehension":        a.Comprehension,
		"comprehension_source": a.ComprehensionSource,
		"stutter_rate":         a.StutterRate,
		"hesitation_rate":      a.HesitationRate,
		"revised_segments":     a.RevisedSegments,
	}
	if data := strings.TrimSpace(a.Data); data != "" && json.Valid([]byte(data)) {
		var rich analyze.Result
		if err := json.Unmarshal([]byte(data), &rich); err == nil {
			body["emotions_detail"] = rich.Emotions
			body["people_detail"] = rich.People
			body["places_detail"] = rich.Places
			body["themes"] = rich.Themes
			body["reading"] = rich.Reading
			body["sections"] = rich.Sections
			body["key_moments"] = rich.KeyMoments
			body["questions"] = rich.Questions
			body["decisions"] = rich.Decisions
			body["data"] = json.RawMessage(data)
		}
	}
	writeJSON(w, http.StatusOK, body)
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
	// Antes de prometer a analise, confirma que o provedor responde. Sem isso o
	// usuario descobria a chave/modelo quebrados depois de a nota falhar, e o
	// clique virava uma promessa que nao se cumpria.
	if err := s.pingProvider(ctx); err != nil {
		writeError(w, http.StatusBadGateway, "ai_unavailable", analyze.FriendlyError(err))
		return
	}
	// A chave e a mesma da analise automatica: um clique enquanto o worker ja
	// analisa nao pode abrir uma segunda passada concorrente na mesma nota.
	if _, err := s.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey(id), jobs.AnalyzePayload{EntryID: id}); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, id, store.EntryAnalyzing)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": id, "status": store.EntryAnalyzing})
	writeJSON(w, http.StatusAccepted, map[string]string{"status": store.EntryAnalyzing})
}

// analyzeClient builds the provider client from the saved settings, the same
// merge the worker uses. Testar o cliente do boot testaria outra configuracao.
func (s *Server) analyzeClient(ctx context.Context) *analyze.Client {
	base := analyze.Config{
		Enabled:  s.deps.Config.AnalyzeEnabled,
		Provider: s.deps.Config.AnalyzeProvider,
		BaseURL:  s.deps.Config.AnalyzeBaseURL,
		APIKey:   s.deps.Config.AnalyzeAPIKey,
		Model:    s.deps.Config.AnalyzeModel,
	}
	settings, err := s.deps.Store.ListSettings(ctx)
	if err != nil {
		settings = nil
	}
	return analyze.New(analyze.ConfigFromSettings(base, settings))
}

// pingProvider faz uma chamada minima ao provedor de IA. Falha na chave, no
// endpoint ou no modelo aparece na hora, no clique, e nao depois.
func (s *Server) pingProvider(ctx context.Context) error {
	pingCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	err := s.analyzeClient(pingCtx).Ping(pingCtx)
	if err != nil && errors.Is(err, analyze.ErrDisabled) {
		return nil
	}
	if err != nil && s.deps.Logger != nil {
		// Detalhe do provedor so no log do servidor; o usuario recebe a mensagem
		// amigavel.
		s.deps.Logger.Warn("ia: ping ao provedor falhou", "erro", err)
	}
	return err
}

func (s *Server) analyzeEnabled(ctx context.Context) bool {
	v, ok, err := s.deps.Store.GetSetting(ctx, "analyze_enabled")
	if err != nil || !ok {
		return s.deps.Config.AnalyzeEnabled
	}
	return v == "true"
}
