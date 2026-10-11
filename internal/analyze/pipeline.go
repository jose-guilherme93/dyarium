package analyze

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

const (
	// singlePassLimit is the transcript size (chars) analyzed in one call.
	singlePassLimit = 12000
	// windowTarget is the target size (chars) of each window for long texts.
	windowTarget = 8000

	maxKeyMoments = 5
	maxPeople     = 20
	maxPlaces     = 20
	maxQuestions  = 5
	maxDecisions  = 5
)

// Pipeline runs the windowed analysis of a transcript, merging the partial
// results when the transcript is too long for a single call.
type Pipeline struct {
	client *Client
}

// NewPipeline builds a Pipeline over an analysis client.
func NewPipeline(client *Client) *Pipeline { return &Pipeline{client: client} }

type textPart struct {
	text string
	size int
}

type window struct {
	text string
	size int
}

// Run analyzes the transcript segments and returns the merged rich result. The
// optional progress callback reports the stage ("analyzing" per window,
// "summarizing" for the meta-summary) so the UI can show real progress.
func (p *Pipeline) Run(ctx context.Context, segments []Segment, progress func(stage string, done, total int)) (Result, error) {
	if !p.client.Enabled() {
		return Result{}, ErrDisabled
	}
	report := func(stage string, done, total int) {
		if progress != nil {
			progress(stage, done, total)
		}
	}
	windows := buildWindows(segments)
	if len(windows) == 0 {
		return Result{}, errors.New("analyze: transcricao vazia")
	}
	results := make([]Result, 0, len(windows))
	weights := make([]int, 0, len(windows))
	report("analyzing", 0, len(windows))
	for i, w := range windows {
		result, err := p.client.Analyze(ctx, w.text)
		if err != nil {
			return Result{}, err
		}
		results = append(results, result)
		weights = append(weights, w.size)
		report("analyzing", i+1, len(windows))
	}
	merged := mergeResults(results, weights)
	if len(windows) > 1 {
		report("summarizing", 0, 1)
		summary, err := p.client.Summarize(ctx, summaries(results))
		if err != nil {
			return Result{}, err
		}
		if s := strings.TrimSpace(summary); s != "" {
			merged.Summary = s
		}
		report("summarizing", 1, 1)
	}
	return limitResult(merged), nil
}

// buildWindows annotates each segment with its [mm:ss] offset and groups them
// into windows. Segments are never split across windows.
func buildWindows(segments []Segment) []window {
	var parts []textPart
	total := 0
	for _, seg := range segments {
		text := strings.TrimSpace(seg.Text)
		if text == "" {
			continue
		}
		line := fmt.Sprintf("[%s] %s", mmss(seg.StartMS), text)
		parts = append(parts, textPart{text: line, size: len(line)})
		total += len(line) + 1
	}
	if total == 0 {
		return nil
	}
	if total <= singlePassLimit {
		return []window{{text: joinParts(parts), size: total}}
	}
	var windows []window
	var current []textPart
	size := 0
	for _, p := range parts {
		if size > 0 && size+p.size+1 > windowTarget {
			windows = append(windows, window{text: joinParts(current), size: size})
			current = nil
			size = 0
		}
		current = append(current, p)
		size += p.size + 1
	}
	if len(current) > 0 {
		windows = append(windows, window{text: joinParts(current), size: size})
	}
	return windows
}

func joinParts(parts []textPart) string {
	lines := make([]string, 0, len(parts))
	for _, p := range parts {
		lines = append(lines, p.text)
	}
	return strings.Join(lines, "\n")
}

func mmss(ms int) string {
	if ms < 0 {
		ms = 0
	}
	return fmt.Sprintf("%02d:%02d", ms/60000, (ms/1000)%60)
}

// mergeResults combines window results: sentiment is weighted by window size,
// emotions keep the highest intensity, people/places add counts, themes keep
// the highest confidence and moments/questions/decisions are deduplicated.
func mergeResults(results []Result, weights []int) Result {
	if len(results) == 0 {
		return Result{}
	}
	if len(results) == 1 {
		return results[0]
	}

	out := Result{}
	var weighted float64
	var total int
	for i, r := range results {
		total += weights[i]
		weighted += r.Sentiment.Score * float64(weights[i])
	}
	if total > 0 {
		out.Sentiment.Score = weighted / float64(total)
	}
	out.Sentiment.Label = sentimentLabel(out.Sentiment.Score)

	// Emotions: keep the highest intensity per name.
	emotions := map[string]*Emotion{}
	var emotionOrder []string
	for _, r := range results {
		for _, e := range r.Emotions {
			name := strings.TrimSpace(e.Name)
			if name == "" {
				continue
			}
			key := strings.ToLower(name)
			if existing, ok := emotions[key]; ok {
				if e.Intensity > existing.Intensity {
					existing.Intensity = e.Intensity
				}
				continue
			}
			emotions[key] = &Emotion{Name: name, Intensity: e.Intensity}
			emotionOrder = append(emotionOrder, key)
		}
	}
	for _, key := range emotionOrder {
		out.Emotions = append(out.Emotions, *emotions[key])
	}

	// People: union, add counts, keep first non-empty relation and the
	// sentiment of the most-mentioned occurrence.
	type personAgg struct {
		name      string
		count     int
		relation  string
		sentiment float64
		bestCount int
	}
	people := map[string]*personAgg{}
	var peopleOrder []string
	for _, r := range results {
		for _, p := range r.People {
			name := strings.TrimSpace(p.Name)
			if name == "" {
				continue
			}
			key := strings.ToLower(name)
			agg, ok := people[key]
			if !ok {
				agg = &personAgg{name: name}
				people[key] = agg
				peopleOrder = append(peopleOrder, key)
			}
			agg.count += p.Count
			if agg.relation == "" {
				agg.relation = strings.TrimSpace(p.Relation)
			}
			if p.Count >= agg.bestCount {
				agg.bestCount = p.Count
				agg.sentiment = p.Sentiment
			}
		}
	}
	for _, key := range peopleOrder {
		agg := people[key]
		out.People = append(out.People, Person{
			Name:      agg.name,
			Count:     agg.count,
			Relation:  agg.relation,
			Sentiment: agg.sentiment,
		})
	}

	// Places: union, add counts.
	type placeAgg struct {
		name  string
		count int
	}
	places := map[string]*placeAgg{}
	var placeOrder []string
	for _, r := range results {
		for _, p := range r.Places {
			name := strings.TrimSpace(p.Name)
			if name == "" {
				continue
			}
			key := strings.ToLower(name)
			agg, ok := places[key]
			if !ok {
				agg = &placeAgg{name: name}
				places[key] = agg
				placeOrder = append(placeOrder, key)
			}
			agg.count += p.Count
		}
	}
	for _, key := range placeOrder {
		agg := places[key]
		out.Places = append(out.Places, Place{Name: agg.name, Count: agg.count})
	}

	// Themes: union, keep the highest confidence.
	type themeAgg struct {
		name       string
		confidence float64
	}
	themes := map[string]*themeAgg{}
	var themeOrder []string
	for _, r := range results {
		for _, t := range r.Themes {
			name := strings.TrimSpace(t.Name)
			if name == "" {
				continue
			}
			key := strings.ToLower(name)
			agg, ok := themes[key]
			if !ok {
				agg = &themeAgg{name: name}
				themes[key] = agg
				themeOrder = append(themeOrder, key)
			}
			if t.Confidence > agg.confidence {
				agg.confidence = t.Confidence
			}
		}
	}
	for _, key := range themeOrder {
		agg := themes[key]
		out.Themes = append(out.Themes, Theme{Name: agg.name, Confidence: agg.confidence})
	}

	// Key moments: concatenate, dedup by text.
	var moments []KeyMoment
	seenMoment := map[string]bool{}
	for _, r := range results {
		for _, m := range r.KeyMoments {
			text := strings.TrimSpace(m.Text)
			if text == "" || seenMoment[strings.ToLower(text)] {
				continue
			}
			seenMoment[strings.ToLower(text)] = true
			moments = append(moments, KeyMoment{StartMS: m.StartMS, Text: text})
		}
	}
	out.KeyMoments = moments

	// Questions and decisions: concatenate and dedup.
	var questions, decisions []string
	for _, r := range results {
		questions = append(questions, r.Questions...)
		decisions = append(decisions, r.Decisions...)
	}
	out.Questions = dedupStrings(questions)
	out.Decisions = dedupStrings(decisions)
	if out.Summary == "" {
		for _, r := range results {
			if s := strings.TrimSpace(r.Summary); s != "" {
				out.Summary = s
				break
			}
		}
	}
	return out
}

// limitResult enforces the per-entry limits and normalizes ordering.
func limitResult(r Result) Result {
	if r.Sentiment.Label == "" {
		r.Sentiment.Label = sentimentLabel(r.Sentiment.Score)
	}
	sort.SliceStable(r.People, func(i, j int) bool {
		if r.People[i].Count != r.People[j].Count {
			return r.People[i].Count > r.People[j].Count
		}
		return r.People[i].Name < r.People[j].Name
	})
	if len(r.People) > maxPeople {
		r.People = r.People[:maxPeople]
	}
	sort.SliceStable(r.Places, func(i, j int) bool {
		if r.Places[i].Count != r.Places[j].Count {
			return r.Places[i].Count > r.Places[j].Count
		}
		return r.Places[i].Name < r.Places[j].Name
	})
	if len(r.Places) > maxPlaces {
		r.Places = r.Places[:maxPlaces]
	}
	sort.SliceStable(r.KeyMoments, func(i, j int) bool { return r.KeyMoments[i].StartMS < r.KeyMoments[j].StartMS })
	if len(r.KeyMoments) > maxKeyMoments {
		r.KeyMoments = r.KeyMoments[:maxKeyMoments]
	}
	r.Questions = limitStrings(r.Questions, maxQuestions)
	r.Decisions = limitStrings(r.Decisions, maxDecisions)
	return r
}

func summaries(results []Result) []string {
	var out []string
	for _, r := range results {
		if s := strings.TrimSpace(r.Summary); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func dedupStrings(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		v := strings.TrimSpace(s)
		if v == "" || seen[strings.ToLower(v)] {
			continue
		}
		seen[strings.ToLower(v)] = true
		out = append(out, v)
	}
	return out
}

func limitStrings(in []string, max int) []string {
	in = dedupStrings(in)
	if len(in) > max {
		return in[:max]
	}
	return in
}

// ParseThemes splits a comma-separated theme list, lowercased and trimmed.
func ParseThemes(csv string) []string {
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.ToLower(strings.TrimSpace(p))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
