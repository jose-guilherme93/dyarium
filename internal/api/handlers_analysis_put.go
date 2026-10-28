package api

import (
	"net/http"
	"strings"

	"github.com/joseti/dyarium/internal/analysisbuild"
	"github.com/joseti/dyarium/internal/analyze"
)

// putAnalysisRequest is the analysis made in the app. The shape matches
// GET /entries/{id}/analysis so the app can send exactly what it already
// stores locally, without translating anything.
type putAnalysisRequest struct {
	Model          string  `json:"model"`
	Sentiment      float64 `json:"sentiment"`
	SentimentLabel string  `json:"sentiment_label"`
	// Emotions is the map name -> intensity, the same shape the GET returns.
	Emotions map[string]float64 `json:"emotions"`
	People   []string           `json:"people"`
	Places   []string           `json:"places"`
	Summary  string             `json:"summary"`
	Reading  string             `json:"reading"`
	Themes   []analyze.Theme    `json:"themes"`

	KeyMoments []analyze.KeyMoment       `json:"key_moments"`
	Questions  []string                  `json:"questions"`
	Decisions  []string                  `json:"decisions"`
	Sections   []analyze.SectionAnalysis `json:"sections"`

	Comprehension       int     `json:"comprehension"`
	ComprehensionSource string  `json:"comprehension_source"`
	StutterRate         float64 `json:"stutter_rate"`
	HesitationRate      float64 `json:"hesitation_rate"`
	RevisedSegments     int     `json:"revised_segments"`

	// Replace is set only by an explicit "refazer" in the app. Without it, an
	// analysis that already exists wins: sync never overwrites work done on the
	// other side.
	Replace bool `json:"replace"`
}

// handlePutAnalysis stores the analysis made in the app so the dashboard sees
// it. First-arrival wins; only an explicit replace overwrites.
func (s *Server) handlePutAnalysis(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	entryID := r.PathValue("id")
	if _, err := s.deps.Store.GetEntry(ctx, entryID); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "entrada inexistente")
		return
	}
	var req putAnalysisRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if !req.Replace {
		existing, ok, err := s.deps.Store.GetAnalysis(ctx, entryID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if ok {
			writeJSON(w, http.StatusOK, map[string]any{
				"stored": false,
				"origin": existing.Origin,
			})
			return
		}
	}

	result := analyze.Result{
		Comprehension: req.Comprehension,
		Sentiment:     analyze.Sentiment{Score: req.Sentiment, Label: req.SentimentLabel},
		Summary:       strings.TrimSpace(req.Summary),
		Reading:       strings.TrimSpace(req.Reading),
		Themes:        req.Themes,
		KeyMoments:    req.KeyMoments,
		Questions:     req.Questions,
		Decisions:     req.Decisions,
		Sections:      req.Sections,
		Model:         strings.TrimSpace(req.Model),
	}
	for name, intensity := range req.Emotions {
		result.Emotions = append(result.Emotions, analyze.Emotion{Name: name, Intensity: intensity})
	}
	for _, name := range req.People {
		if name = strings.TrimSpace(name); name != "" {
			result.People = append(result.People, analyze.Person{Name: name, Count: 1})
		}
	}
	for _, name := range req.Places {
		if name = strings.TrimSpace(name); name != "" {
			result.Places = append(result.Places, analyze.Place{Name: name, Count: 1})
		}
	}
	if result.Sentiment.Label == "" {
		result.Sentiment.Label = sentimentLabelFor(result.Sentiment.Score)
	}

	metrics := analysisbuild.Metrics{
		Comprehension:   req.Comprehension,
		Source:          strings.TrimSpace(req.ComprehensionSource),
		StutterRate:     req.StutterRate,
		HesitationRate:  req.HesitationRate,
		RevisedSegments: req.RevisedSegments,
	}
	analysis, links := analysisbuild.Build(entryID, result, metrics)
	analysis.Origin = analyze.OriginApp
	if err := s.deps.Store.SaveRichAnalysis(ctx, analysis, links); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("analysis.ready", map[string]string{"entry_id": entryID})
	writeJSON(w, http.StatusOK, map[string]any{"stored": true, "origin": analysis.Origin})
}

// sentimentLabelFor mirrors the label the pipeline gives a score, for an app
// analysis that arrived without one.
func sentimentLabelFor(score float64) string {
	switch {
	case score <= -0.15:
		return "negativo"
	case score >= 0.15:
		return "positivo"
	default:
		return "neutro"
	}
}
