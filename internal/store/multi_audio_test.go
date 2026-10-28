package store

import (
	"context"
	"testing"
	"time"
)

func TestTranscriptsPerAudio(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	if err := s.CreateEntry(ctx, Entry{ID: "en1", Status: EntryStored, Source: "upload", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("entry: %v", err)
	}
	for _, id := range []string{"a1", "a2"} {
		if err := s.CreateAttachment(ctx, Attachment{
			ID: id, EntryID: "en1", Kind: AttachmentOriginal, StorageKey: "objects/" + id,
			Cipher: "aes-256-gcm", DurationSeconds: 30, CreatedAt: now,
		}); err != nil {
			t.Fatalf("attachment %s: %v", id, err)
		}
	}
	for _, id := range []string{"a1", "a2"} {
		segs := []Segment{{ID: "s_" + id, TranscriptID: "t_" + id, StartMS: 0, EndMS: 1000, Text: "seg " + id, CreatedAt: now}}
		if err := s.SaveTranscript(ctx, Transcript{
			ID: "t_" + id, EntryID: "en1", AttachmentID: id, Model: "m", Text: "texto " + id, CreatedAt: now,
		}, segs); err != nil {
			t.Fatalf("save transcript %s: %v", id, err)
		}
	}
	// Re-saving a1 must replace only a1's transcript.
	if err := s.SaveTranscript(ctx, Transcript{
		ID: "t_a1b", EntryID: "en1", AttachmentID: "a1", Model: "m", Text: "novo a1", CreatedAt: now.Add(time.Second),
	}, nil); err != nil {
		t.Fatalf("resave: %v", err)
	}

	all, err := s.ListTranscripts(ctx, "en1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("transcripts = %d, want 2", len(all))
	}
	if t1, segs, err := s.GetTranscriptByAttachment(ctx, "a1"); err != nil || t1.Text != "novo a1" {
		t.Fatalf("a1 = %+v (%v)", t1, err)
	} else if len(segs) != 0 {
		t.Fatalf("a1 deveria ter 0 segmentos apos reescrita, got %d", len(segs))
	}
	if t2, segs, err := s.GetTranscriptByAttachment(ctx, "a2"); err != nil || t2.Text != "texto a2" || len(segs) != 1 {
		t.Fatalf("a2 = %+v (%v)", t2, err)
	}

	if err := s.SyncEntryDuration(ctx, "en1"); err != nil {
		t.Fatalf("sync: %v", err)
	}
	entry, err := s.GetEntry(ctx, "en1")
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if entry.DurationSeconds != 60 {
		t.Fatalf("duration = %v, want 60", entry.DurationSeconds)
	}
}
