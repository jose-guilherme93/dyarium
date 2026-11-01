package api

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestBookLifecycleAPI(t *testing.T) {
	srv := newTestServer(t)

	rec, book := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"O nome do vento","kind":"book","subtitle":"Volume I","author":"Ana","goal_words":90000}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar livro: %d (%s)", rec.Code, rec.Body.String())
	}
	bookID := book["id"].(string)
	if book["kind"] != "book" || book["chapter_count"].(float64) != 0 {
		t.Fatalf("livro = %+v", book)
	}

	rec, chapter := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"A ponte","notebook_id":"`+bookID+`"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar capitulo: %d (%s)", rec.Code, rec.Body.String())
	}
	chapterID := chapter["id"].(string)
	if chapter["chapter_kind"] != "chapter" || chapter["chapter_position"] == nil {
		t.Fatalf("capitulo = %+v", chapter)
	}
	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+chapterID+"/notes",
		strings.NewReader(`{"title":"A ponte","content_markdown":"# A ponte\n\nUma frase com cinco palavras."}`)); rec.Code != http.StatusCreated {
		t.Fatalf("corpo do capitulo: %d", rec.Code)
	}

	_, listed := doJSON(t, srv, http.MethodGet, "/api/v1/notebooks?include_words=1", nil)
	found := false
	for _, item := range listed["notebooks"].([]any) {
		notebook := item.(map[string]any)
		if notebook["id"] == bookID {
			found = true
			if notebook["chapter_count"].(float64) != 1 || notebook["words"] == nil {
				t.Fatalf("contagens do livro = %+v", notebook)
			}
		}
	}
	if !found {
		t.Fatalf("livro ausente da listagem")
	}

	_, chapters := doJSON(t, srv, http.MethodGet, "/api/v1/entries?notebook_id="+bookID, nil)
	entry := chapters["entries"].([]any)[0].(map[string]any)
	if entry["word_count"] == nil {
		t.Fatalf("word_count ausente: %+v", entry)
	}

	// A ordem envia a lista inteira.
	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/notebooks/"+bookID+"/chapters/order",
		strings.NewReader(`{"chapters":[{"entry_id":"`+chapterID+`","chapter_kind":"part","chapter_status":"revising","position":2048}]}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("reordenar: %d (%s)", rec.Code, rec.Body.String())
	}
	_, detail := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+chapterID, nil)
	if detail["chapter_kind"] != "part" || detail["chapter_status"] != "revising" {
		t.Fatalf("capitulo depois da ordem = %+v", detail)
	}

	// Exclusao exige o titulo e manda o capitulo para a lixeira.
	wrong := "/api/v1/notebooks/" + bookID + "?mode=trash&confirm=" + url.QueryEscape("Outro")
	if rec, _ := doJSON(t, srv, http.MethodDelete, wrong, nil); rec.Code != http.StatusConflict {
		t.Fatalf("excluir sem confirmar: %d", rec.Code)
	}
	right := "/api/v1/notebooks/" + bookID + "?mode=trash&confirm=" + url.QueryEscape("O nome do vento")
	if rec, _ := doJSON(t, srv, http.MethodDelete, right, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("excluir livro: %d", rec.Code)
	}
	_, trash := doJSON(t, srv, http.MethodGet, "/api/v1/entries?deleted=1", nil)
	if len(trash["entries"].([]any)) != 1 {
		t.Fatalf("lixeira = %+v", trash)
	}
}

func TestBookActivationAPI(t *testing.T) {
	srv := newTestServer(t)
	_, listed := doJSON(t, srv, http.MethodGet, "/api/v1/notebooks", nil)
	defaultID := listed["notebooks"].([]any)[0].(map[string]any)["id"].(string)

	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+defaultID,
		strings.NewReader(`{"kind":"book"}`)); rec.Code != http.StatusConflict {
		t.Fatalf("padrao virou livro: %d", rec.Code)
	}

	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Trabalho"}`))
	notebookID := created["id"].(string)
	rec, body := doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+notebookID,
		strings.NewReader(`{"kind":"book"}`))
	if rec.Code != http.StatusOK || body["kind"] != "book" {
		t.Fatalf("ativar vazio: %d (%s)", rec.Code, rec.Body.String())
	}

	doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"cap","notebook_id":"`+notebookID+`"}`))
	rec, body = doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+notebookID,
		strings.NewReader(`{"kind":"notes"}`))
	if rec.Code != http.StatusConflict || body["error"].(map[string]any)["code"] != "book_has_chapters" {
		t.Fatalf("desativar sem confirmar: %d (%s)", rec.Code, rec.Body.String())
	}
	rec, body = doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+notebookID,
		strings.NewReader(`{"kind":"notes","confirm_convert":true}`))
	if rec.Code != http.StatusOK || body["kind"] != "notes" {
		t.Fatalf("converter: %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestBookEntryScopeAndGuards(t *testing.T) {
	srv := newTestServer(t)
	_, book := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Livro","kind":"book"}`))
	bookID := book["id"].(string)

	// Metadados num caderno comum sao 422.
	_, plain := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Diario"}`))
	plainID := plain["id"].(string)
	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+plainID,
		strings.NewReader(`{"subtitle":"x"}`)); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("metadados fora do livro: %d", rec.Code)
	}
	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"x","notebook_id":"`+plainID+`","chapter_kind":"chapter"}`)); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("chapter_kind fora do livro: %d", rec.Code)
	}

	_, chapter := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"cap","notebook_id":"`+bookID+`"}`))
	chapterID := chapter["id"].(string)
	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+chapterID,
		strings.NewReader(`{"archived":true}`)); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("arquivar capitulo: %d", rec.Code)
	}

	// exclude_books tira o capitulo do diario.
	doJSON(t, srv, http.MethodPost, "/api/v1/entries", strings.NewReader(`{"title":"nota"}`))
	_, all := doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	_, diary := doJSON(t, srv, http.MethodGet, "/api/v1/entries?exclude_books=1", nil)
	if countEntries(all) != 2 || countEntries(diary) != 1 {
		t.Fatalf("escopo: todas=%d diario=%d", countEntries(all), countEntries(diary))
	}
}
