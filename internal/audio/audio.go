// Package audio wraps the ffmpeg and ffprobe subprocesses used to measure audio
// (duration, loudness, true peak, silence) and to derive the 16 kHz mono working
// copy for transcription. The original audio is never modified.
package audio

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// Prober runs ffprobe and ffmpeg.
type Prober struct {
	FFmpegBin  string
	FFprobeBin string
}

// NewProber builds a Prober with the given binaries.
func NewProber(ffmpegBin, ffprobeBin string) *Prober {
	return &Prober{FFmpegBin: ffmpegBin, FFprobeBin: ffprobeBin}
}

// Interval is a time span in milliseconds.
type Interval struct {
	StartMS int64
	EndMS   int64
}

// Metrics aggregates the audio measurements.
type Metrics struct {
	DurationMS     int64
	LoudnessLUFS   float64
	TruePeak       float64
	SilenceCount   int
	SilenceTotalMS int64
	SampleRate     int
	Channels       int
}

// DurationSeconds returns the media duration using ffprobe.
func (p *Prober) DurationSeconds(ctx context.Context, path string) (float64, error) {
	out, _, err := run(ctx, p.FFprobeBin, "-v", "error",
		"-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path)
	if err != nil {
		return 0, fmt.Errorf("audio: ffprobe duration: %w", err)
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(out), 64)
	if err != nil {
		return 0, fmt.Errorf("audio: parse duration %q: %w", out, err)
	}
	return d, nil
}

// Info returns the sample rate and channel count of the first audio stream.
func (p *Prober) Info(ctx context.Context, path string) (sampleRate, channels int, err error) {
	out, _, err := run(ctx, p.FFprobeBin, "-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=sample_rate,channels", "-of", "default=nw=1:nk=1", path)
	if err != nil {
		return 0, 0, fmt.Errorf("audio: ffprobe streams: %w", err)
	}
	lines := strings.Fields(strings.TrimSpace(out))
	if len(lines) < 2 {
		return 0, 0, fmt.Errorf("audio: unexpected stream info %q", out)
	}
	sr, _ := strconv.Atoi(lines[0])
	ch, _ := strconv.Atoi(lines[1])
	return sr, ch, nil
}

// Loudness returns the integrated loudness (LUFS) and true peak using loudnorm.
func (p *Prober) Loudness(ctx context.Context, path string) (float64, float64, error) {
	_, stderr, err := run(ctx, p.FFmpegBin, "-hide_banner", "-nostats",
		"-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-")
	if err != nil {
		return 0, 0, fmt.Errorf("audio: ffmpeg loudnorm: %w", err)
	}
	return parseLoudnorm(stderr)
}

// Silences returns detected silence intervals using silencedetect.
func (p *Prober) Silences(ctx context.Context, path string, noiseDB float64, minDurSec float64) ([]Interval, error) {
	filter := fmt.Sprintf("silencedetect=noise=%.1fdB:d=%.3f", noiseDB, minDurSec)
	_, stderr, err := run(ctx, p.FFmpegBin, "-hide_banner", "-nostats",
		"-i", path, "-af", filter, "-f", "null", "-")
	if err != nil {
		return nil, fmt.Errorf("audio: ffmpeg silencedetect: %w", err)
	}
	return parseSilences(stderr), nil
}

// Metrics computes the full set of measurements for a plaintext audio file.
func (p *Prober) Metrics(ctx context.Context, path string) (Metrics, error) {
	var m Metrics
	dur, err := p.DurationSeconds(ctx, path)
	if err != nil {
		return m, err
	}
	m.DurationMS = int64(dur * 1000)
	if sr, ch, err := p.Info(ctx, path); err == nil {
		m.SampleRate = sr
		m.Channels = ch
	}
	if lufs, peak, err := p.Loudness(ctx, path); err == nil {
		m.LoudnessLUFS = lufs
		m.TruePeak = peak
	}
	if sil, err := p.Silences(ctx, path, -30, 0.5); err == nil {
		m.SilenceCount = len(sil)
		for _, iv := range sil {
			m.SilenceTotalMS += iv.EndMS - iv.StartMS
		}
	}
	return m, nil
}

// Derive16kMono writes a 16 kHz mono PCM s16le WAV working copy to dst.
func (p *Prober) Derive16kMono(ctx context.Context, src, dst string) error {
	_, stderr, err := run(ctx, p.FFmpegBin, "-hide_banner", "-loglevel", "error",
		"-i", src, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", dst)
	if err != nil {
		return fmt.Errorf("audio: ffmpeg derive (%s): %w", stderr, err)
	}
	return nil
}

// ExtractSlice writes [startMS, startMS+durationMS) of src to dst as 16 kHz mono WAV.
func (p *Prober) ExtractSlice(ctx context.Context, src, dst string, startMS, durationMS int64) error {
	_, stderr, err := run(ctx, p.FFmpegBin, "-hide_banner", "-loglevel", "error",
		"-ss", fmt.Sprintf("%.3f", float64(startMS)/1000),
		"-t", fmt.Sprintf("%.3f", float64(durationMS)/1000),
		"-i", src, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", dst)
	if err != nil {
		return fmt.Errorf("audio: ffmpeg slice (%s): %w", stderr, err)
	}
	return nil
}

func run(ctx context.Context, bin string, args ...string) (string, string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.String(), stderr.String(), err
}

var loudnormJSON = regexp.MustCompile(`(?s)\{.*\}`)

func parseLoudnorm(stderr string) (float64, float64, error) {
	m := loudnormJSON.FindString(stderr)
	if m == "" {
		return 0, 0, fmt.Errorf("audio: loudnorm output not found")
	}
	var doc struct {
		InputI  string `json:"input_i"`
		InputTP string `json:"input_tp"`
	}
	if err := json.Unmarshal([]byte(m), &doc); err != nil {
		return 0, 0, fmt.Errorf("audio: parse loudnorm: %w", err)
	}
	lufs, _ := strconv.ParseFloat(doc.InputI, 64)
	peak, _ := strconv.ParseFloat(doc.InputTP, 64)
	return lufs, peak, nil
}

var (
	silenceStartRe = regexp.MustCompile(`silence_start:\s*([0-9.]+)`)
	silenceEndRe   = regexp.MustCompile(`silence_end:\s*([0-9.]+)`)
)

func parseSilences(stderr string) []Interval {
	var out []Interval
	var pending int64 = -1
	for _, line := range strings.Split(stderr, "\n") {
		if m := silenceStartRe.FindStringSubmatch(line); m != nil {
			sec, _ := strconv.ParseFloat(m[1], 64)
			pending = int64(sec * 1000)
		}
		if m := silenceEndRe.FindStringSubmatch(line); m != nil && pending >= 0 {
			sec, _ := strconv.ParseFloat(m[1], 64)
			out = append(out, Interval{StartMS: pending, EndMS: int64(sec * 1000)})
			pending = -1
		}
	}
	return out
}
