package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestBookPageAndWritingAPI(t *testing.T) {
	srv := newTestServer(t)

	rec, book := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Serra","kind":"book","page_size":"a4","page_margin_mm":25,"body_px":16,"body_leading":170,"body_font":"eb-garamond","daily_goal_words":500,"deadline":"2026-12-01"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar livro: %d (%s)", rec.Code, rec.Body.String())
	}
	bookID := book["id"].(string)
	if book["page_size"] != "a4" || book["page_margin_mm"].(float64) != 25 ||
		book["body_px"].(float64) != 16 || book["body_font"] != "eb-garamond" ||
		book["daily_goal_words"].(float64) != 500 || book["deadline"] != "2026-12-01" {
		t.Fatalf("pagina do livro = %+v", book)
	}

	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Lixo","kind":"book","page_size":"tabloide"}`))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("pagina invalida aceita: %d", rec.Code)
	}

	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Fonte","kind":"book","body_font":"comic-sans"}`))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("fonte invalida aceita: %d", rec.Code)
	}

	rec, chapter := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"A volta","notebook_id":"`+bookID+`"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar capitulo: %d", rec.Code)
	}
	chapterID := chapter["id"].(string)

	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+chapterID,
		strings.NewReader(`{"chapter_beats":"Chegada\nPrimeira noite"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("gravar beats: %d (%s)", rec.Code, rec.Body.String())
	}
	_, detail := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+chapterID, nil)
	if detail["chapter_beats"] != "Chegada\nPrimeira noite" {
		t.Fatalf("beats = %+v", detail["chapter_beats"])
	}

	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+chapterID+"/notes",
		strings.NewReader(`{"title":"A volta","content_markdown":"cinco palavras contadas neste teste"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("corpo do capitulo: %d", rec.Code)
	}

	rec, writing := doJSON(t, srv, http.MethodGet, "/api/v1/notebooks/"+bookID+"/writing?days=7", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("ritmo: %d (%s)", rec.Code, rec.Body.String())
	}
	if writing["today"].(float64) != 5 {
		t.Fatalf("palavras de hoje = %+v", writing["today"])
	}
	days := writing["days"].([]any)
	if len(days) != 7 {
		t.Fatalf("janela = %d", len(days))
	}
	last := days[len(days)-1].(map[string]any)
	if last["words"].(float64) != 5 {
		t.Fatalf("ultimo dia = %+v", last)
	}
}
