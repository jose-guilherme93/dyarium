package transcribe

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jose-guilherme93/dyarium/internal/audio"
	"github.com/jose-guilherme93/dyarium/internal/store"
)

// WhisperCLI runs the whisper-cli binary as a subprocess. It parses the segment
// lines printed while processing so the dashboard can show the transcription
// growing in real time.
type WhisperCLI struct {
	Bin      string
	Model    string
	Language string
	// MaxRSSMB caps the resident memory of the subprocess (0 means no limit).
	MaxRSSMB int64
}

// NewWhisperCLI builds a WhisperCLI.
func NewWhisperCLI(bin, model, language string) *WhisperCLI {
	return &WhisperCLI{Bin: bin, Model: model, Language: language}
}

var segmentRe = regexp.MustCompile(`^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$`)

// Transcribe returns the segments relative to wavPath, the peak RSS (MB) and the
// language. onSegment, when set, is called for each segment as it is printed.
func (w *WhisperCLI) Transcribe(ctx context.Context, wavPath string, onSegment func(Segment)) ([]Segment, int64, string, error) {
	args := []string{"-m", w.Model, "-f", wavPath}
	if w.Language != "" {
		args = append(args, "-l", w.Language)
	}
	cmd := exec.CommandContext(ctx, w.Bin, args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, 0, "", fmt.Errorf("transcribe: stderr pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, 0, "", fmt.Errorf("transcribe: stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, 0, "", fmt.Errorf("transcribe: whisper-cli: %w", err)
	}

	var peak atomic.Int64
	var exceeded atomic.Bool
	stopMonitor := make(chan struct{})
	if w.MaxRSSMB > 0 && cmd.Process != nil {
		pid := cmd.Process.Pid
		go func() {
			ticker := time.NewTicker(200 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-stopMonitor:
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

	var (
		mu    sync.Mutex
		segs  []Segment
		wg    sync.WaitGroup
		lines []string
	)
	parse := func(line string) {
		m := segmentRe.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if m == nil {
			return
		}
		text := strings.TrimSpace(m[9])
		if text == "" {
			return
		}
		seg := Segment{StartMS: clockMS(m[1], m[2], m[3], m[4]), EndMS: clockMS(m[5], m[6], m[7], m[8]), Text: text}
		mu.Lock()
		segs = append(segs, seg)
		mu.Unlock()
		if onSegment != nil {
			onSegment(seg)
		}
	}
	scan := func(r interface{ Read([]byte) (int, error) }) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			lines = append(lines, line)
			parse(line)
		}
	}
	wg.Add(2)
	go scan(stdout)
	go scan(stderr)

	waitErr := cmd.Wait()
	wg.Wait()
	close(stopMonitor)
	if state := cmd.ProcessState; state != nil {
		if mb := peakRSSMB(state); mb > peak.Load() {
			peak.Store(mb)
		}
	}
	if exceeded.Load() {
		return nil, peak.Load(), w.Language, fmt.Errorf("transcribe: limite de RAM (%d MB) excedido", w.MaxRSSMB)
	}
	if waitErr != nil {
		return nil, peak.Load(), w.Language, fmt.Errorf("transcribe: whisper-cli: %w (%s)", waitErr, tail(strings.Join(lines, "\n"), 400))
	}
	return segs, peak.Load(), w.Language, nil
}

func clockMS(h, m, s, ms string) int64 {
	hi, _ := strconv.ParseInt(h, 10, 64)
	mi, _ := strconv.ParseInt(m, 10, 64)
	si, _ := strconv.ParseInt(s, 10, 64)
	msi, _ := strconv.ParseInt(ms, 10, 64)
	return ((hi*60+mi)*60+si)*1000 + msi
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
	Provider        string
	Model           string
	Language        string
	MaxRSSMB        int64
	DeepgramKey     string
	DeepgramModel   string
	DeepgramBaseURL string
}

// RealDeps wires the production dependencies (ffmpeg and whisper-cli or
// Deepgram). runtime returns the current settings, read per run.
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
		Transcribe: func(ctx context.Context, wavPath string, onSegment func(Segment)) ([]Segment, int64, string, error) {
			r := Runtime{}
			if runtime != nil {
				r = runtime(ctx)
			}
			if r.Provider == "deepgram" {
				dg := NewDeepgram(r.DeepgramKey, r.DeepgramModel, r.DeepgramBaseURL)
				segs, lang, err := dg.Transcribe(ctx, wavPath, r.Language, onSegment)
				return segs, 0, lang, err
			}
			cli := *whisper
			if r.Model != "" {
				cli.Model = r.Model
			}
			cli.Language = r.Language
			cli.MaxRSSMB = r.MaxRSSMB
			return cli.Transcribe(ctx, wavPath, onSegment)
		},
	}
}
