// Package analysisbuild converts an analyze.Result into the rows the store
// keeps. The worker (analysis made by the server) and the API (analysis made in
// the app) share it so both produce exactly the same shape.
package analysisbuild

import (
	"encoding/json"
	"time"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

// Metrics are the numbers measured around the analysis, not by the model.
type Metrics struct {
	Comprehension   int
	Source          string
	StutterRate     float64
	HesitationRate  float64
	RevisedSegments int
}

// Build flattens the rich result into the analysis row plus its entity links.
// It does not set Origin: the caller knows whether this came from the app, from
// the server pipeline or from a third-party API.
func Build(entryID string, result analyze.Result, metrics Metrics) (store.Analysis, []store.EntityLink) {
	emotions := make(map[string]float64, len(result.Emotions))
	for _, e := range result.Emotions {
		emotions[e.Name] = e.Intensity
	}
	people := make([]string, 0, len(result.People))
	for _, p := range result.People {
		people = append(people, p.Name)
	}
	places := make([]string, 0, len(result.Places))
	for _, p := range result.Places {
		places = append(places, p.Name)
	}
	emotionsJSON, _ := json.Marshal(emotions)
	peopleJSON, _ := json.Marshal(people)
	placesJSON, _ := json.Marshal(places)
	dataJSON, _ := json.Marshal(result)

	links := make([]store.EntityLink, 0, len(result.People)+len(result.Places)+len(result.Themes))
	for _, p := range result.People {
		sentiment := p.Sentiment
		links = append(links, store.EntityLink{
			Kind: store.EntityPerson, Name: p.Name, Count: max(p.Count, 1),
			Relation: p.Relation, Sentiment: &sentiment,
		})
	}
	for _, p := range result.Places {
		links = append(links, store.EntityLink{Kind: store.EntityPlace, Name: p.Name, Count: max(p.Count, 1)})
	}
	for _, t := range result.Themes {
		links = append(links, store.EntityLink{Kind: store.EntityTheme, Name: t.Name, Count: 1})
	}

	return store.Analysis{
		ID:                  id.New(),
		EntryID:             entryID,
		Model:               result.Model,
		Sentiment:           result.Sentiment.Score,
		SentimentLabel:      result.Sentiment.Label,
		Emotions:            string(emotionsJSON),
		People:              string(peopleJSON),
		Places:              string(placesJSON),
		Summary:             result.Summary,
		Raw:                 result.Raw,
		Data:                string(dataJSON),
		Comprehension:       metrics.Comprehension,
		ComprehensionSource: metrics.Source,
		StutterRate:         metrics.StutterRate,
		HesitationRate:      metrics.HesitationRate,
		RevisedSegments:     metrics.RevisedSegments,
		CreatedAt:           time.Now().UTC(),
	}, links
}
