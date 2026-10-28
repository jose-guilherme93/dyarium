package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func seedAudio(t *testing.T, s *Store, entryID, attID, sha string, when time.Time) {
	t.Helper()
	if err := s.CreateAttachment(context.Background(), Attachment{
		ID:          attID,
		EntryID:     entryID,
		Kind:        AttachmentOriginal,
		StorageKey:  "objects/" + attID + ".enc",
		ContentType: "audio/wav",
		SizeBytes:   10,
		SHA256:      sha,
		Cipher:      "aes-256-gcm",
		CreatedAt:   when,
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}
}

func TestDeduplicateMergesSameAudio(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "keep", now)
	seedEntry(t, s, "dup", now.Add(time.Minute))
	seedAudio(t, s, "keep", "a_keep", "audio-sha", now)
	seedAudio(t, s, "dup", "a_dup", "audio-sha", now.Add(time.Minute))
	// A duplicada guarda a transcricao: por isso ela deve ser o keeper.
	if err := s.SaveTranscript(ctx, Transcript{ID: "tr1", EntryID: "dup", AttachmentID: "a_dup", Model: "m", Text: "ola", CreatedAt: now}, nil); err != nil {
		t.Fatalf("transcript: %v", err)
	}

	report, err := s.DeduplicateEntries(ctx, false)
	if err != nil {
		t.Fatalf("dedupe: %v", err)
	}
	if report.Merged != 1 {
		t.Fatalf("merged = %d, want 1", report.Merged)
	}

	audios, err := s.ListAudios(ctx, "dup")
	if err != nil || len(audios) != 1 || audios[0].ID != "a_dup" {
		t.Fatalf("audios do keeper = %+v (%v)", audios, err)
	}
	if _, err := s.GetEntry(ctx, "keep"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("a duplicada deveria ter sido removida, veio %v", err)
	}
	if tr, _, err := s.GetTranscriptByAttachment(ctx, "a_dup"); err != nil || tr.Text != "ola" {
		t.Fatalf("transcricao perdida: %v %+v", err, tr)
	}
	if len(report.RemovedObjects) != 1 || report.RemovedObjects[0] != "objects/a_keep.enc" {
		t.Fatalf("objetos redundantes = %v", report.RemovedObjects)
	}
}

func TestDeduplicateDryRunChangesNothing(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "a", now)
	seedEntry(t, s, "b", now.Add(time.Minute))
	seedAudio(t, s, "a", "a1", "same", now)
	seedAudio(t, s, "b", "b1", "same", now.Add(time.Minute))

	report, err := s.DeduplicateEntries(ctx, true)
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	if report.Merged != 1 {
		t.Fatalf("merged = %d, want 1", report.Merged)
	}
	for _, id := range []string{"a", "b"} {
		if _, err := s.GetEntry(ctx, id); err != nil {
			t.Fatalf("dry-run alterou o banco (%s): %v", id, err)
		}
	}
}

func TestDeduplicateKeepsDifferentAudio(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "a", now)
	seedEntry(t, s, "b", now.Add(time.Minute))
	seedAudio(t, s, "a", "a1", "sha-a", now)
	seedAudio(t, s, "b", "b1", "sha-b", now.Add(time.Minute))

	report, err := s.DeduplicateEntries(ctx, false)
	if err != nil {
		t.Fatalf("dedupe: %v", err)
	}
	if report.Merged != 0 {
		t.Fatalf("merged = %d, want 0", report.Merged)
	}
	for _, id := range []string{"a", "b"} {
		if _, err := s.GetEntry(ctx, id); err != nil {
			t.Fatalf("audios diferentes nao deveriam se mesclar (%s): %v", id, err)
		}
	}
}
