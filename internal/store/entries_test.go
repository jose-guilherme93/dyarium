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

// A origem e gravada na criacao: sem valor explicito, o criador e este
// ambiente; com valor, fica o de quem pediu (o aparelho).
func TestCreateEntryRecordsOrigin(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	s.SetClockNode("instancia-local")
	now := time.Now().UTC()

	if err := s.CreateEntry(ctx, Entry{
		ID: "e_local", Title: "local", Status: EntryReady, Source: "text",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	local, err := s.GetEntry(ctx, "e_local")
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if local.OriginKind != OriginKindServer || local.OriginInstance != "instancia-local" {
		t.Fatalf("origem local = %q/%q", local.OriginInstance, local.OriginKind)
	}

	if err := s.CreateEntry(ctx, Entry{
		ID: "e_remota", Title: "remota", Status: EntryReady, Source: "text",
		CreatedAt: now, UpdatedAt: now,
		OriginInstance: "dev_01J8Z", OriginKind: OriginKindDevice,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	remote, err := s.GetEntry(ctx, "e_remota")
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if remote.OriginKind != OriginKindDevice || remote.OriginInstance != "dev_01J8Z" {
		t.Fatalf("origem remota = %q/%q", remote.OriginInstance, remote.OriginKind)
	}
}
