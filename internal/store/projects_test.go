package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func listMCPEntries(t *testing.T, s *Store) []Entry {
	t.Helper()
	entries, err := s.ListEntriesFilteredNotebook(context.Background(), 100, 0, "", "", "", nil, MCPNotebookID)
	if err != nil {
		t.Fatalf("list mcp entries: %v", err)
	}
	return entries
}

func TestEnsureProjectEntryIsOnePerPathAndMachine(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	notebook, err := s.EnsureMCPNotebook(ctx)
	if err != nil {
		t.Fatalf("ensure mcp notebook: %v", err)
	}

	first, err := s.EnsureProjectEntry(ctx, notebook.ID, "/home/joseti/projects/dyarium", "alpha")
	if err != nil {
		t.Fatalf("ensure project entry: %v", err)
	}
	if first.Title != "/home/joseti/projects/dyarium" {
		t.Fatalf("title = %q, want the absolute path", first.Title)
	}
	if first.OriginInstance != "alpha" || first.OriginKind != OriginKindMCP {
		t.Fatalf("origin = %s/%s, want alpha/%s", first.OriginInstance, first.OriginKind, OriginKindMCP)
	}
	if first.NotebookID != MCPNotebookID {
		t.Fatalf("notebook = %q, want %q", first.NotebookID, MCPNotebookID)
	}

	again, err := s.EnsureProjectEntry(ctx, notebook.ID, "/home/joseti/projects/dyarium", "alpha")
	if err != nil {
		t.Fatalf("ensure project entry again: %v", err)
	}
	if again.ID != first.ID {
		t.Fatalf("second call created %s, want the existing %s", again.ID, first.ID)
	}

	// The path comparison folds case; the machine comparison does not.
	folded, err := s.EnsureProjectEntry(ctx, notebook.ID, "/home/joseti/projects/Dyarium", "alpha")
	if err != nil {
		t.Fatalf("ensure folded project entry: %v", err)
	}
	if folded.ID != first.ID {
		t.Fatalf("case-different path created %s, want the existing %s", folded.ID, first.ID)
	}

	otherMachine, err := s.EnsureProjectEntry(ctx, notebook.ID, "/home/joseti/projects/dyarium", "beta")
	if err != nil {
		t.Fatalf("ensure entry on other machine: %v", err)
	}
	if otherMachine.ID == first.ID {
		t.Fatal("two machines with the same path must not share an entry")
	}

	caseMachine, err := s.EnsureProjectEntry(ctx, notebook.ID, "/home/joseti/projects/dyarium", "Alpha")
	if err != nil {
		t.Fatalf("ensure entry on case-different machine: %v", err)
	}
	if caseMachine.ID == first.ID {
		t.Fatal("machine must be compared exactly, not case-insensitively")
	}

	if entries := listMCPEntries(t, s); len(entries) != 3 {
		t.Fatalf("project entries = %d, want 3: %+v", len(entries), entries)
	}
}

func TestEnsureProjectEntryAcceptsEmptyMachine(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	notebook, err := s.EnsureMCPNotebook(ctx)
	if err != nil {
		t.Fatalf("ensure mcp notebook: %v", err)
	}
	first, err := s.EnsureProjectEntry(ctx, notebook.ID, "/tmp/sem-host", "")
	if err != nil {
		t.Fatalf("ensure project entry without machine: %v", err)
	}
	if first.OriginInstance != "" {
		t.Fatalf("origin_instance = %q, want empty", first.OriginInstance)
	}
	again, err := s.EnsureProjectEntry(ctx, notebook.ID, "/tmp/sem-host", "")
	if err != nil {
		t.Fatalf("ensure again: %v", err)
	}
	if again.ID != first.ID {
		t.Fatal("an empty machine must still find the same entry")
	}
	if entries := listMCPEntries(t, s); len(entries) != 1 {
		t.Fatalf("project entries = %d, want 1", len(entries))
	}
}

func TestTouchNoteMovesUpdatedAtOnly(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	notebook, err := s.EnsureMCPNotebook(ctx)
	if err != nil {
		t.Fatalf("ensure mcp notebook: %v", err)
	}
	entry, err := s.EnsureProjectEntry(ctx, notebook.ID, "/tmp/touch", "alpha")
	if err != nil {
		t.Fatalf("ensure project entry: %v", err)
	}
	note := Note{
		ID:              "nota-touch",
		EntryID:         entry.ID,
		Title:           "sessao",
		ContentMarkdown: "corpo da nota",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.CreateNote(ctx, note); err != nil {
		t.Fatalf("create note: %v", err)
	}
	// Volta o relogio da nota para que o toque seja observavel mesmo com a
	// resolucao de segundos do banco.
	if _, err := s.DB().ExecContext(ctx,
		`UPDATE notes SET updated_at = ? WHERE id = ?`, "2020-01-01T00:00:00Z", note.ID); err != nil {
		t.Fatalf("backdate note: %v", err)
	}
	before, err := s.GetNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("get note: %v", err)
	}
	entryBefore, err := s.GetEntry(ctx, entry.ID)
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}

	if err := s.TouchNote(ctx, note.ID); err != nil {
		t.Fatalf("touch note: %v", err)
	}

	after, err := s.GetNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("get note after touch: %v", err)
	}
	if !after.UpdatedAt.After(before.UpdatedAt) {
		t.Fatalf("updated_at = %v, want after %v", after.UpdatedAt, before.UpdatedAt)
	}
	if after.BodyVersion != before.BodyVersion {
		t.Fatalf("body version = %q, want unchanged %q", after.BodyVersion, before.BodyVersion)
	}
	if after.ContentMarkdown != before.ContentMarkdown || after.Title != before.Title {
		t.Fatalf("touch changed the content: %+v", after)
	}
	entryAfter, err := s.GetEntry(ctx, entry.ID)
	if err != nil {
		t.Fatalf("get entry after touch: %v", err)
	}
	if !entryAfter.UpdatedAt.Equal(entryBefore.UpdatedAt) {
		t.Fatalf("touch moved the entry: %v -> %v", entryBefore.UpdatedAt, entryAfter.UpdatedAt)
	}

	if err := s.TouchNote(ctx, "nao-existe"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing note err = %v, want ErrNotFound", err)
	}
}

func TestFindSessionNoteByMarker(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	notebook, err := s.EnsureMCPNotebook(ctx)
	if err != nil {
		t.Fatalf("ensure mcp notebook: %v", err)
	}
	entry, err := s.EnsureProjectEntry(ctx, notebook.ID, "/tmp/marcador", "alpha")
	if err != nil {
		t.Fatalf("ensure project entry: %v", err)
	}
	body := "## 2026-11-14 09:12 · alpha\n\n```dyarium-json\n{\"v\":2}\n```\n\n<!-- mcp:s:ses_abc -->"
	note := Note{
		ID:              "nota-marcador",
		EntryID:         entry.ID,
		Title:           "sessao",
		ContentMarkdown: body,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.CreateNote(ctx, note); err != nil {
		t.Fatalf("create note: %v", err)
	}

	found, ok, err := s.FindSessionNote(ctx, notebook.ID, "ses_abc")
	if err != nil || !ok {
		t.Fatalf("find session note: ok=%v err=%v", ok, err)
	}
	if found.ID != note.ID {
		t.Fatalf("found note %q, want %q", found.ID, note.ID)
	}

	// O marcador e uma comparacao literal: "_" nao pode funcionar como curinga.
	for _, session := range []string{"ses_ab", "sesXabc", "ses_abcd", "outra", ""} {
		if _, ok, err := s.FindSessionNote(ctx, notebook.ID, session); err != nil || ok {
			t.Fatalf("session %q: ok=%v err=%v, want not found", session, ok, err)
		}
	}

	// Fora do caderno do MCP nao ha sessao.
	elsewhere := Entry{
		ID: "entrada-comum", Title: "Comum", NotebookID: DefaultNotebookID,
		Status: EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now,
	}
	if err := s.CreateEntry(ctx, elsewhere); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := s.CreateNote(ctx, Note{
		ID: "nota-comum", EntryID: elsewhere.ID, Title: "comum",
		ContentMarkdown: body, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note in default notebook: %v", err)
	}
	found, ok, err = s.FindSessionNote(ctx, notebook.ID, "ses_abc")
	if err != nil || !ok || found.ID != note.ID {
		t.Fatalf("lookup leaked out of the mcp notebook: ok=%v err=%v found=%+v", ok, err, found)
	}
}

func TestUpdateNoteTitleKeepsBodyVersion(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	notebook, err := s.EnsureMCPNotebook(ctx)
	if err != nil {
		t.Fatalf("ensure mcp notebook: %v", err)
	}
	entry, err := s.EnsureProjectEntry(ctx, notebook.ID, "/tmp/titulo", "alpha")
	if err != nil {
		t.Fatalf("ensure project entry: %v", err)
	}
	note := Note{
		ID: "nota-titulo", EntryID: entry.ID, Title: "antes",
		ContentMarkdown: "corpo", CreatedAt: now, UpdatedAt: now,
	}
	if err := s.CreateNote(ctx, note); err != nil {
		t.Fatalf("create note: %v", err)
	}
	before, err := s.GetNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("get note: %v", err)
	}

	if err := s.UpdateNoteTitle(ctx, note.ID, "depois"); err != nil {
		t.Fatalf("update note title: %v", err)
	}
	after, err := s.GetNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("get note after title: %v", err)
	}
	if after.Title != "depois" {
		t.Fatalf("title = %q, want depois", after.Title)
	}
	if after.BodyVersion != before.BodyVersion || after.ContentMarkdown != before.ContentMarkdown {
		t.Fatalf("title update touched the body: %+v", after)
	}

	if err := s.UpdateNoteTitle(ctx, "nao-existe", "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing note err = %v, want ErrNotFound", err)
	}
}
