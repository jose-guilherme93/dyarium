// Package transcribe orchestrates the whisper.cpp subprocess: it decrypts the
// audio to a temporary directory, derives a 16 kHz mono working copy, chunks it
// by silence, transcribes each chunk with checkpoints and maps timestamps back
// to the original audio. The original file is never modified.
package transcribe

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/joseti/dyarium/internal/audio"
	"github.com/joseti/dyarium/internal/store"
)

// cacheKeyVersion identifies the derived 16 kHz mono artifact. Trimming
// silences does not change the derived audio (it only skips silent chunks), so
// it is intentionally not part of the key.
const cacheKeyVersion = "16k:v1"

// Chunk is a transcribed span of the original timeline.
type Chunk struct {
	Index   int
	StartMS int64
	EndMS   int64
	Silence bool
}

// Segment is a transcribed span relative to a chunk or the original audio.
type Segment struct {
	StartMS int64
	EndMS   int64
	Text    string
}

// Config configures the transcriber.
type Config struct {
	Model       string
	Language    string
	TrimSilence bool
}

// Deps groups the operations the pipeline depends on. Tests replace these with
// fakes; production wires the real ffmpeg/whisper implementations.
type Deps struct {
	Decrypt     func(ctx context.Context, att store.Attachment) (string, error)
	GetDerived  func(ctx context.Context, entryID, cacheKey string) (string, bool, error)
	SaveDerived func(ctx context.Context, entryID, cacheKey, contentType, srcPath string) error
	Derive16k   func(ctx context.Context, src string) (string, error)
	Metrics     func(ctx context.Context, src string) (audio.Metrics, error)
	Silences    func(ctx context.Context, path string) ([]audio.Interval, error)
	Slice       func(ctx context.Context, src, dst string, startMS, durMS int64) error
	Transcribe  func(ctx context.Context, wavPath string, onSegment func(Segment)) ([]Segment, int64, string, error)
}

// Callbacks report pipeline progress to the caller (the worker).
type Callbacks struct {
	Heartbeat func() error
	Progress  func(stage string, done, total int)
	Segment   func(seg Segment)
}

// Pipeline runs the transcription pipeline for an entry.
type Pipeline struct {
	store         *store.Store
	deps          Deps
	checkpointDir string
	model         string
}

// NewPipeline builds a Pipeline. checkpointDir stores per-chunk checkpoints so a
// restarted worker resumes without reprocessing.
func NewPipeline(st *store.Store, deps Deps, checkpointDir, model string) *Pipeline {
	return &Pipeline{store: st, deps: deps, checkpointDir: checkpointDir, model: model}
}

type chunkResult struct {
	Chunk    Chunk     `json:"chunk"`
	Segments []Segment `json:"segments"`
}

// Run transcribes one audio of an entry. The callbacks report progress and
// stream segments for the dashboard.
func (p *Pipeline) Run(ctx context.Context, entryID, attachmentID string, cb Callbacks) error {
	report := func(stage string, done, total int) {
		if cb.Progress != nil {
			cb.Progress(stage, done, total)
		}
	}
	report("preparando", 0, 0)
	entry, err := p.store.GetEntry(ctx, entryID)
	if err != nil {
		return fmt.Errorf("transcribe: get entry: %w", err)
	}
	att, err := p.audioAttachment(ctx, entryID, attachmentID)
	if err != nil {
		return fmt.Errorf("transcribe: audio attachment: %w", err)
	}
	if err := p.store.UpdateEntryStatus(ctx, entryID, store.EntryTranscribing); err != nil {
		return err
	}

	src, err := p.deps.Decrypt(ctx, att)
	if err != nil {
		return err
	}
	defer os.Remove(src)

	metrics, err := p.deps.Metrics(ctx, src)
	if err != nil {
		return fmt.Errorf("transcribe: metrics: %w", err)
	}
	if err := p.store.UpsertMetrics(ctx, store.AudioMetrics{
		EntryID:        entryID,
		DurationMS:     metrics.DurationMS,
		LoudnessLUFS:   metrics.LoudnessLUFS,
		TruePeak:       metrics.TruePeak,
		SilenceCount:   metrics.SilenceCount,
		SilenceTotalMS: metrics.SilenceTotalMS,
		SampleRate:     metrics.SampleRate,
		Channels:       metrics.Channels,
	}); err != nil {
		return err
	}

	derived, err := p.derived(ctx, entryID, att.ID, src)
	if err != nil {
		return err
	}
	defer os.Remove(derived)

	silences, err := p.deps.Silences(ctx, derived)
	if err != nil {
		silences = nil
	}
	chunks := PlanChunks(metrics.DurationMS, silences)
	report("transcrevendo", 0, len(chunks))

	trim := p.trimSilence(ctx)

	ckptName := att.ID
	if ckptName == "" {
		ckptName = entryID
	}
	ckptPath := filepath.Join(p.checkpointDir, ckptName+".json")
	results := loadCheckpoint(ckptPath)

	var peakMB int64
	language := ""
	completed := 0
	for _, ch := range chunks {
		if _, done := results[ch.Index]; done {
			continue
		}
		if trim && ch.Silence {
			results[ch.Index] = chunkResult{Chunk: ch}
		} else {
			segs, peak, lang, err := p.transcribeChunk(ctx, derived, ch, cb.Segment)
			if err != nil {
				return err
			}
			if peak > peakMB {
				peakMB = peak
			}
			if language == "" && lang != "" {
				language = lang
			}
			results[ch.Index] = chunkResult{Chunk: ch, Segments: segs}
		}
		saveCheckpoint(ckptPath, results)
		completed++
		report("transcrevendo", completed, len(chunks))
		if cb.Heartbeat != nil {
			if err := cb.Heartbeat(); err != nil {
				return err
			}
		}
	}

	if peakMB > 0 {
		if err := p.store.SetWhisperPeakRSS(ctx, entryID, peakMB); err != nil {
			return err
		}
	}

	transcript, segments := assemble(entryID, chunks, results, metrics.DurationMS, trim, p.modelName(), language)
	transcript.AttachmentID = att.ID
	if err := p.store.SaveTranscript(ctx, transcript, segments); err != nil {
		return err
	}
	if err := p.store.UpdateEntryStatus(ctx, entryID, store.EntryTranscribed); err != nil {
		return err
	}
	os.Remove(ckptPath)
	_ = entry
	return nil
}

func (p *Pipeline) transcribeChunk(ctx context.Context, derived string, ch Chunk, onSegment func(Segment)) ([]Segment, int64, string, error) {
	tmp, err := os.CreateTemp("", "dyarium-slice-*.wav")
	if err != nil {
		return nil, 0, "", fmt.Errorf("transcribe: temp slice: %w", err)
	}
	slicePath := tmp.Name()
	tmp.Close()
	defer os.Remove(slicePath)

	if err := p.deps.Slice(ctx, derived, slicePath, ch.StartMS, ch.EndMS-ch.StartMS); err != nil {
		return nil, 0, "", err
	}
	forward := func(seg Segment) {
		if onSegment == nil {
			return
		}
		seg.StartMS += ch.StartMS
		seg.EndMS += ch.StartMS
		onSegment(seg)
	}
	segs, peak, language, err := p.deps.Transcribe(ctx, slicePath, forward)
	if err != nil {
		return nil, 0, "", err
	}
	for i := range segs {
		segs[i].StartMS += ch.StartMS
		segs[i].EndMS += ch.StartMS
	}
	return segs, peak, language, nil
}

// audioAttachment returns the audio to transcribe: the given attachment, or the
// entry's first audio when no id is provided.
func (p *Pipeline) audioAttachment(ctx context.Context, entryID, attachmentID string) (store.Attachment, error) {
	if attachmentID != "" {
		return p.store.GetAttachment(ctx, attachmentID)
	}
	return p.store.GetAttachmentByKind(ctx, entryID, store.AttachmentOriginal)
}

func (p *Pipeline) derived(ctx context.Context, entryID, attachmentID, src string) (string, error) {
	cacheKey := cacheKeyVersion
	if attachmentID != "" {
		cacheKey = "16k:" + attachmentID + ":v1"
	}
	if path, ok, err := p.deps.GetDerived(ctx, entryID, cacheKey); err != nil {
		return "", err
	} else if ok {
		return path, nil
	}
	path, err := p.deps.Derive16k(ctx, src)
	if err != nil {
		return "", fmt.Errorf("transcribe: derive: %w", err)
	}
	// Caching is best effort; a failure to cache must not fail the job.
	_ = p.deps.SaveDerived(ctx, entryID, cacheKey, "audio/wav", path)
	return path, nil
}

func (p *Pipeline) trimSilence(ctx context.Context) bool {
	v, ok, err := p.store.GetSetting(ctx, "trim_silence")
	if err != nil || !ok {
		return false
	}
	return v == "true"
}

func (p *Pipeline) modelName() string {
	return p.model
}
