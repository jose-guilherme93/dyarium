package ingest

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func uploadFixture(t *testing.T, svc *Service, plain []byte, entryID string) string {
	t.Helper()
	ctx := context.Background()
	up, err := svc.Start(ctx, Meta{
		Filename:    "nota.wav",
		ContentType: "audio/wav",
		SizeBytes:   int64(len(plain)),
		SHA256:      sha256hex(plain),
		Title:       "nota",
		EntryID:     entryID,
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	return up.ID
}

func TestCompleteUsesClientAttachmentID(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	plain := bytes.Repeat([]byte("audio-portatil-"), 100)
	uploadID := uploadFixture(t, svc, plain, "note_portatil")

	first, err := svc.CompleteWithAttachmentID(ctx, uploadID, "att_portatil")
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if first.Attachment.ID != "att_portatil" {
		t.Fatalf("attachment id = %q, want att_portatil", first.Attachment.ID)
	}
	if first.Entry.ID != "note_portatil" {
		t.Fatalf("entry id = %q, want note_portatil", first.Entry.ID)
	}
	if first.Attachment.SHA256 != sha256hex(plain) {
		t.Fatalf("sha256 do anexo nao foi gravado: %q", first.Attachment.SHA256)
	}

	repeat, err := svc.CompleteWithAttachmentID(ctx, uploadID, "att_portatil")
	if err != nil {
		t.Fatalf("complete repetido: %v", err)
	}
	if !repeat.Repeated || repeat.Attachment.ID != "att_portatil" {
		t.Fatalf("retry nao devolveu o mesmo anexo: %+v", repeat)
	}
}

func TestCompleteRejectsAttachmentIDWithOtherContent(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	first := bytes.Repeat([]byte("audio-a-"), 100)
	second := bytes.Repeat([]byte("audio-b-"), 100)

	firstUpload := uploadFixture(t, svc, first, "note_a")
	if _, err := svc.CompleteWithAttachmentID(ctx, firstUpload, "att_repetido"); err != nil {
		t.Fatalf("primeiro complete: %v", err)
	}

	secondUpload := uploadFixture(t, svc, second, "note_b")
	_, err := svc.CompleteWithAttachmentID(ctx, secondUpload, "att_repetido")
	var ingestErr *Error
	if !errors.As(err, &ingestErr) || ingestErr.Status != 409 {
		t.Fatalf("segundo complete = %v, esperado 409", err)
	}
}

func TestPutAttachmentWithIDIsIdempotentAndHashes(t *testing.T) {
	svc, st, _ := newService(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if err := st.CreateEntry(ctx, store.Entry{
		ID:        "e_img",
		Title:     "nota",
		Status:    store.EntryReady,
		Source:    "text",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}

	body := bytes.Repeat([]byte("imagem-"), 50)
	first, err := svc.PutAttachmentWithID(ctx, "e_img", "image", "image/png", "att_img", bytes.NewReader(body), 1<<20)
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	if first.ID != "att_img" || first.SHA256 != sha256hex(body) {
		t.Fatalf("anexo inesperado: %+v", first)
	}
	second, err := svc.PutAttachmentWithID(ctx, "e_img", "image", "image/png", "att_img", bytes.NewReader(body), 1<<20)
	if err != nil {
		t.Fatalf("put repetido: %v", err)
	}
	if second.ID != first.ID || second.StorageKey != first.StorageKey {
		t.Fatalf("retry criou outro anexo: %+v", second)
	}
}

func TestPutAttachmentWithIDRejectsOtherEntry(t *testing.T) {
	svc, st, _ := newService(t)
	ctx := context.Background()
	now := time.Now().UTC()
	for _, id := range []string{"e_one", "e_two"} {
		if err := st.CreateEntry(ctx, store.Entry{
			ID:        id,
			Title:     "nota",
			Status:    store.EntryReady,
			Source:    "text",
			CreatedAt: now,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("create entry %s: %v", id, err)
		}
	}
	body := bytes.Repeat([]byte("imagem-"), 50)
	if _, err := svc.PutAttachmentWithID(ctx, "e_one", "image", "image/png", "att_dono", bytes.NewReader(body), 1<<20); err != nil {
		t.Fatalf("put: %v", err)
	}
	_, err := svc.PutAttachmentWithID(ctx, "e_two", "image", "image/png", "att_dono", bytes.NewReader(body), 1<<20)
	var ingestErr *Error
	if !errors.As(err, &ingestErr) || ingestErr.Status != 409 {
		t.Fatalf("id de outra entrada = %v, esperado 409", err)
	}
}
