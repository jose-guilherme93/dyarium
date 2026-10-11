package transcribe_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/audio"
	"github.com/joseti/dyarium/internal/store"
	"github.com/joseti/dyarium/internal/transcribe"
)

func TestPlanChunksCutsAtSilence(t *testing.T) {
	duration := int64(25 * 60 * 1000)
	// A silence around minute 9 should attract the first cut.
	silences := []audio.Interval{{StartMS: 9*60*1000 - 500, EndMS: 9*60*1000 + 500}}
	chunks := transcribe.PlanChunks(duration, silences)
	if len(chunks) != 3 {
		t.Fatalf("got %d chunks, want 3", len(chunks))
	}
	if chunks[0].EndMS != 9*60*1000 {
		t.Fatalf("first cut = %d, want %d", chunks[0].EndMS, 9*60*1000)
	}
	if chunks[2].EndMS != duration {
		t.Fatalf("last end = %d, want %d", chunks[2].EndMS, duration)
	}
}

func TestPlanChunksHardCutWithoutSilence(t *testing.T) {
	duration := int64(25 * 60 * 1000)
	chunks := transcribe.PlanChunks(duration, nil)
	if len(chunks) != 3 {
		t.Fatalf("got %d chunks, want 3", len(chunks))
	}
	for _, c := range chunks {
		if c.EndMS-c.StartMS > 15*60*1000 {
			t.Fatalf("chunk too long: %+v", c)
		}
		if c.Silence {
			t.Fatalf("chunk wrongly marked as silence: %+v", c)
		}
	}
}

func TestPlanChunksMarksSilence(t *testing.T) {
	duration := int64(20 * 60 * 1000)
	// The whole second half is silence.
	silences := []audio.Interval{{StartMS: 10 * 60 * 1000, EndMS: duration}}
	chunks := transcribe.PlanChunks(duration, silences)
	last := chunks[len(chunks)-1]
	if !last.Silence {
		t.Fatalf("expected last chunk to be silence, got %+v", last)
	}
}

func newEntry(t *testing.T) (*store.Store, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "diary.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	ctx := context.Background()
	now := time.Now().UTC()
	entry := store.Entry{ID: "en1", Status: store.EntryStored, Source: "upload", SizeBytes: 1, CreatedAt: now, UpdatedAt: now}
	if err := st.CreateEntry(ctx, entry); err != nil {
		t.Fatalf("entry: %v", err)
	}
	att := store.Attachment{ID: "at1", EntryID: "en1", Kind: store.AttachmentOriginal, StorageKey: "objects/en1.enc", Cipher: "aes-256-gcm", CreatedAt: now}
	if err := st.CreateAttachment(ctx, att); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	return st, dir
}

func fakeDeps(t *testing.T, sliced *[]int64, failAt int64) transcribe.Deps {
	last := int64(-1)
	return transcribe.Deps{
		Decrypt: func(context.Context, store.Attachment) (string, error) {
			f, _ := os.CreateTemp("", "src-*")
			f.Close()
			return f.Name(), nil
		},
		GetDerived:  func(context.Context, string, string) (string, bool, error) { return "", false, nil },
		SaveDerived: func(context.Context, string, string, string, string) error { return nil },
		Derive16k: func(context.Context, string) (string, error) {
			f, _ := os.CreateTemp("", "16k-*")
			f.Close()
			return f.Name(), nil
		},
		Metrics: func(context.Context, string) (audio.Metrics, error) {
			return audio.Metrics{DurationMS: 25 * 60 * 1000}, nil
		},
		Silences: func(context.Context, string) ([]audio.Interval, error) { return nil, nil },
		Slice: func(_ context.Context, _ string, _ string, startMS, _ int64) error {
			*sliced = append(*sliced, startMS)
			last = startMS
			return nil
		},
		Transcribe: func(_ context.Context, _ string, onSegment func(transcribe.Segment)) ([]transcribe.Segment, int64, string, error) {
			if failAt >= 0 && last == failAt {
				return nil, 0, "", fmt.Errorf("falha simulada no chunk %d", last)
			}
			seg := transcribe.Segment{StartMS: 0, EndMS: 1000, Text: fmt.Sprintf("chunk-%d", last)}
			if onSegment != nil {
				onSegment(seg)
			}
			return []transcribe.Segment{seg}, 128, "pt", nil
		},
	}
}

func TestPipelineResumesAfterFailure(t *testing.T) {
	st, dir := newEntry(t)
	ctx := context.Background()

	chunks := transcribe.PlanChunks(25*60*1000, nil)
	secondStart := chunks[1].StartMS

	var sliced []int64
	ckpt := filepath.Join(dir, "checkpoints")

	// First run fails on the second chunk.
	p1 := transcribe.NewPipeline(st, fakeDeps(t, &sliced, secondStart), ckpt, "modelo-teste")
	if err := p1.Run(ctx, "en1", transcribe.Callbacks{}); err == nil {
		t.Fatal("esperava falha no primeiro run")
	}
	if len(sliced) != 2 {
		t.Fatalf("primeiro run processou %d chunks, esperava 2", len(sliced))
	}

	// Second run must skip the already checkpointed first chunk.
	sliced = nil
	p2 := transcribe.NewPipeline(st, fakeDeps(t, &sliced, -1), ckpt, "modelo-teste")
	if err := p2.Run(ctx, "en1", transcribe.Callbacks{}); err != nil {
		t.Fatalf("segundo run: %v", err)
	}
	if len(sliced) != 2 {
		t.Fatalf("segundo run processou %d chunks, esperava 2 (chunk 0 retomado)", len(sliced))
	}
	for _, s := range sliced {
		if s == chunks[0].StartMS {
			t.Fatal("chunk 0 foi reprocessado")
		}
	}

	transcript, segments, err := st.GetTranscript(ctx, "en1")
	if err != nil {
		t.Fatalf("transcript: %v", err)
	}
	if len(segments) != 3 {
		t.Fatalf("segmentos = %d, esperava 3", len(segments))
	}
	// Timestamps must reference the original timeline (chunk starts).
	if segments[0].StartMS != chunks[0].StartMS {
		t.Fatalf("primeiro segmento em %d, esperava %d", segments[0].StartMS, chunks[0].StartMS)
	}
	if segments[2].StartMS != chunks[2].StartMS {
		t.Fatalf("terceiro segmento em %d, esperava %d", segments[2].StartMS, chunks[2].StartMS)
	}
	_ = transcript
}

func TestPipelineTrimSilenceSkipsChunks(t *testing.T) {
	st, dir := newEntry(t)
	ctx := context.Background()
	if err := st.SetSetting(ctx, "trim_silence", "true"); err != nil {
		t.Fatalf("setting: %v", err)
	}

	var sliced []int64
	deps := fakeDeps(t, &sliced, -1)
	// The last chunk is entirely silence.
	deps.Silences = func(context.Context, string) ([]audio.Interval, error) {
		return []audio.Interval{{StartMS: 20 * 60 * 1000, EndMS: 25 * 60 * 1000}}, nil
	}

	p := transcribe.NewPipeline(st, deps, filepath.Join(dir, "checkpoints"), "modelo-teste")
	if err := p.Run(ctx, "en1", transcribe.Callbacks{}); err != nil {
		t.Fatalf("run: %v", err)
	}
	// Only the two non-silent chunks should have been transcribed.
	if len(sliced) != 2 {
		t.Fatalf("processou %d chunks, esperava 2 (silencio ignorado)", len(sliced))
	}
	tr, _, err := st.GetTranscript(ctx, "en1")
	if err != nil {
		t.Fatalf("transcript: %v", err)
	}
	if !tr.TrimSilence {
		t.Fatal("transcript deveria registrar trim_silence=true")
	}
}
