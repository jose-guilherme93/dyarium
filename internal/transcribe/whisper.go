package transcribe

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/joseti/dyarium/internal/audio"
	"github.com/joseti/dyarium/internal/store"
)

// WhisperCLI runs the whisper-cli binary as a subprocess, requesting JSON output
// so chunk segments can be mapped back to the original timeline.
type WhisperCLI struct {
	Bin      string
	Model    string
	Language string
}

// NewWhisperCLI builds a WhisperCLI.
func NewWhisperCLI(bin, model, language string) *WhisperCLI {
	return &WhisperCLI{Bin: bin, Model: model, Language: language}
}

type whisperOutput struct {
	Transcription []struct {
		Offsets struct {
			From int64 `json:"from"`
			To   int64 `json:"to"`
		} `json:"offsets"`
		Text string `json:"text"`
	} `json:"transcription"`
}

// Transcribe returns segments relative to wavPath (whisper-cli output offsets are
// already in milliseconds).
func (w *WhisperCLI) Transcribe(ctx context.Context, wavPath string) ([]Segment, error) {
	base, err := os.CreateTemp("", "whisper-out-*")
	if err != nil {
		return nil, fmt.Errorf("transcribe: temp output: %w", err)
	}
	outBase := base.Name()
	base.Close()
	defer os.Remove(outBase)
	jsonPath := outBase + ".json"
	defer os.Remove(jsonPath)

	args := []string{"-m", w.Model, "-f", wavPath, "-oj", "-np", "-of", outBase}
	if w.Language != "" {
		args = append(args, "-l", w.Language)
	}
	cmd := exec.CommandContext(ctx, w.Bin, args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("transcribe: whisper-cli: %w (%s)", err, tail(stderr.String(), 400))
	}

	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return nil, fmt.Errorf("transcribe: read whisper output: %w", err)
	}
	var out whisperOutput
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("transcribe: parse whisper output: %w", err)
	}
	segs := make([]Segment, 0, len(out.Transcription))
	for _, seg := range out.Transcription {
		text := strings.TrimSpace(seg.Text)
		if text == "" {
			continue
		}
		segs = append(segs, Segment{StartMS: seg.Offsets.From, EndMS: seg.Offsets.To, Text: text})
	}
	return segs, nil
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

// BlobStore is the storage surface the pipeline needs from the ingest layer.
type BlobStore interface {
	DecryptToTemp(ctx context.Context, att store.Attachment) (string, error)
	GetDerived(ctx context.Context, entryID, cacheKey string) (string, bool, error)
	SaveDerived(ctx context.Context, entryID, cacheKey, contentType, srcPath string) error
}

// RealDeps wires the production dependencies (ffmpeg and whisper-cli).
func RealDeps(blobs BlobStore, prober *audio.Prober, whisper *WhisperCLI) Deps {
	return Deps{
		Decrypt:    blobs.DecryptToTemp,
		GetDerived: blobs.GetDerived,
		SaveDerived: func(ctx context.Context, entryID, cacheKey, contentType, srcPath string) error {
			return blobs.SaveDerived(ctx, entryID, cacheKey, contentType, srcPath)
		},
		Derive16k: func(ctx context.Context, src string) (string, error) {
			tmp, err := os.CreateTemp("", "dyarium-16k-*.wav")
			if err != nil {
				return "", err
			}
			path := tmp.Name()
			tmp.Close()
			if err := prober.Derive16kMono(ctx, src, path); err != nil {
				os.Remove(path)
				return "", err
			}
			return path, nil
		},
		Metrics: prober.Metrics,
		Silences: func(ctx context.Context, path string) ([]audio.Interval, error) {
			return prober.Silences(ctx, path, -30, 0.5)
		},
		Slice: prober.ExtractSlice,
		Transcribe: func(ctx context.Context, wavPath string) ([]Segment, error) {
			return whisper.Transcribe(ctx, wavPath)
		},
	}
}
