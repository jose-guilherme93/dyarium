package transcribe

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

func loadCheckpoint(path string) map[int]chunkResult {
	out := map[int]chunkResult{}
	data, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	_ = json.Unmarshal(data, &out)
	return out
}

func saveCheckpoint(path string, results map[int]chunkResult) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return
	}
	data, err := json.Marshal(results)
	if err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

// assemble concatenates the per-chunk results into a transcript, keeping the
// segments ordered by their position in the original audio.
func assemble(entryID string, chunks []Chunk, results map[int]chunkResult, durationMS int64, trim bool, model, language string) (store.Transcript, []store.Segment) {
	var all []Segment
	index := map[int]Chunk{}
	for _, ch := range chunks {
		index[ch.Index] = ch
	}
	for i := 0; i < len(chunks); i++ {
		res, ok := results[i]
		if !ok {
			continue
		}
		all = append(all, res.Segments...)
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].StartMS < all[j].StartMS })

	now := time.Now().UTC()
	transcriptID := id.New()
	var text strings.Builder
	segments := make([]store.Segment, 0, len(all))
	for i, seg := range all {
		t := strings.TrimSpace(seg.Text)
		if t == "" {
			continue
		}
		if text.Len() > 0 {
			text.WriteByte(' ')
		}
		text.WriteString(t)
		segments = append(segments, store.Segment{
			ID:           id.New(),
			TranscriptID: transcriptID,
			Idx:          i,
			StartMS:      seg.StartMS,
			EndMS:        seg.EndMS,
			Text:         t,
			CreatedAt:    now,
		})
	}

	return store.Transcript{
		ID:              transcriptID,
		EntryID:         entryID,
		Model:           model,
		Language:        language,
		Text:            text.String(),
		TrimSilence:     trim,
		DurationSeconds: float64(durationMS) / 1000,
		CreatedAt:       now,
	}, segments
}
