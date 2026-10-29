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
	// PeopleDetail keeps the mention count the app measured. When present it
	// wins over the plain name list, which older clients still send.
	PeopleDetail []analyze.Person `json:"people_detail"`
	PlacesDetail []analyze.Place  `json:"places_detail"`
	Summary      string           `json:"summary"`
	Reading      string           `json:"reading"`
	Themes       []analyze.Theme  `json:"themes"`

	KeyMoments []analyze.KeyMoment       `json:"key_moments"`
	Questions  []string                  `json:"questions"`
	Decisions  []string                  `json:"decisions"`
	Tasks      []string                  `json:"tasks"`
	Ideas      []string                  `json:"ideas"`
	Events     []string                  `json:"events"`
	Epiphanies []string                  `json:"epiphanies"`
	Sections   []analyze.SectionAnalysis `json:"sections"`

	// Coverage comes from the app, which reads the note block by block.
	Coverage *analyze.Coverage `json:"coverage"`
	// SchemaVersion is the contract revision the app used.
	SchemaVersion  int    `json:"schema_version"`
	SentenceSource string `json:"sentence_source"`

	Comprehension       int     `json:"comprehension"`
	ComprehensionSource string  `json:"comprehension_source"`
	StutterRate         float64 `json:"stutter_rate"`
	HesitationRate      float64 `json:"hesitation_rate"`
	RevisedSegments     int     `json:"revised_segments"`

	// Replace is set only by an explicit "refazer" in the app. Without it, an
	// analysis that already exists wins: sync never overwrites work done on the
	// other side.
	Replace bool `json:"replace"`
	// Origin lets the dashboard worker mark an analysis made on this computer.
	// Anything other than "browser" is stored as "app", the device default.
	Origin string `json:"origin"`
	// DeviceID and DeviceName identify the browser that processed it. They are
	// only kept for origin "browser"; the server and the app never send them.
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"`
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
		Comprehension:  req.Comprehension,
		Sentiment:      analyze.Sentiment{Score: req.Sentiment, Label: req.SentimentLabel},
		Summary:        strings.TrimSpace(req.Summary),
		Reading:        strings.TrimSpace(req.Reading),
		Themes:         req.Themes,
		KeyMoments:     req.KeyMoments,
		Questions:      req.Questions,
		Decisions:      req.Decisions,
		Tasks:          req.Tasks,
		Ideas:          req.Ideas,
		Events:         req.Events,
		Coverage:       req.Coverage,
		SchemaVersion:  req.SchemaVersion,
		SentenceSource: strings.TrimSpace(req.SentenceSource),
		Sections:       req.Sections,
		Model:          strings.TrimSpace(req.Model),
	}
	for name, intensity := range req.Emotions {
		result.Emotions = append(result.Emotions, analyze.Emotion{Name: name, Intensity: intensity})
	}
	for _, person := range req.PeopleDetail {
		name := strings.TrimSpace(person.Name)
		if name == "" {
			continue
		}
		result.People = append(result.People, analyze.Person{
			Name:      name,
			Count:     max(person.Count, 1),
			Relation:  strings.TrimSpace(person.Relation),
			Sentiment: person.Sentiment,
		})
	}
	if len(result.People) == 0 {
		for _, name := range req.People {
			if name = strings.TrimSpace(name); name != "" {
				result.People = append(result.People, analyze.Person{Name: name, Count: 1})
			}
		}
	}
	for _, place := range req.PlacesDetail {
		name := strings.TrimSpace(place.Name)
		if name == "" {
			continue
		}
		result.Places = append(result.Places, analyze.Place{Name: name, Count: max(place.Count, 1)})
	}
	if len(result.Places) == 0 {
		for _, name := range req.Places {
			if name = strings.TrimSpace(name); name != "" {
				result.Places = append(result.Places, analyze.Place{Name: name, Count: 1})
			}
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
	if strings.TrimSpace(req.Origin) == analyze.OriginBrowser {
		analysis.Origin = analyze.OriginBrowser
		analysis.DeviceID = sanitizeDeviceField(req.DeviceID, 80)
		analysis.DeviceName = sanitizeDeviceField(req.DeviceName, 120)
	}
	if err := s.deps.Store.SaveRichAnalysis(ctx, analysis, links); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.deps.Events.Publish("analysis.ready", map[string]string{"entry_id": entryID})
	writeJSON(w, http.StatusOK, map[string]any{"stored": true, "origin": analysis.Origin})
}

// sanitizeDeviceField keeps the stored device label short and printable. It is
// a display label, never used for routing or trust.
func sanitizeDeviceField(value string, limit int) string {
	clean := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, strings.TrimSpace(value))
	if len(clean) > limit {
		clean = strings.TrimSpace(clean[:limit])
	}
	return clean
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
