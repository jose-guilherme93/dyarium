package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
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
		"Um **dia** bom, com [link](https://exemplo.com/x) e ![foto](attachment:y).\n\n" +
		"- item um\n- item dois\n\n" +
		"> citacao\n\n" +
		"```go\nfunc main() {}\n```\n\n" +
		"| a | b |\n| - | - |\n\n" +
		"Veja [outra nota](note:abc).\n"
	want := "Titulo Um dia bom, com link (https://exemplo.com/x) e imagem: foto. item um item dois citacao Veja outra nota."
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

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	if len(input.Segments) != 1 || !strings.Contains(input.Segments[0].Text, "Primeiro O texto escrito.") {
		t.Fatalf("segments = %v", input.Segments)
	}
	if input.Language != "" {
		t.Fatalf("language = %q, want vazio", input.Language)
	}
	if input.TextChars == 0 || input.TranscriptChars != 0 {
		t.Fatalf("chars = texto %d, fala %d", input.TextChars, input.TranscriptChars)
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

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	if len(input.Segments) != 1 || !strings.Contains(input.Segments[0].Text, "texto antigo") {
		t.Fatalf("segments = %v", input.Segments)
	}
}

// Erro transitorio ainda tem tentativa; chave/modelo errados falham na hora.
func TestShouldGiveUpAnalysis(t *testing.T) {
	permanent := errors.New("analyze: status 400: modelo invalido")
	transient := errors.New("analyze: request: dial tcp: connection refused")

	if !shouldGiveUpAnalysis(0, 5, permanent) {
		t.Fatal("erro permanente deveria falhar na primeira tentativa")
	}
	if shouldGiveUpAnalysis(0, 5, transient) {
		t.Fatal("erro transitorio com tentativas restantes nao deveria falhar")
	}
	if !shouldGiveUpAnalysis(4, 5, transient) {
		t.Fatal("ultima tentativa deveria marcar falha")
	}
}

// A analise recebe tudo o que a nota tem: texto escrito, transcricao de audio,
// imagem (legenda/arquivo) e links.
func TestAnalysisInputCombinesEveryKindOfContent(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := id.New()
	otherID := id.New()
	for _, entry := range []store.Entry{
		{ID: entryID, Title: "nota", Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now},
		{ID: otherID, Title: "outra nota", Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now},
	} {
		if err := st.CreateEntry(ctx, entry); err != nil {
			t.Fatalf("create entry: %v", err)
		}
	}
	if err := st.CreateNote(ctx, store.Note{
		ID: id.New(), EntryID: entryID,
		ContentMarkdown: "texto escrito\n\n![foto](attachment:abc)\n\n[site](https://exemplo.com)",
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	attachment := store.Attachment{
		ID: id.New(), EntryID: entryID, Kind: store.AttachmentOriginal,
		StorageKey: "key", Cipher: "aes-256-gcm", CreatedAt: now,
	}
	if err := st.CreateAttachment(ctx, attachment); err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	if err := st.CreateAttachment(ctx, store.Attachment{
		ID: id.New(), EntryID: entryID, Kind: "image",
		StorageKey: "image-key", Cipher: "aes-256-gcm", CreatedAt: now,
	}); err != nil {
		t.Fatalf("create image attachment: %v", err)
	}
	if err := st.SaveTranscript(ctx, store.Transcript{
		ID: id.New(), EntryID: entryID, AttachmentID: attachment.ID,
		Model: "teste", Language: "pt", Text: "fala do audio", CreatedAt: now,
	}, nil); err != nil {
		t.Fatalf("save transcript: %v", err)
	}
	if err := st.CreateLink(ctx, store.Link{
		ID: id.New(), FromEntryID: entryID, ToEntryID: otherID, CreatedAt: now,
	}); err != nil {
		t.Fatalf("create link: %v", err)
	}

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	if len(input.Segments) != 1 {
		t.Fatalf("segments = %d, want 1", len(input.Segments))
	}
	text := input.Segments[0].Text
	for _, want := range []string{
		"Texto escrito:", "texto escrito", "imagem: foto", "https://exemplo.com",
		"Transcricao do audio:", "fala do audio", "Links da nota:", "outra nota",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("faltou %q em:\n%s", want, text)
		}
	}
	if input.Language != "pt" {
		t.Fatalf("language = %q, want pt", input.Language)
	}
	if input.TextChars == 0 || input.TranscriptChars == 0 || input.Images != 1 {
		t.Fatalf("medidas = texto %d, fala %d, imagens %d", input.TextChars, input.TranscriptChars, input.Images)
	}
}

// Nota so com imagem: a legenda/arquivo entra na analise (o conteudo visual
// exigiria um modelo com visao).
func TestAnalysisInputWithOnlyAnImage(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := id.New()
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "foto", Status: store.EntryReady, Source: "text",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateNote(ctx, store.Note{
		ID: id.New(), EntryID: entryID, ContentMarkdown: "![1000315674.jpg](attachment:abc)",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	if len(input.Segments) != 1 || !strings.Contains(input.Segments[0].Text, "imagem: 1000315674.jpg") {
		t.Fatalf("segments = %v", input.Segments)
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
