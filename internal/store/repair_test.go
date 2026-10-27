package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// Um job de transcricao que falha depois de o aparelho enviar o texto deixava a
// nota como "failed". O reparo so toca nas transcricoes locais: a falha da
// analise continua visivel no painel.
func TestRepairDeviceTranscripts(t *testing.T) {
	ctx := context.Background()
	s, err := Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	now := time.Now().UTC()
	mk := func(id string) {
		if err := s.CreateEntry(ctx, Entry{
			ID: id, Title: id, Status: EntryFailed, Source: "audio",
			CreatedAt: now, UpdatedAt: now,
		}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}
	mk("local")
	mk("server")
	for _, tc := range []struct{ entry, model string }{
		{"local", "local"},
		{"server", "whisper"},
	} {
		if err := s.SaveTranscript(ctx, Transcript{
			ID: "tr_" + tc.entry, EntryID: tc.entry, Model: tc.model,
			Text: "texto salvo", CreatedAt: now,
		}, nil); err != nil {
			t.Fatalf("transcript %s: %v", tc.entry, err)
		}
	}

	fixed, err := s.RepairDeviceTranscripts(ctx)
	if err != nil {
		t.Fatalf("repair: %v", err)
	}
	if fixed != 1 {
		t.Fatalf("reparadas = %d, want 1", fixed)
	}
	for id, want := range map[string]string{"local": EntryTranscribed, "server": EntryFailed} {
		entry, err := s.GetEntry(ctx, id)
		if err != nil {
			t.Fatalf("get %s: %v", id, err)
		}
		if entry.Status != want {
			t.Fatalf("%s: status = %q, want %q", id, entry.Status, want)
		}
	}
	if again, err := s.RepairDeviceTranscripts(ctx); err != nil || again != 0 {
		t.Fatalf("segundo reparo = %d, %v (idempotente)", again, err)
	}
}
