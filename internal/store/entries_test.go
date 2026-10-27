package store

import (
	"context"
	"testing"
	"time"
)

func TestUpdateEntryStatusKeepsUpdatedAt(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	old := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	if err := s.CreateEntry(ctx, Entry{
		ID:        "e_status",
		Title:     "nota",
		Status:    EntryReady,
		Source:    "text",
		CreatedAt: old,
		UpdatedAt: old,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}

	if err := s.UpdateEntryStatus(ctx, "e_status", EntryTranscribed); err != nil {
		t.Fatalf("update status: %v", err)
	}

	entry, err := s.GetEntry(ctx, "e_status")
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if entry.Status != EntryTranscribed {
		t.Fatalf("status = %q, want %q", entry.Status, EntryTranscribed)
	}
	if !entry.UpdatedAt.Equal(old) {
		t.Fatalf("updated_at = %v, want %v: concluir transcricao nao e edicao", entry.UpdatedAt, old)
	}
}
