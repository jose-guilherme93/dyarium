package transcribe

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/joseti/dyarium/internal/audio"
	"github.com/joseti/dyarium/internal/store"
)

// WhisperCLI runs the whisper-cli binary as a subprocess, requesting JSON output
// so chunk segments can be mapped back to the original timeline.
type WhisperCLI struct {
	Bin      string
	Model    string
	Language string
	// MaxRSSMB caps the resident memory of the subprocess (0 means no limit).
	// The limit is enforced by watching the process RSS and killing it when the
	// ceiling is exceeded, so it matches the "RAM" concept shown in the UI.
	MaxRSSMB int64
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

// Transcribe returns segments relative to wavPath and the peak RSS (MB) observed
// for the subprocess. Offsets from whisper-cli are already in milliseconds.
func (w *WhisperCLI) Transcribe(ctx context.Context, wavPath string) ([]Segment, int64, error) {
	base, err := os.CreateTemp("", "whisper-out-*")
	if err != nil {
		return nil, 0, fmt.Errorf("transcribe: temp output: %w", err)
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

	if err := cmd.Start(); err != nil {
		return nil, 0, fmt.Errorf("transcribe: whisper-cli: %w", err)
	}

	var peak atomic.Int64
	var exceeded atomic.Bool
	done := make(chan struct{})
	if w.MaxRSSMB > 0 && cmd.Process != nil {
		pid := cmd.Process.Pid
		go func() {
			ticker := time.NewTicker(200 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					rss := readRSSMB(pid)
					if rss > peak.Load() {
						peak.Store(rss)
					}
					if rss > w.MaxRSSMB {
						exceeded.Store(true)
						_ = cmd.Process.Kill()
						return
					}
				}
			}
		}()
	}

	waitErr := cmd.Wait()
	close(done)
	if state := cmd.ProcessState; state != nil {
		if mb := peakRSSMB(state); mb > peak.Load() {
			peak.Store(mb)
		}
	}
	if exceeded.Load() {
		return nil, peak.Load(), fmt.Errorf("transcribe: limite de RAM (%d MB) excedido", w.MaxRSSMB)
	}
	if waitErr != nil {
		return nil, peak.Load(), fmt.Errorf("transcribe: whisper-cli: %w (%s)", waitErr, tail(stderr.String(), 400))
	}

	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return nil, peak.Load(), fmt.Errorf("transcribe: read whisper output: %w", err)
	}
	var out whisperOutput
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, peak.Load(), fmt.Errorf("transcribe: parse whisper output: %w", err)
	}
	segs := make([]Segment, 0, len(out.Transcription))
	for _, seg := range out.Transcription {
		text := strings.TrimSpace(seg.Text)
		if text == "" {
			continue
		}
		segs = append(segs, Segment{StartMS: seg.Offsets.From, EndMS: seg.Offsets.To, Text: text})
	}
	return segs, peak.Load(), nil
}

func readRSSMB(pid int) int64 {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				kb, _ := strconv.ParseInt(fields[1], 10, 64)
				return kb / 1024
			}
		}
	}
	return 0
}

func peakRSSMB(state *os.ProcessState) int64 {
	if state == nil {
		return 0
	}
	if usage, ok := state.SysUsage().(*syscall.Rusage); ok && usage.Maxrss > 0 {
		return int64(usage.Maxrss) / 1024
	}
	return 0
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

// Runtime holds per-run settings read from the database.
type Runtime struct {
	Model    string
	MaxRSSMB int64
}

// RealDeps wires the production dependencies (ffmpeg and whisper-cli). runtime
// returns the current model and RAM ceiling, read per run from settings.
func RealDeps(blobs BlobStore, prober *audio.Prober, whisper *WhisperCLI, runtime func(ctx context.Context) Runtime) Deps {
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
		Transcribe: func(ctx context.Context, wavPath string) ([]Segment, int64, error) {
			cli := *whisper
			if runtime != nil {
				r := runtime(ctx)
				if r.Model != "" {
					cli.Model = r.Model
				}
				cli.MaxRSSMB = r.MaxRSSMB
			}
			return cli.Transcribe(ctx, wavPath)
		},
	}
}
