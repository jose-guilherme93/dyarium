package store

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/id"
)

// O dashboard antigo gravava a imagem como HTML com a URL do anexo e o token da
// API. O reparo devolve a referencia canonica, remove o token e vale para o
// corpo e para as revisoes.
func TestScrubAttachmentTokens(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	entryID := id.New()
	now := time.Now().UTC()
	seedEntry(t, s, entryID, now)

	const attachment = "88966d1ea7bb7e5997f7650d7573ea00"
	legacy := "texto\n\n" +
		`<figure><img src="/api/v1/attachments/` + attachment + `?token=dev-token"><figcaption>1000315674.jpg</figcaption></figure>` +
		"\n\n![outra](/api/v1/attachments/abc123?token=dev-token)"
	noteID := id.New()
	if err := s.CreateNote(ctx, Note{
		ID: noteID, EntryID: entryID, ContentMarkdown: legacy, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	before, err := s.GetNote(ctx, noteID)
	if err != nil {
		t.Fatalf("get note: %v", err)
	}

	// Uma revisao antiga com o mesmo problema.
	revisionID := id.New()
	if _, err := s.DB().ExecContext(ctx,
		`INSERT INTO note_revisions (id, note_id, document, created_at) VALUES (?, ?, ?, ?)`,
		revisionID, noteID, "![x](/api/v1/attachments/def456?token=dev-token)", ts(now)); err != nil {
		t.Fatalf("insert revision: %v", err)
	}

	// Nota ja limpa: nao pode ser tocada.
	cleanID := id.New()
	if err := s.CreateNote(ctx, Note{
		ID: cleanID, EntryID: entryID, ContentMarkdown: "![ok](attachment:aaa)", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create clean note: %v", err)
	}
	cleanBefore, err := s.GetNote(ctx, cleanID)
	if err != nil {
		t.Fatalf("get clean note: %v", err)
	}

	notes, revisions, err := s.ScrubAttachmentTokens(ctx)
	if err != nil {
		t.Fatalf("scrub: %v", err)
	}
	if notes != 1 || revisions != 1 {
		t.Fatalf("notes=%d revisions=%d, want 1/1", notes, revisions)
	}

	after, err := s.GetNote(ctx, noteID)
	if err != nil {
		t.Fatalf("get note: %v", err)
	}
	if strings.Contains(after.ContentMarkdown, "token=") || strings.Contains(after.ContentMarkdown, "<figure") {
		t.Fatalf("corpo nao foi limpo: %q", after.ContentMarkdown)
	}
	if !strings.Contains(after.ContentMarkdown, "![1000315674.jpg](attachment:"+attachment+")") {
		t.Fatalf("imagem nao voltou como attachment: %q", after.ContentMarkdown)
	}
	if !strings.Contains(after.ContentMarkdown, "![outra](attachment:abc123)") {
		t.Fatalf("imagem markdown nao foi normalizada: %q", after.ContentMarkdown)
	}
	if before.BodyUpdatedAt == nil || after.BodyUpdatedAt == nil || !after.BodyUpdatedAt.After(*before.BodyUpdatedAt) {
		t.Fatalf("a versao do corpo deveria subir: before=%v after=%v", before.BodyUpdatedAt, after.BodyUpdatedAt)
	}

	cleanAfter, err := s.GetNote(ctx, cleanID)
	if err != nil {
		t.Fatalf("get clean note: %v", err)
	}
	if cleanAfter.ContentMarkdown != cleanBefore.ContentMarkdown {
		t.Fatalf("nota limpa mudou: %q", cleanAfter.ContentMarkdown)
	}
	if cleanBefore.BodyUpdatedAt == nil || cleanAfter.BodyUpdatedAt == nil || !cleanAfter.BodyUpdatedAt.Equal(*cleanBefore.BodyUpdatedAt) {
		t.Fatalf("versao da nota limpa nao deveria mudar")
	}

	revs, err := s.ListRevisions(ctx, noteID)
	if err != nil {
		t.Fatalf("list revisions: %v", err)
	}
	for _, rev := range revs {
		if strings.Contains(rev.Document, "token=") {
			t.Fatalf("revisao ainda tem token: %q", rev.Document)
		}
	}

	// Idempotente.
	if notes, revisions, err = s.ScrubAttachmentTokens(ctx); err != nil || notes != 0 || revisions != 0 {
		t.Fatalf("segunda passada: notes=%d revisions=%d err=%v", notes, revisions, err)
	}
}
