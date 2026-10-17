package main

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

func TestExtractText(t *testing.T) {
	doc := `[{"type":"paragraph","content":[{"type":"text","text":"primeira linha"}]},` +
		`{"type":"paragraph","content":[{"type":"text","text":"segunda linha"}]}]`
	if got := extractText(doc); got != "primeira linha segunda linha" {
		t.Fatalf("extractText = %q", got)
	}
	if got := extractText("nao e json"); got != "" {
		t.Fatalf("esperava vazio para entrada invalida, got %q", got)
	}
	if got := extractText(`[{"type":"paragraph","content":[]}]`); got != "" {
		t.Fatalf("esperava vazio para documento sem texto, got %q", got)
	}
}

func TestMarkdownToPlain(t *testing.T) {
	markdown := "# Titulo\n\n" +
		"Um **dia** bom, com [link](attachment:x) e uma imagem ![foto](attachment:y).\n\n" +
		"- item um\n- item dois\n\n" +
		"> citacao\n\n" +
		"```go\nfunc main() {}\n```\n\n" +
		"| a | b |\n| - | - |\n\n" +
		"Veja [outra nota](note:abc).\n"
	want := "Titulo Um dia bom, com link e uma imagem foto. item um item dois citacao Veja ."
	if got := markdownToPlain(markdown); got != want {
		t.Fatalf("markdownToPlain =\n%q\nwant\n%q", got, want)
	}
}

// A analise de uma nota escrita le o markdown (o corpo canonico), nao o JSON
// legado do BlockNote — que deixou de ser gravado na rodada do markdown.
func TestAnalysisInputReadsWrittenMarkdown(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := id.New()
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "escrita", Status: store.EntryReady, Source: "text",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateNote(ctx, store.Note{
		ID: id.New(), EntryID: entryID,
		ContentMarkdown: "## Primeiro\n\nO **texto** escrito.",
		Document:        `[{"type":"paragraph","content":[{"type":"text","text":"lixo legado"}]}]`,
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	segments, language, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	if len(segments) != 1 || segments[0].Text != "Primeiro O texto escrito." {
		t.Fatalf("segments = %v", segments)
	}
	if language != "" {
		t.Fatalf("language = %q, want vazio", language)
	}
}

// Nota antiga, ainda sem markdown (nunca reescrita depois da migracao): a
// analise continua lendo o documento legado, em vez de dizer que nao ha texto.
func TestAnalysisInputFallsBackToLegacyDocument(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := id.New()
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "antiga", Status: store.EntryReady, Source: "upload",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateNote(ctx, store.Note{
		ID: id.New(), EntryID: entryID,
		Document:  `[{"type":"paragraph","content":[{"type":"text","text":"texto antigo"}]}]`,
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	segments, _, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	if len(segments) != 1 || segments[0].Text != "texto antigo" {
		t.Fatalf("segments = %v", segments)
	}
}

func openWriterStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return st
}
