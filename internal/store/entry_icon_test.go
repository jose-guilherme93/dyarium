package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestEntryIconRoundTrip(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	n := Notebook{ID: "caderno-icone", Name: "Icones", CreatedAt: now, UpdatedAt: now}
	if err := s.CreateNotebook(ctx, n); err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	entry := Entry{ID: "projeto-icone", Title: "Dyarium", NotebookID: n.ID, Icon: "🌿",
		Status: EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}
	if err := s.CreateEntry(ctx, entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if got, err := s.GetEntry(ctx, entry.ID); err != nil || got.Icon != "🌿" {
		t.Fatalf("icon = %q err=%v, want 🌿", got.Icon, err)
	}

	if _, err := s.UpdateEntryIcon(ctx, entry.ID, "📘"); err != nil {
		t.Fatalf("update icon: %v", err)
	}
	if got, err := s.GetEntry(ctx, entry.ID); err != nil || got.Icon != "📘" {
		t.Fatalf("icon = %q err=%v, want 📘", got.Icon, err)
	}

	// Um patch de outro campo, sem icon, nao pode zerar o icone.
	title := "Dyarium 2"
	if _, _, err := s.UpdateEntryFields(ctx, entry.ID, &title, nil, nil, nil, nil, nil, "", ""); err != nil {
		t.Fatalf("update title: %v", err)
	}
	if got, err := s.GetEntry(ctx, entry.ID); err != nil || got.Icon != "📘" {
		t.Fatalf("icon after title update = %q err=%v, want 📘", got.Icon, err)
	}

	// Caractere de controle e recusado e nao altera o valor gravado.
	if _, err := s.UpdateEntryIcon(ctx, entry.ID, "linha\nquebrada"); !errors.Is(err, ErrInvalidIcon) {
		t.Fatalf("invalid icon err = %v, want ErrInvalidIcon", err)
	}
	if got, err := s.GetEntry(ctx, entry.ID); err != nil || got.Icon != "📘" {
		t.Fatalf("invalid update changed icon to %q err=%v", got.Icon, err)
	}

	// Vazio e valido: o cliente decide o fallback.
	if _, err := s.UpdateEntryIcon(ctx, entry.ID, ""); err != nil {
		t.Fatalf("clear icon: %v", err)
	}
	if got, err := s.GetEntry(ctx, entry.ID); err != nil || got.Icon != "" {
		t.Fatalf("icon = %q err=%v, want empty", got.Icon, err)
	}

	if _, err := s.UpdateEntryIcon(ctx, "nao-existe", "🌿"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing entry err = %v, want ErrNotFound", err)
	}
}

func TestMigrationEntryIconDefaultsToEmpty(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	rows, err := s.DB().QueryContext(ctx, `PRAGMA table_info(entries)`)
	if err != nil {
		t.Fatalf("table info: %v", err)
	}
	defer rows.Close()
	var found bool
	for rows.Next() {
		var cid int
		var name, kind string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &pk); err != nil {
			t.Fatalf("scan table info: %v", err)
		}
		if name != "icon" {
			continue
		}
		found = true
		if notNull != 1 {
			t.Fatalf("entries.icon notnull = %d, want 1", notNull)
		}
		if value, _ := defaultValue.(string); value != "''" {
			t.Fatalf("entries.icon default = %v, want ''", defaultValue)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("table info rows: %v", err)
	}
	if !found {
		t.Fatal("entries.icon is missing")
	}

	// Uma linha que nao menciona a coluna, como uma entrada antiga, recebe o
	// padrao da migration.
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.DB().ExecContext(ctx, `
		INSERT INTO entries (id, title, status, source, created_at, updated_at)
		VALUES ('e_legacy_icon', 'antiga', 'ready', 'text', ?, ?)`, now, now); err != nil {
		t.Fatalf("insert legacy entry: %v", err)
	}
	got, err := s.GetEntry(ctx, "e_legacy_icon")
	if err != nil {
		t.Fatalf("get legacy entry: %v", err)
	}
	if got.Icon != "" {
		t.Fatalf("legacy icon = %q, want empty", got.Icon)
	}
}
