package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMigrateAndSettings(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "diary.db")

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// Running migrations again must be a no-op.
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate again: %v", err)
	}

	// The initial migration must have created the expected tables.
	for _, table := range []string{"entries", "jobs", "uploads", "settings", "segments"} {
		var name string
		err := s.DB().QueryRowContext(ctx,
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&name)
		if err != nil {
			t.Fatalf("expected table %q: %v", table, err)
		}
	}

	if err := s.SetSetting(ctx, "trim_silence", "false"); err != nil {
		t.Fatalf("set setting: %v", err)
	}
	if err := s.SetSetting(ctx, "trim_silence", "true"); err != nil {
		t.Fatalf("update setting: %v", err)
	}
	value, ok, err := s.GetSetting(ctx, "trim_silence")
	if err != nil {
		t.Fatalf("get setting: %v", err)
	}
	if !ok || value != "true" {
		t.Fatalf("got %q ok=%v, want true", value, ok)
	}
}
