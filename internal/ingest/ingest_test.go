package ingest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jose-guilherme93/dyarium/internal/store"
)

func newService(t *testing.T) (*Service, *store.Store, string) {
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
	key := bytes.Repeat([]byte{7}, 32)
	cfg := Config{MaxUploadBytes: 1 << 20, MaxDurationSeconds: 3000, AllowedFormats: []string{"wav", "mp3"}}
	return New(cfg, st, key, dir, nil), st, dir
}

func sha256hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func TestResumableUploadLifecycle(t *testing.T) {
	svc, st, dir := newService(t)
	ctx := context.Background()

	plain := bytes.Repeat([]byte("audio-data-"), 5000)
	up, err := svc.Start(ctx, Meta{Filename: "gravacao.wav", ContentType: "audio/wav", SizeBytes: int64(len(plain)), SHA256: sha256hex(plain)})
	if err != nil {
		t.Fatalf("start: %v", err)
	}

	// Wrong offset must be rejected with 409.
	_, err = svc.Append(ctx, up.ID, 10, bytes.NewReader(plain[:10]))
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Status != 409 {
		t.Fatalf("expected 409 offset error, got %v", err)
	}

	// Append in three resumable parts.
	cuts := []int{0, 1000, 20000, len(plain)}
	offset := int64(0)
	for i := 0; i < len(cuts)-1; i++ {
		newOffset, err := svc.Append(ctx, up.ID, offset, bytes.NewReader(plain[cuts[i]:cuts[i+1]]))
		if err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
		offset = newOffset
	}
	if offset != int64(len(plain)) {
		t.Fatalf("offset = %d, want %d", offset, len(plain))
	}

	// Resume view reflects the confirmed offset.
	got, err := svc.Get(ctx, up.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ReceivedBytes != int64(len(plain)) {
		t.Fatalf("received = %d", got.ReceivedBytes)
	}

	// No plaintext on disk.
	onDisk, err := os.ReadFile(filepath.Join(dir, up.StorageKey))
	if err != nil {
		t.Fatalf("read object: %v", err)
	}
	if bytes.Contains(onDisk, plain[:64]) {
		t.Fatal("plaintext found in stored object")
	}

	entry, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if entry.Status != store.EntryStored || entry.SHA256 != sha256hex(plain) {
		t.Fatalf("unexpected entry: %+v", entry)
	}
	att, err := st.GetAttachmentByKind(ctx, entry.ID, store.AttachmentOriginal)
	if err != nil {
		t.Fatalf("attachment: %v", err)
	}
	if att.StorageKey != up.StorageKey {
		t.Fatalf("attachment key = %s, want %s", att.StorageKey, up.StorageKey)
	}
}

func TestCompleteIntegrityFailure(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()

	plain := []byte("conteudo real do audio")
	// Declare a sha256 that does not match the uploaded bytes.
	bogus := sha256hex([]byte("outro conteudo qualquer"))
	up, err := svc.Start(ctx, Meta{Filename: "a.wav", SizeBytes: int64(len(plain)), SHA256: bogus})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	_, err = svc.Complete(ctx, up.ID)
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Status != 422 {
		t.Fatalf("expected 422 integrity error, got %v", err)
	}
}

func TestStartRejectsUnsupportedFormat(t *testing.T) {
	svc, _, _ := newService(t)
	_, err := svc.Start(context.Background(), Meta{Filename: "nota.txt", SizeBytes: 10, SHA256: sha256hex([]byte("x"))})
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Code != "unsupported_format" {
		t.Fatalf("expected unsupported_format, got %v", err)
	}
}

func TestStartWithoutSHA256(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()

	plain := []byte("sem hash informado")
	up, err := svc.Start(ctx, Meta{Filename: "nota.wav", SizeBytes: int64(len(plain))})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	entry, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	// Sem sha informado, o servidor grava o hash recomputado.
	if entry.SHA256 != sha256hex(plain) {
		t.Fatalf("sha256 = %s, want %s", entry.SHA256, sha256hex(plain))
	}
}

func TestStartIdempotentByClientKey(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()

	meta := Meta{Filename: "a.wav", SizeBytes: 10, ClientKey: "ck_1"}
	first, err := svc.Start(ctx, meta)
	if err != nil {
		t.Fatalf("start 1: %v", err)
	}
	second, err := svc.Start(ctx, meta)
	if err != nil {
		t.Fatalf("start 2: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("idempotencia falhou: %s != %s", first.ID, second.ID)
	}
}

func TestCompleteAppliesClientMetadata(t *testing.T) {
	svc, st, _ := newService(t)
	ctx := context.Background()

	plain := []byte("nota com metadados do cliente")
	recorded := time.Date(2026, 10, 10, 21, 5, 0, 0, time.UTC)
	up, err := svc.Start(ctx, Meta{
		Filename:   "a.wav",
		SizeBytes:  int64(len(plain)),
		Title:      "10/10/2026 18:05",
		RecordedAt: &recorded,
		ClientKey:  "ck_2",
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	entry, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if entry.Title != "10/10/2026 18:05" {
		t.Fatalf("title = %q", entry.Title)
	}
	if entry.RecordedAt == nil || !entry.RecordedAt.Equal(recorded) {
		t.Fatalf("recorded_at = %v", entry.RecordedAt)
	}
	// Confirma a persistencia.
	stored, err := st.GetEntry(ctx, entry.ID)
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if stored.Title != "10/10/2026 18:05" {
		t.Fatalf("title persistido = %q", stored.Title)
	}
	if stored.RecordedAt == nil || !stored.RecordedAt.Equal(recorded) {
		t.Fatalf("recorded_at persistido = %v", stored.RecordedAt)
	}
}
