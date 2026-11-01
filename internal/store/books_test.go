package store

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

func createTestNotebook(t *testing.T, s *Store, id, name, kind string) {
	t.Helper()
	now := time.Now().UTC()
	if err := s.CreateNotebook(context.Background(), Notebook{
		ID: id, Name: name, Kind: kind, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create notebook %s: %v", id, err)
	}
}

func createTestEntry(t *testing.T, s *Store, id, notebookID string) {
	t.Helper()
	now := time.Now().UTC()
	if err := s.CreateEntry(context.Background(), Entry{
		ID: id, Status: EntryReady, Source: "text", NotebookID: notebookID,
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry %s: %v", id, err)
	}
}

func createTestChapter(t *testing.T, s *Store, id, notebookID, kind string, position float64) {
	t.Helper()
	now := time.Now().UTC()
	if err := s.CreateEntry(context.Background(), Entry{
		ID: id, Title: id, Status: EntryReady, Source: "text", NotebookID: notebookID,
		CreatedAt: now, UpdatedAt: now, ChapterKind: kind, ChapterPosition: &position,
		ChapterStatus: ChapterDraft,
	}); err != nil {
		t.Fatalf("create chapter %s: %v", id, err)
	}
}

func TestBookActivationRequiresEmptyNotebook(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "nb1", "Diario", NotebookKindNotes)

	if _, err := s.SetNotebookKind(ctx, "nb1", NotebookKindBook, false); err != nil {
		t.Fatalf("ativar livro vazio: %v", err)
	}
	book, err := s.GetNotebook(ctx, "nb1")
	if err != nil || !book.IsBook() {
		t.Fatalf("livro = %+v, %v", book, err)
	}

	createTestNotebook(t, s, "nb2", "Trabalho", NotebookKindNotes)
	createTestEntry(t, s, "e1", "nb2")
	var count *NotebookCountError
	if _, err := s.SetNotebookKind(ctx, "nb2", NotebookKindBook, false); !errors.As(err, &count) || count.Count != 1 {
		t.Fatalf("caderno com nota deveria recusar: %v", err)
	}
	if err := s.SoftDeleteEntry(ctx, "e1"); err != nil {
		t.Fatalf("lixeira: %v", err)
	}
	if _, err := s.SetNotebookKind(ctx, "nb2", NotebookKindBook, false); err != nil {
		t.Fatalf("lixeira nao deveria bloquear: %v", err)
	}
}

func TestBookActivationRejectsArchivedNote(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "nb1", "Diario", NotebookKindNotes)
	createTestEntry(t, s, "e1", "nb1")
	archived := true
	if _, _, err := s.UpdateEntryFields(ctx, "e1", nil, nil, nil, &archived, nil, nil, "", ""); err != nil {
		t.Fatalf("arquivar: %v", err)
	}
	if _, err := s.SetNotebookKind(ctx, "nb1", NotebookKindBook, false); !errors.Is(err, ErrNotebookNotEmpty) {
		t.Fatalf("nota arquivada deveria bloquear: %v", err)
	}
}

func TestDefaultNotebookCannotBeBook(t *testing.T) {
	s := openTestStore(t)
	if _, err := s.SetNotebookKind(context.Background(), DefaultNotebookID, NotebookKindBook, false); !errors.Is(err, ErrProtected) {
		t.Fatalf("padrao virou livro: %v", err)
	}
	if err := s.CreateNotebook(context.Background(), Notebook{
		ID: DefaultNotebookID, Name: "Outro", Kind: NotebookKindBook,
	}); !errors.Is(err, ErrProtected) {
		t.Fatalf("criar livro no id do padrao: %v", err)
	}
}

func TestBookConversionKeepsTexts(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "nb1", "Livro", NotebookKindBook)
	createTestChapter(t, s, "e1", "nb1", ChapterKindChapter, 1024)

	var count *NotebookCountError
	if _, err := s.SetNotebookKind(ctx, "nb1", NotebookKindNotes, false); !errors.As(err, &count) || count.Count != 1 {
		t.Fatalf("desativar com capitulo deveria exigir confirmacao: %v", err)
	}
	if _, err := s.SetNotebookKind(ctx, "nb1", NotebookKindNotes, true); err != nil {
		t.Fatalf("converter: %v", err)
	}
	entry, err := s.GetEntry(ctx, "e1")
	if err != nil {
		t.Fatalf("nota sumiu na conversao: %v", err)
	}
	if entry.ChapterKind != "" || entry.ChapterPosition != nil {
		t.Fatalf("estrutura nao foi limpa: %+v", entry)
	}
	book, _ := s.GetNotebook(ctx, "nb1")
	if book.IsBook() {
		t.Fatalf("caderno continuou livro: %+v", book)
	}
}

func TestReorderChaptersIsAtomicAndComplete(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "nb1", "Livro", NotebookKindBook)
	createTestChapter(t, s, "e1", "nb1", ChapterKindChapter, 1024)
	createTestChapter(t, s, "e2", "nb1", ChapterKindPart, 2048)

	err := s.ReorderChapters(ctx, "nb1", []ChapterOrder{
		{EntryID: "e1", ChapterKind: ChapterKindChapter, Position: 10},
	})
	if !errors.Is(err, ErrChapterNotInBook) {
		t.Fatalf("lista incompleta: %v", err)
	}
	err = s.ReorderChapters(ctx, "nb1", []ChapterOrder{
		{EntryID: "e1", ChapterKind: ChapterKindChapter, Position: 10},
		{EntryID: "outro", ChapterKind: ChapterKindPart, Position: 20},
	})
	if !errors.Is(err, ErrChapterNotInBook) {
		t.Fatalf("id de outro livro: %v", err)
	}
	err = s.ReorderChapters(ctx, "nb1", []ChapterOrder{
		{EntryID: "e1", ChapterKind: "capitulo", Position: 10},
		{EntryID: "e2", ChapterKind: ChapterKindPart, Position: 20},
	})
	if !errors.Is(err, ErrInvalidChapter) {
		t.Fatalf("kind invalido: %v", err)
	}
	err = s.ReorderChapters(ctx, "nb1", []ChapterOrder{
		{EntryID: "e1", ChapterKind: ChapterKindPart, Position: math.Inf(1)},
		{EntryID: "e2", ChapterKind: ChapterKindChapter, Position: 20},
	})
	if !errors.Is(err, ErrInvalidChapter) {
		t.Fatalf("posicao nao finita: %v", err)
	}
	if err := s.ReorderChapters(ctx, "nb1", []ChapterOrder{
		{EntryID: "e2", ChapterKind: ChapterKindPart, Position: 10},
		{EntryID: "e1", ChapterKind: ChapterKindChapter, Position: 20},
	}); err != nil {
		t.Fatalf("reordenar: %v", err)
	}
	entry, _ := s.GetEntry(ctx, "e1")
	if entry.ChapterPosition == nil || *entry.ChapterPosition != 20 {
		t.Fatalf("posicao de e1 = %v", entry.ChapterPosition)
	}
}

func TestMoveEntryBetweenBookAndNotes(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "notes1", "Diario", NotebookKindNotes)
	createTestNotebook(t, s, "book1", "Livro", NotebookKindBook)
	createTestEntry(t, s, "e1", "notes1")

	if err := s.NormalizeEntryNotebook(ctx, "e1", "book1"); err != nil {
		t.Fatalf("mover para livro: %v", err)
	}
	entry, _ := s.GetEntry(ctx, "e1")
	if entry.ChapterKind != ChapterKindChapter || entry.ChapterPosition == nil || entry.Archived {
		t.Fatalf("entrada no livro = %+v", entry)
	}
	archived := true
	if _, _, err := s.UpdateEntryFields(ctx, "e1", nil, nil, nil, &archived, nil, nil, "", ""); !errors.Is(err, ErrNotABookEntry) {
		t.Fatalf("arquivar capitulo: %v", err)
	}
	if err := s.NormalizeEntryNotebook(ctx, "e1", "notes1"); err != nil {
		t.Fatalf("mover para notas: %v", err)
	}
	entry, _ = s.GetEntry(ctx, "e1")
	if entry.ChapterKind != "" || entry.ChapterPosition != nil {
		t.Fatalf("estrutura sobrou em notas: %+v", entry)
	}
}

func TestDeleteBookTrashesChapters(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "book1", "O nome do vento", NotebookKindBook)
	createTestChapter(t, s, "e1", "book1", ChapterKindChapter, 1024)

	if err := s.DeleteBook(ctx, "book1", "errado"); !errors.Is(err, ErrConfirmRequired) {
		t.Fatalf("confirmacao errada: %v", err)
	}
	if err := s.DeleteBook(ctx, "book1", "O nome do vento"); err != nil {
		t.Fatalf("excluir livro: %v", err)
	}
	if _, err := s.GetNotebook(ctx, "book1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("caderno ainda existe: %v", err)
	}
	deleted, err := s.ListDeletedEntries(ctx, 10, 0)
	if err != nil || len(deleted) != 1 || deleted[0].ID != "e1" {
		t.Fatalf("lixeira = %+v, %v", deleted, err)
	}
	if _, err := s.GetTombstone(ctx, "book1", TombstoneNotebook); err != nil {
		t.Fatalf("tombstone do caderno: %v", err)
	}
	if _, err := s.GetTombstone(ctx, "e1", TombstoneEntry); err != nil {
		t.Fatalf("tombstone do capitulo: %v", err)
	}
}

func TestDiaryScopeExcludesBooks(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "diario", "Diario", NotebookKindNotes)
	createTestNotebook(t, s, "livro", "Livro", NotebookKindBook)
	day := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	for id, notebook := range map[string]string{"e_note": "diario", "e_book": "livro"} {
		if err := s.CreateEntry(ctx, Entry{
			ID: id, Title: id, Status: EntryReady, Source: "text", NotebookID: notebook,
			CreatedAt: day, UpdatedAt: day,
		}); err != nil {
			t.Fatalf("entrada %s: %v", id, err)
		}
	}
	saveEntities(t, s, "e_note", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 1})
	saveEntities(t, s, "e_book", EntityLink{Kind: EntityPerson, Name: "João", Count: 1})
	for _, a := range []Analysis{
		{ID: "a_note", EntryID: "e_note", Sentiment: 0.5, CreatedAt: day},
		{ID: "a_book", EntryID: "e_book", Sentiment: -0.5, CreatedAt: day},
	} {
		if err := s.SaveAnalysis(ctx, a); err != nil {
			t.Fatalf("analise: %v", err)
		}
	}

	graph, err := s.Graph(ctx, GraphOptions{ExcludeBooks: true})
	if err != nil {
		t.Fatalf("grafo: %v", err)
	}
	labels := make([]string, 0, len(graph.Nodes))
	for _, node := range graph.Nodes {
		labels = append(labels, node.Label)
	}
	if len(labels) != 1 || labels[0] != "Maria" {
		t.Fatalf("grafo do diario = %v", labels)
	}

	points, err := s.MoodSeriesExcludingBooks(ctx, time.Time{}, time.Time{}, true)
	if err != nil {
		t.Fatalf("humor: %v", err)
	}
	if len(points) != 1 || points[0].Entries != 1 {
		t.Fatalf("humor do diario = %+v", points)
	}
}

func TestBookWordCountsUseProse(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "book1", "Livro", NotebookKindBook)
	createTestChapter(t, s, "e1", "book1", ChapterKindChapter, 1024)
	now := time.Now().UTC()
	if err := s.CreateNote(ctx, Note{
		ID: "n1", EntryID: "e1", Title: "e1",
		ContentMarkdown: "# Titulo\n\nUma frase curta.\n\n![Ponte](attachment:abc){w=60}\n\n!audio[attachment:xyz]",
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	counts, err := s.BookWordCounts(ctx)
	if err != nil {
		t.Fatalf("word counts: %v", err)
	}
	// "Titulo Uma frase curta imagem: Ponte" tambem conta a legenda da imagem.
	if got := counts["book1"]; got < 4 || got > 10 {
		t.Fatalf("palavras = %d", got)
	}
}
