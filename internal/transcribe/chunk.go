package transcribe

import "github.com/jose-guilherme93/dyarium/internal/audio"

const (
	chunkTargetMS = 10 * 60 * 1000 // prefer a cut near 10 minutes
	chunkMinMS    = 4 * 60 * 1000  // never cut sooner than 4 minutes
	chunkHardMax  = 15 * 60 * 1000 // hard cap on a chunk length
)

// PlanChunks splits the original timeline into transcribable chunks, preferring
// to cut near the midpoint of a silence so words are not split. A chunk is
// flagged as silence when it falls entirely inside a detected silence interval.
// Timestamps always refer to the original audio.
func PlanChunks(durationMS int64, silences []audio.Interval) []Chunk {
	if durationMS <= 0 {
		return nil
	}
	boundaries := []int64{0}
	last := int64(0)
	for durationMS-last > chunkTargetMS {
		desired := last + chunkTargetMS
		limit := last + chunkHardMax
		if limit > durationMS {
			limit = durationMS
		}
		cut := desired
		bestMid := int64(-1)
		bestDist := int64(1) << 62
		for _, s := range silences {
			mid := (s.StartMS + s.EndMS) / 2
			if mid <= last+chunkMinMS || mid > limit {
				continue
			}
			dist := mid - desired
			if dist < 0 {
				dist = -dist
			}
			if dist < bestDist {
				bestDist = dist
				bestMid = mid
			}
		}
		if bestMid > 0 {
			cut = bestMid
		}
		if cut <= last {
			cut = desired
		}
		boundaries = append(boundaries, cut)
		last = cut
	}
	boundaries = append(boundaries, durationMS)

	var chunks []Chunk
	for i := 0; i+1 < len(boundaries); i++ {
		start, end := boundaries[i], boundaries[i+1]
		if end <= start {
			continue
		}
		chunks = append(chunks, Chunk{
			Index:   len(chunks),
			StartMS: start,
			EndMS:   end,
			Silence: isSilent(start, end, silences),
		})
	}
	return chunks
}

func isSilent(start, end int64, silences []audio.Interval) bool {
	for _, s := range silences {
		if s.StartMS <= start && s.EndMS >= end {
			return true
		}
	}
	return false
}
