package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func createTombstoneTestEntry(t *testing.T, s *Store, id string) {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Second)
	if err := s.CreateEntry(context.Background(), Entry{
		ID:        id,
		Title:     "nota",
		Status:    EntryReady,
		Source:    "text",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
}

func TestTombstoneSurvivesPurge(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTombstoneTestEntry(t, s, "e_tombstone")

	if err := s.SoftDeleteEntryWithOrigin(ctx, "e_tombstone", "aparelho"); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	if err := s.PurgeEntry(ctx, "e_tombstone"); err != nil {
		t.Fatalf("purge: %v", err)
	}

	deleted, err := s.ListDeletedEntries(ctx, 10, 0)
	if err != nil {
		t.Fatalf("list deleted: %v", err)
	}
	if len(deleted) != 1 || deleted[0].ID != "e_tombstone" || deleted[0].DeletedAt == nil {
		t.Fatalf("tombstone perdido apos a purga: %+v", deleted)
	}
	if _, err := s.GetEntry(ctx, "e_tombstone"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("conteudo deveria ter sido purgado, err = %v", err)
	}
}

func TestSoftDeleteIsIdempotent(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTombstoneTestEntry(t, s, "e_idem")

	if err := s.SoftDeleteEntry(ctx, "e_idem"); err != nil {
		t.Fatalf("primeira exclusao: %v", err)
	}
	first, err := s.GetTombstone(ctx, "e_idem", TombstoneEntry)
	if err != nil {
		t.Fatalf("tombstone: %v", err)
	}
	time.Sleep(2 * time.Millisecond)
	if err := s.SoftDeleteEntry(ctx, "e_idem"); err != nil {
		t.Fatalf("segunda exclusao deveria ser idempotente: %v", err)
	}
	second, err := s.GetTombstone(ctx, "e_idem", TombstoneEntry)
	if err != nil {
		t.Fatalf("tombstone: %v", err)
	}
	if second.DeletedAt != first.DeletedAt {
		t.Fatalf("a data da exclusao mudou no retry: %q != %q", second.DeletedAt, first.DeletedAt)
	}
}

func TestCreateEntryClearsOldTombstone(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTombstoneTestEntry(t, s, "e_reborn")
	if err := s.SoftDeleteEntry(ctx, "e_reborn"); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	if err := s.PurgeEntry(ctx, "e_reborn"); err != nil {
		t.Fatalf("purge: %v", err)
	}

	createTombstoneTestEntry(t, s, "e_reborn")
	deleted, err := s.ListDeletedEntries(ctx, 10, 0)
	if err != nil {
		t.Fatalf("list deleted: %v", err)
	}
	if len(deleted) != 0 {
		t.Fatalf("tombstone antigo nao deveria valer depois de recriar: %+v", deleted)
	}
}

func TestRestoreClearsTombstoneEvenWithoutContent(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTombstoneTestEntry(t, s, "e_restore")
	if err := s.SoftDeleteEntry(ctx, "e_restore"); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	if err := s.PurgeEntry(ctx, "e_restore"); err != nil {
		t.Fatalf("purge: %v", err)
	}
	if err := s.RestoreEntry(ctx, "e_restore"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore sem conteudo = %v, esperado ErrNotFound", err)
	}
	if _, err := s.GetTombstone(ctx, "e_restore", TombstoneEntry); !errors.Is(err, ErrNotFound) {
		t.Fatalf("tombstone deveria ter sido removido: %v", err)
	}
}

func TestDeleteNotebookWritesTombstone(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	if err := s.CreateNotebook(ctx, Notebook{
		ID:        "nb_tomb",
		Name:      "caderno",
		IsDefault: false,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	if err := s.DeleteNotebook(ctx, "nb_tomb"); err != nil {
		t.Fatalf("delete notebook: %v", err)
	}
	if _, err := s.GetTombstone(ctx, "nb_tomb", TombstoneNotebook); err != nil {
		t.Fatalf("tombstone do caderno: %v", err)
	}
}
