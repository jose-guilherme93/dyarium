// Package transcribe orchestrates the whisper.cpp subprocess: it decrypts the
// audio to a temporary directory, derives a 16 kHz mono working copy, chunks it
// by silence, transcribes with checkpoints and maps timestamps back to the
// original audio. This phase defines the surface; the pipeline is a later phase.
package transcribe

import "context"

// Config configures the transcriber.
type Config struct {
	WhisperBin  string
	Model       string
	TrimSilence bool
	Language    string
}

// Segment is a transcribed span mapped to the original audio timeline.
type Segment struct {
	StartMS int64
	EndMS   int64
	Text    string
}

// Result is the outcome of a transcription.
type Result struct {
	Model      string
	Language   string
	Text       string
	Segments   []Segment
	DurationMS int64
}

// Transcriber transcribes an audio file.
type Transcriber interface {
	Transcribe(ctx context.Context, audioPath string) (Result, error)
}

// WhisperCLI runs the whisper-cli binary as a subprocess.
type WhisperCLI struct {
	cfg Config
}

// NewWhisperCLI builds a WhisperCLI.
func NewWhisperCLI(cfg Config) *WhisperCLI { return &WhisperCLI{cfg: cfg} }

// Transcribe is implemented in a later phase.
func (w *WhisperCLI) Transcribe(context.Context, string) (Result, error) {
	return Result{}, errNotImplemented
}

var errNotImplemented = &notImplementedError{}

type notImplementedError struct{}

func (*notImplementedError) Error() string { return "transcribe: not implemented yet" }
