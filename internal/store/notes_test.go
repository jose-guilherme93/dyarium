package store

import (
	"context"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/id"
)

// Depois da primeira gravacao em markdown, o JSON legado do BlockNote sai da
// nota: ele era so fallback de nota ainda nao convertida, e mante-lo faria o
// texto antigo voltar quando o corpo fosse esvaziado (a analise e o dashboard
// caem nele quando o markdown esta vazio). A versao anterior fica na revisao.
func TestUpdateNoteBodyDropsLegacyDocument(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	const entryID = "note_01J8Z0000000000000000000K"
	seedEntry(t, s, entryID, time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC))

	noteID := id.New()
	now := time.Now().UTC()
	if err := s.CreateNote(ctx, Note{
		ID: noteID, EntryID: entryID,
		Document:  `[{"type":"paragraph","content":[{"type":"text","text":"corpo antigo"}]}]`,
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	// Nota anterior a 0011: a coluna do markdown nasceu NULL, e o JSON legado e
	// a unica fonte do corpo.
	if _, err := s.DB().ExecContext(ctx, `UPDATE notes SET content_markdown = NULL WHERE id = ?`, noteID); err != nil {
		t.Fatalf("legacy note setup: %v", err)
	}

	if _, conflict, err := s.UpdateNoteBody(ctx, noteID, "corpo novo", ""); err != nil || conflict {
		t.Fatalf("update note body: err=%v conflict=%v", err, conflict)
	}

	note, err := s.GetNote(ctx, noteID)
	if err != nil {
		t.Fatalf("get note: %v", err)
	}
	if note.ContentMarkdown != "corpo novo" {
		t.Fatalf("content_markdown = %q", note.ContentMarkdown)
	}
	if note.Document != "" {
		t.Fatalf("document deveria ter saido, ficou %q", note.Document)
	}

	revisions, err := s.ListRevisions(ctx, noteID)
	if err != nil {
		t.Fatalf("list revisions: %v", err)
	}
	if len(revisions) != 1 || revisions[0].Document != `[{"type":"paragraph","content":[{"type":"text","text":"corpo antigo"}]}]` {
		t.Fatalf("revisions = %+v", revisions)
	}
}
