package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return s
}

func TestDefaultNotebookExistsAndOwnsExistingNotes(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	notebooks, err := s.ListNotebooks(ctx)
	if err != nil {
		t.Fatalf("list notebooks: %v", err)
	}
	if len(notebooks) != 1 || notebooks[0].ID != DefaultNotebookID || !notebooks[0].IsDefault {
		t.Fatalf("caderno padrao = %+v", notebooks)
	}

	now := time.Now().UTC()
	if err := s.CreateEntry(ctx, Entry{ID: "e1", Status: EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	entry, err := s.GetEntry(ctx, "e1")
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if entry.NotebookID != DefaultNotebookID {
		t.Fatalf("notebook_id = %q, want %q", entry.NotebookID, DefaultNotebookID)
	}
}

func TestMigrationBackfillsNotebookAndTagColors(t *testing.T) {
	ctx := context.Background()
	s, err := Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	// Simula um banco antigo: aplica so as migracoes anteriores a 0017.
	if _, err := s.DB().ExecContext(ctx,
		`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		t.Fatalf("schema_migrations: %v", err)
	}
	migrations, err := loadMigrations()
	if err != nil {
		t.Fatalf("load migrations: %v", err)
	}
	for _, m := range migrations {
		if m.version >= 17 {
			break
		}
		if _, err := s.DB().ExecContext(ctx, m.sql); err != nil {
			t.Fatalf("apply %s: %v", m.name, err)
		}
		if _, err := s.DB().ExecContext(ctx,
			`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
			m.version, time.Now().UTC().Format(time.RFC3339)); err != nil {
			t.Fatalf("record %s: %v", m.name, err)
		}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.DB().ExecContext(ctx,
		`INSERT INTO entries (id, status, source, created_at, updated_at) VALUES ('e_old', 'ready', 'text', ?, ?)`,
		now, now); err != nil {
		t.Fatalf("insert old entry: %v", err)
	}
	if _, err := s.DB().ExecContext(ctx,
		`INSERT INTO tags (id, name, color, created_at) VALUES ('t_old', 'viagem', '', ?)`,
		now); err != nil {
		t.Fatalf("insert old tag: %v", err)
	}

	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	entry, err := s.GetEntry(ctx, "e_old")
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if entry.NotebookID != DefaultNotebookID {
		t.Fatalf("notebook_id = %q, want %q", entry.NotebookID, DefaultNotebookID)
	}
	tag, err := s.GetTag(ctx, "t_old")
	if err != nil {
		t.Fatalf("get tag: %v", err)
	}
	if tag.Color != TagColor("viagem") {
		t.Fatalf("cor = %q, want %q", tag.Color, TagColor("viagem"))
	}
}

func TestTagColorIsStableAndNormalized(t *testing.T) {
	a := TagColor("Viagem")
	b := TagColor("  viagem ")
	if a != b {
		t.Fatalf("TagColor nao normaliza: %q != %q", a, b)
	}
	found := false
	for _, color := range TagPalette {
		if color == a {
			found = true
		}
	}
	if !found {
		t.Fatalf("cor %q nao esta na paleta", a)
	}
}

func TestTagColorMatchesAppPalette(t *testing.T) {
	// Valores repetidos em mobile/src/core/__tests__/tags.test.ts: se a paleta
	// ou o hash mudar de um lado, a tag nasce de uma cor e aparece de outra.
	if got := TagColor("familia"); got != "#F2C4C4" {
		t.Fatalf("familia = %q", got)
	}
	if got := TagColor("viagem"); got != "#EFE3A8" {
		t.Fatalf("viagem = %q", got)
	}
}

func TestMigrateBackfillsTagColors(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	if _, err := s.DB().ExecContext(ctx,
		`INSERT INTO tags (id, name, color, created_at) VALUES ('t1', 'sem-cor', '', ?)`,
		time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatalf("insert tag: %v", err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate again: %v", err)
	}
	tag, err := s.GetTag(ctx, "t1")
	if err != nil {
		t.Fatalf("get tag: %v", err)
	}
	if tag.Color != TagColor("sem-cor") {
		t.Fatalf("cor = %q, want %q", tag.Color, TagColor("sem-cor"))
	}
}
