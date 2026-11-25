package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestEntrySummaryDetailValidation(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	n := Notebook{ID: "caderno-projeto", Name: "Projeto", CreatedAt: now, UpdatedAt: now}
	if err := s.CreateNotebook(ctx, n); err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	entry := Entry{ID: "projeto-dyarium", Title: "Dyarium", NotebookID: n.ID,
		Status: EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}
	if err := s.CreateEntry(ctx, entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if got, err := s.GetEntry(ctx, entry.ID); err != nil || got.SummaryDetail != SummaryDetailConcise {
		t.Fatalf("default summary_detail = %q err=%v, want concise", got.SummaryDetail, err)
	}

	if _, err := s.UpdateEntrySummaryDetail(ctx, entry.ID, SummaryDetailFull); err != nil {
		t.Fatalf("update to full: %v", err)
	}
	if got, err := s.GetEntry(ctx, entry.ID); err != nil || got.SummaryDetail != SummaryDetailFull {
		t.Fatalf("summary_detail = %q err=%v, want full", got.SummaryDetail, err)
	}

	if _, err := s.UpdateEntrySummaryDetail(ctx, entry.ID, "verboso"); !errors.Is(err, ErrInvalidSummaryDetail) {
		t.Fatalf("invalid update err = %v, want ErrInvalidSummaryDetail", err)
	}
	if got, err := s.GetEntry(ctx, entry.ID); err != nil || got.SummaryDetail != SummaryDetailFull {
		t.Fatalf("invalid update changed value: %q err=%v", got.SummaryDetail, err)
	}

	if _, err := s.UpdateEntrySummaryDetail(ctx, "nao-existe", SummaryDetailFull); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing entry err = %v, want ErrNotFound", err)
	}
}

func TestMCPNotebookIsEnsuredAndProtected(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	notebook, err := s.EnsureMCPNotebook(ctx)
	if err != nil {
		t.Fatalf("ensure mcp notebook: %v", err)
	}
	if notebook.ID != MCPNotebookID || notebook.Name != MCPNotebookName || notebook.Kind != NotebookKindMCP {
		t.Fatalf("mcp notebook = %+v", notebook)
	}
	again, err := s.EnsureMCPNotebook(ctx)
	if err != nil || again.ID != notebook.ID {
		t.Fatalf("second ensure = %+v err=%v", again, err)
	}

	if _, err := s.SetNotebookKind(ctx, MCPNotebookID, NotebookKindNotes, false); !errors.Is(err, ErrProtected) {
		t.Fatalf("kind change err = %v, want ErrProtected", err)
	}
	if err := s.DeleteNotebook(ctx, MCPNotebookID); !errors.Is(err, ErrProtected) {
		t.Fatalf("delete err = %v, want ErrProtected", err)
	}

	// Renomear e recolorir continuam permitidos.
	name := "Projetos do dono"
	if _, err := s.UpdateNotebook(ctx, MCPNotebookID, &name, nil); err != nil {
		t.Fatalf("rename mcp notebook: %v", err)
	}
}

func TestFindEntryByNotebookAndTitle(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	n := Notebook{ID: "caderno-busca", Name: "Busca", CreatedAt: now, UpdatedAt: now}
	if err := s.CreateNotebook(ctx, n); err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	older := Entry{ID: "entrada-velha", Title: "Projeto Alfa", NotebookID: n.ID,
		Status: EntryReady, Source: "text", CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour)}
	newer := Entry{ID: "entrada-nova", Title: "Projeto Alfa", NotebookID: n.ID,
		Status: EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}
	for _, e := range []Entry{older, newer} {
		if err := s.CreateEntry(ctx, e); err != nil {
			t.Fatalf("create entry %s: %v", e.ID, err)
		}
	}
	if err := s.CreateEntry(ctx, Entry{ID: "outro-caderno", Title: "Projeto Alfa",
		NotebookID: DefaultNotebookID, Status: EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create entry in default notebook: %v", err)
	}

	entry, ok, err := s.FindEntryByNotebookAndTitle(ctx, n.ID, "Projeto Alfa")
	if err != nil || !ok {
		t.Fatalf("find entry: ok=%v err=%v", ok, err)
	}
	if entry.ID != newer.ID {
		t.Fatalf("found %s, want the newest %s", entry.ID, newer.ID)
	}

	if _, ok, err := s.FindEntryByNotebookAndTitle(ctx, n.ID, "projeto alfa"); err != nil || ok {
		t.Fatalf("exact lookup must stay case-sensitive: ok=%v err=%v", ok, err)
	}

	folded, ok, err := s.FindEntryByNotebookAndTitleFold(ctx, n.ID, "projeto alfa")
	if err != nil || !ok {
		t.Fatalf("folded find: ok=%v err=%v", ok, err)
	}
	if folded.ID != newer.ID {
		t.Fatalf("folded found %s, want the newest %s", folded.ID, newer.ID)
	}

	if err := s.SoftDeleteEntry(ctx, newer.ID); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	entry, ok, err = s.FindEntryByNotebookAndTitle(ctx, n.ID, "Projeto Alfa")
	if err != nil || !ok {
		t.Fatalf("find after delete: ok=%v err=%v", ok, err)
	}
	if entry.ID != older.ID {
		t.Fatalf("found %s, want the live older entry %s", entry.ID, older.ID)
	}

	if _, ok, err := s.FindEntryByNotebookAndTitle(ctx, n.ID, "nao existe"); err != nil || ok {
		t.Fatalf("missing entry: ok=%v err=%v", ok, err)
	}
}

func TestMigrationMCPProjectsSchema(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	rows, err := s.DB().QueryContext(ctx, `PRAGMA table_info(notebooks)`)
	if err != nil {
		t.Fatalf("table info: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, kind string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &pk); err != nil {
			t.Fatalf("scan table info: %v", err)
		}
		if name == "summary_detail" {
			t.Fatal("notebooks.summary_detail should have been dropped by migration 0040")
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("table info rows: %v", err)
	}

	notebook, err := s.GetNotebook(ctx, MCPNotebookID)
	if err != nil {
		t.Fatalf("mcp notebook: %v", err)
	}
	if notebook.Name != MCPNotebookName || notebook.Kind != NotebookKindMCP {
		t.Fatalf("mcp notebook = %+v", notebook)
	}

	var hasSummaryDetail bool
	entryRows, err := s.DB().QueryContext(ctx, `PRAGMA table_info(entries)`)
	if err != nil {
		t.Fatalf("entries table info: %v", err)
	}
	defer entryRows.Close()
	for entryRows.Next() {
		var cid int
		var name, kind string
		var notNull, pk int
		var defaultValue any
		if err := entryRows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &pk); err != nil {
			t.Fatalf("scan entries table info: %v", err)
		}
		if name == "summary_detail" {
			hasSummaryDetail = true
		}
	}
	if err := entryRows.Err(); err != nil {
		t.Fatalf("entries table info rows: %v", err)
	}
	if !hasSummaryDetail {
		t.Fatal("entries.summary_detail is missing")
	}
}
