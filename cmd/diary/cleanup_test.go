package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
)

func newCleanupEnv(t *testing.T) (*store.Store, *ingest.Service, string) {
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
	dataDir := filepath.Join(dir, "data")
	key := bytes.Repeat([]byte{7}, 32)
	ing := ingest.New(ingest.Config{MaxUploadBytes: 1 << 20}, st, key, dataDir, nil)
	return st, ing, dataDir
}

func runCleanup(t *testing.T, st *store.Store, ing *ingest.Service, entryID string) {
	t.Helper()
	payload, err := json.Marshal(jobs.CleanupPayload{EntryID: entryID})
	if err != nil {
		t.Fatalf("payload: %v", err)
	}
	handler := cleanupHandler(st, ing, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := handler(context.Background(), &jobs.Job{Payload: payload}, func() error { return nil }); err != nil {
		t.Fatalf("cleanup handler: %v", err)
	}
}

func TestCleanupRemovesObjectsAndEntry(t *testing.T) {
	ctx := context.Background()
	st, ing, dataDir := newCleanupEnv(t)

	entry, err := ing.IngestStream(ctx, "upload", "a.wav", "audio/wav", strings.NewReader("conteudo de audio"))
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	attachments, err := st.ListAttachments(ctx, entry.ID)
	if err != nil || len(attachments) != 1 {
		t.Fatalf("attachments = %d, err = %v", len(attachments), err)
	}
	objectPath := filepath.Join(dataDir, attachments[0].StorageKey)
	if _, err := os.Stat(objectPath); err != nil {
		t.Fatalf("objeto deveria existir: %v", err)
	}

	if err := st.SoftDeleteEntry(ctx, entry.ID); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	runCleanup(t, st, ing, entry.ID)

	if _, err := os.Stat(objectPath); !os.IsNotExist(err) {
		t.Fatalf("objeto cifrado deveria ter sido removido, stat err = %v", err)
	}
	if _, err := st.EntryIsDeleted(ctx, entry.ID); err != store.ErrNotFound {
		t.Fatalf("entrada deveria ter sido removida, err = %v", err)
	}
}

func TestCleanupKeepsLiveEntry(t *testing.T) {
	ctx := context.Background()
	st, ing, dataDir := newCleanupEnv(t)

	entry, err := ing.IngestStream(ctx, "upload", "a.wav", "audio/wav", strings.NewReader("conteudo de audio"))
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	attachments, err := st.ListAttachments(ctx, entry.ID)
	if err != nil || len(attachments) != 1 {
		t.Fatalf("attachments = %d, err = %v", len(attachments), err)
	}
	objectPath := filepath.Join(dataDir, attachments[0].StorageKey)

	// The entry is not deleted; the leftover job must not purge it.
	runCleanup(t, st, ing, entry.ID)

	if _, err := st.GetEntry(ctx, entry.ID); err != nil {
		t.Fatalf("entrada viva deveria continuar existindo: %v", err)
	}
	if _, err := os.Stat(objectPath); err != nil {
		t.Fatalf("objeto de entrada viva deveria continuar: %v", err)
	}
}
