package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestBookPageDefaultsAndUpdate(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "book1", "Livro", NotebookKindBook)

	book, err := s.GetNotebook(ctx, "book1")
	if err != nil {
		t.Fatalf("get book: %v", err)
	}
	if book.PageSize != Page14x21 || book.PageMarginMM != 19 || book.BodyPX != 18 || book.BodyLeading != 160 {
		t.Fatalf("pagina padrao = %+v", book)
	}
	if book.BodyFont != FontNewsreader {
		t.Fatalf("fonte padrao = %q", book.BodyFont)
	}
	if book.DailyGoalWords != 0 || book.Deadline != "" {
		t.Fatalf("ritmo padrao = %+v", book)
	}

	updated, err := s.UpdateBookMeta(ctx, "book1", BookMeta{
		Subtitle: "Volume I", Author: "Ana", Synopsis: "Uma historia.", Language: "pt-BR",
		GoalWords: 90000, BookStatus: BookDrafting,
		PageSize: PageA4, PageMarginMM: 25, BodyPX: 16, BodyLeading: 170,
		BodyFont: FontEBGaramond, DailyGoalWords: 500, Deadline: "2026-12-01",
	})
	if err != nil {
		t.Fatalf("update book: %v", err)
	}
	if updated.PageSize != PageA4 || updated.PageMarginMM != 25 || updated.BodyPX != 16 ||
		updated.BodyLeading != 170 || updated.BodyFont != FontEBGaramond ||
		updated.DailyGoalWords != 500 || updated.Deadline != "2026-12-01" {
		t.Fatalf("pagina atualizada = %+v", updated)
	}

	// Um tamanho fora da whitelist volta ao padrao seguro em vez de gravar lixo.
	again, err := s.UpdateBookMeta(ctx, "book1", BookMeta{
		Subtitle: "", Author: "", Synopsis: "", Language: "", GoalWords: 0,
		BookStatus: BookDrafting, PageSize: "tabloide", PageMarginMM: 0,
		BodyPX: 0, BodyLeading: 0, DailyGoalWords: 0, Deadline: "",
	})
	if err != nil {
		t.Fatalf("update com lixo: %v", err)
	}
	if again.PageSize != Page14x21 || again.PageMarginMM != 19 || again.BodyPX != 18 ||
		again.BodyLeading != 160 || again.BodyFont != FontNewsreader {
		t.Fatalf("pagina segura = %+v", again)
	}
}

func TestChapterBeatsRoundTrip(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "book1", "Livro", NotebookKindBook)
	createTestChapter(t, s, "c1", "book1", ChapterKindChapter, 1024)

	status := ChapterDraft
	goal := 800
	synopsis := "A volta para casa."
	beats := "Chegada na casa\nPrimeira noite sem dormir"
	if err := s.UpdateChapterMeta(ctx, "c1", &status, &goal, &synopsis, &beats, nil); err != nil {
		t.Fatalf("update chapter beats: %v", err)
	}
	entry, err := s.GetEntry(ctx, "c1")
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if entry.ChapterBeats != beats {
		t.Fatalf("beats = %q", entry.ChapterBeats)
	}
}

func TestWritingDaysCountsBookEdits(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "book1", "Livro", NotebookKindBook)
	createTestChapter(t, s, "c1", "book1", ChapterKindChapter, 1024)
	now := time.Now().UTC()

	// O primeiro corpo do capitulo conta como escrita do dia.
	if err := s.CreateNote(ctx, Note{
		ID: "n1", EntryID: "c1", Title: "c1",
		ContentMarkdown: "uma frase com cinco palavras", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	if _, _, err := s.UpdateNoteBody(ctx, "n1", "uma frase com cinco palavras e mais tres", ""); err != nil {
		t.Fatalf("update note body: %v", err)
	}
	days, err := s.WritingDays(ctx, "book1", 7)
	if err != nil {
		t.Fatalf("writing days: %v", err)
	}
	if len(days) != 7 {
		t.Fatalf("janela = %d dias", len(days))
	}
	if got := days[len(days)-1].Words; got != 8 {
		t.Fatalf("palavras de hoje = %d", got)
	}

	// Apagar texto desconta o que foi apagado.
	if _, _, err := s.UpdateNoteBody(ctx, "n1", "uma frase", ""); err != nil {
		t.Fatalf("update note body curto: %v", err)
	}
	days, err = s.WritingDays(ctx, "book1", 7)
	if err != nil {
		t.Fatalf("writing days: %v", err)
	}
	if got := days[len(days)-1].Words; got != 2 {
		t.Fatalf("palavras depois de apagar = %d", got)
	}
}

func TestWritingDaysIgnoreNotesNotebook(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "notes1", "Diario", NotebookKindNotes)
	createTestEntry(t, s, "e1", "notes1")
	now := time.Now().UTC()
	if err := s.CreateNote(ctx, Note{
		ID: "n1", EntryID: "e1", Title: "e1",
		ContentMarkdown: "nota comum", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	days, err := s.WritingDays(ctx, "notes1", 7)
	if err != nil {
		t.Fatalf("writing days: %v", err)
	}
	for _, day := range days {
		if day.Words != 0 {
			t.Fatalf("nota comum contou no ritmo: %+v", days)
		}
	}
}

func TestBookCoverRoundTrip(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	createTestNotebook(t, s, "book1", "Livro", NotebookKindBook)

	if _, err := s.GetBookCover(ctx, "book1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("capa ausente = %v", err)
	}
	now := time.Now().UTC()
	if err := s.SetBookCover(ctx, BookCover{
		NotebookID: "book1", ContentType: "image/jpeg",
		Image: []byte{1, 2, 3}, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("set cover: %v", err)
	}
	cover, err := s.GetBookCover(ctx, "book1")
	if err != nil || cover.ContentType != "image/jpeg" || len(cover.Image) != 3 {
		t.Fatalf("cover = %+v, %v", cover, err)
	}
	book, err := s.GetNotebook(ctx, "book1")
	if err != nil || !book.HasCover || book.CoverUpdatedAt == nil {
		t.Fatalf("flags da capa = %+v, %v", book, err)
	}
	if err := s.DeleteBookCover(ctx, "book1"); err != nil {
		t.Fatalf("delete cover: %v", err)
	}
	book, err = s.GetNotebook(ctx, "book1")
	if err != nil || book.HasCover {
		t.Fatalf("capa removida = %+v, %v", book, err)
	}
}
