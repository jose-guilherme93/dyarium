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

	"github.com/joseti/dyarium/internal/store"
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

// A hora de criacao/importacao e a origem viajam com o upload e ficam
// imutaveis na entrada; editar titulo depois nao as altera.
func TestCompletePreservesEntryCreatedAtAndSource(t *testing.T) {
	svc, st, _ := newService(t)
	ctx := context.Background()
	plain := bytes.Repeat([]byte("audio-data-"), 100)
	created := time.Date(2023, 10, 19, 13, 30, 0, 0, time.UTC)

	up, err := svc.Start(ctx, Meta{
		Filename:    "antigo.wav",
		ContentType: "audio/wav",
		SizeBytes:   int64(len(plain)),
		SHA256:      sha256hex(plain),
		Title:       "Nota antiga",
		RecordedAt:  &created,
		CreatedAt:   &created,
		Source:      "share",
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	storedUpload, err := svc.Get(ctx, up.ID)
	if err != nil {
		t.Fatalf("get upload: %v", err)
	}
	if storedUpload.EntryCreatedAt == nil || !storedUpload.EntryCreatedAt.Equal(created) {
		t.Fatalf("entry_created_at = %v, want %v", storedUpload.EntryCreatedAt, created)
	}
	if storedUpload.EntrySource != "share" {
		t.Fatalf("entry_source = %q, want share", storedUpload.EntrySource)
	}

	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	result, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if !result.Entry.CreatedAt.Equal(created) {
		t.Fatalf("entry.created_at = %v, want %v", result.Entry.CreatedAt, created)
	}
	if result.Entry.Source != "share" {
		t.Fatalf("entry.source = %q, want share", result.Entry.Source)
	}

	newTitle := "titulo editado"
	if _, conflict, err := st.UpdateEntryFields(ctx, result.Entry.ID, &newTitle, nil, nil, nil, nil, "", ""); err != nil {
		t.Fatalf("update: %v", err)
	} else if len(conflict) > 0 {
		t.Fatalf("update conflict: %v", conflict)
	}
	after, err := st.GetEntry(ctx, result.Entry.ID)
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if !after.CreatedAt.Equal(created) || after.Source != "share" {
		t.Fatalf("created_at/origem mudaram: %+v", after)
	}
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

	result, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	entry := result.Entry
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
	result, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	entry := result.Entry
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
		Author:     "other",
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	result, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	entry := result.Entry
	if entry.Title != "10/10/2026 18:05" {
		t.Fatalf("title = %q", entry.Title)
	}
	if entry.RecordedAt == nil || !entry.RecordedAt.Equal(recorded) {
		t.Fatalf("recorded_at = %v", entry.RecordedAt)
	}
	if entry.Author != "other" {
		t.Fatalf("author = %q", entry.Author)
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
	if stored.Author != "other" {
		t.Fatalf("author persistido = %q", stored.Author)
	}
}

func TestCompleteDefaultsAudioTitle(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()

	plain := []byte("audio sem titulo")
	up, err := svc.Start(ctx, Meta{Filename: "a.wav", SizeBytes: int64(len(plain))})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	result, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	entry := result.Entry
	if entry.Title != "Audio" {
		t.Fatalf("title = %q, want \"Audio\"", entry.Title)
	}
}

func TestCompleteAddsAudioToExistingEntry(t *testing.T) {
	svc, st, _ := newService(t)
	ctx := context.Background()
	now := time.Now().UTC()
	entry := store.Entry{ID: "en1", Title: "nota escrita", Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}
	if err := st.CreateEntry(ctx, entry); err != nil {
		t.Fatalf("entry: %v", err)
	}

	plain := []byte("audio novo")
	up, err := svc.Start(ctx, Meta{Filename: "a.wav", ContentType: "audio/wav", SizeBytes: int64(len(plain)), EntryID: "en1"})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	result, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if result.Created {
		t.Fatal("nao deveria criar entrada nova")
	}
	if result.Entry.ID != "en1" {
		t.Fatalf("entry = %s, want en1", result.Entry.ID)
	}
	audios, err := st.ListAudios(ctx, "en1")
	if err != nil || len(audios) != 1 {
		t.Fatalf("audios = %d (%v)", len(audios), err)
	}
	if audios[0].ID != result.Attachment.ID {
		t.Fatalf("audio = %s, want %s", audios[0].ID, result.Attachment.ID)
	}
	if audios[0].ContentType != "audio/wav" {
		t.Fatalf("content_type do audio = %q", audios[0].ContentType)
	}
	got, err := st.GetEntry(ctx, "en1")
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if got.ContentType != "audio/wav" {
		t.Fatalf("content_type da nota = %q, deveria ter sido preenchido", got.ContentType)
	}
}

func TestStartRejectsInvalidEntryID(t *testing.T) {
	svc, _, _ := newService(t)
	_, err := svc.Start(context.Background(), Meta{Filename: "a.wav", SizeBytes: 10, EntryID: "id invalido"})
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Status != 400 {
		t.Fatalf("expected 400 para entry_id invalido, got %v", err)
	}
}

// O app cria a nota offline com o id dele e manda esse id no proprio upload: a
// entrada nasce com esse mesmo id, sem nenhuma requisicao a mais.
func TestCompleteCreatesEntryWithClientID(t *testing.T) {
	svc, st, _ := newService(t)
	ctx := context.Background()
	const clientID = "note_01J8Z0000000000000000000D"

	result := uploadAudio(t, svc, []byte("conteudo de audio"), "ck-novo", clientID)
	if result.Entry.ID != clientID {
		t.Fatalf("entry_id = %q, want %s", result.Entry.ID, clientID)
	}
	if !result.Created {
		t.Fatal("a entrada deveria ter sido criada no complete")
	}
	if _, err := st.GetEntry(ctx, clientID); err != nil {
		t.Fatalf("a entrada com o id do cliente nao existe: %v", err)
	}
}

func uploadAudio(t *testing.T, svc *Service, plain []byte, clientKey, entryID string) CompleteResult {
	t.Helper()
	ctx := context.Background()
	up, err := svc.Start(ctx, Meta{
		Filename:    "a.wav",
		ContentType: "audio/wav",
		SizeBytes:   int64(len(plain)),
		ClientKey:   clientKey,
		EntryID:     entryID,
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}
	result, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	return result
}

// Repetir o complete (resposta 201 perdida) devolve o mesmo audio e a mesma
// nota, sem refazer o trabalho. Era o bug que deixava o audio orfao no app.
func TestCompleteIsIdempotent(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()

	plain := []byte("audio reenviado apos perder a resposta")
	up, err := svc.Start(ctx, Meta{Filename: "a.wav", ContentType: "audio/wav", SizeBytes: int64(len(plain)), ClientKey: "ck_retry"})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := svc.Append(ctx, up.ID, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}

	first, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete 1: %v", err)
	}
	if first.Repeated || !first.Created {
		t.Fatalf("primeiro complete: %+v", first)
	}

	second, err := svc.Complete(ctx, up.ID)
	if err != nil {
		t.Fatalf("complete 2: %v", err)
	}
	if !second.Repeated {
		t.Fatal("segundo complete deveria ser repeticao")
	}
	if second.Entry.ID != first.Entry.ID || second.Attachment.ID != first.Attachment.ID {
		t.Fatalf("resultado divergente: %+v != %+v", second, first)
	}
}

// O mesmo audio enviado por uploads diferentes vira o MESMO audio (mesma nota),
// gracas a identidade por conteudo.
func TestCompleteDeduplicatesSameAudioContent(t *testing.T) {
	svc, st, _ := newService(t)
	plain := []byte("a mesma gravacao enviada duas vezes")

	first := uploadAudio(t, svc, plain, "ck_a", "")
	if first.Repeated || !first.Created {
		t.Fatalf("primeiro upload: %+v", first)
	}

	second := uploadAudio(t, svc, plain, "ck_b", "")
	if !second.Repeated {
		t.Fatal("segundo upload do mesmo audio deveria ser repeticao")
	}
	if second.Entry.ID != first.Entry.ID || second.Attachment.ID != first.Attachment.ID {
		t.Fatal("mesmo audio virou notas diferentes")
	}
	audios, err := st.ListAudios(context.Background(), first.Entry.ID)
	if err != nil || len(audios) != 1 {
		t.Fatalf("audios = %d (%v), want 1", len(audios), err)
	}
}

func TestCompleteKeepsDifferentAudioSeparate(t *testing.T) {
	svc, _, _ := newService(t)
	first := uploadAudio(t, svc, []byte("primeira gravacao"), "ck_1", "")
	second := uploadAudio(t, svc, []byte("segunda gravacao"), "ck_2", "")
	if first.Entry.ID == second.Entry.ID {
		t.Fatal("audios diferentes viraram a mesma nota")
	}
}
