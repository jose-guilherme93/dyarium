package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBookCoverAPI(t *testing.T) {
	srv := newTestServer(t)

	_, notes := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Caderno","kind":"notes"}`))
	notesID := notes["id"].(string)
	_, book := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Livro","kind":"book"}`))
	bookID := book["id"].(string)

	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	put := authedRequest(http.MethodPut, "/api/v1/notebooks/"+bookID+"/cover", bytes.NewReader(png))
	put.Header.Set("Content-Type", "image/png")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, put)
	if rec.Code != http.StatusOK {
		t.Fatalf("enviar capa: %d (%s)", rec.Code, rec.Body.String())
	}
	_, listed := doJSON(t, srv, http.MethodGet, "/api/v1/notebooks", nil)
	for _, item := range listed["notebooks"].([]any) {
		notebook := item.(map[string]any)
		if notebook["id"] == bookID && notebook["has_cover"] != true {
			t.Fatalf("has_cover ausente: %+v", notebook)
		}
	}

	get := authedRequest(http.MethodGet, "/api/v1/notebooks/"+bookID+"/cover", nil)
	getRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(getRec, get)
	if getRec.Code != http.StatusOK || getRec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("get cover: %d %s", getRec.Code, getRec.Header().Get("Content-Type"))
	}

	notesPut := authedRequest(http.MethodPut, "/api/v1/notebooks/"+notesID+"/cover", bytes.NewReader(png))
	notesPut.Header.Set("Content-Type", "image/png")
	notesRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(notesRec, notesPut)
	if notesRec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("capa em caderno comum: %d", notesRec.Code)
	}

	textPut := authedRequest(http.MethodPut, "/api/v1/notebooks/"+bookID+"/cover", strings.NewReader("texto"))
	textPut.Header.Set("Content-Type", "text/plain")
	textRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(textRec, textPut)
	if textRec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("capa de texto: %d", textRec.Code)
	}

	del := authedRequest(http.MethodDelete, "/api/v1/notebooks/"+bookID+"/cover", nil)
	delRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(delRec, del)
	if delRec.Code != http.StatusNoContent {
		t.Fatalf("remover capa: %d", delRec.Code)
	}
}
