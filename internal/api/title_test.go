package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestCreateTextEntryHasNoAutomaticTitle(t *testing.T) {
	srv := newTestServer(t)

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries", strings.NewReader(`{"title":""}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body %v", rec.Code, body)
	}
	title, _ := body["title"].(string)
	if title != "" {
		t.Fatalf("title = %q, want empty", title)
	}
}

func TestCreateTextEntryKeepsGivenTitle(t *testing.T) {
	srv := newTestServer(t)

	_, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries", strings.NewReader(`{"title":"Minha nota"}`))
	if body["title"] != "Minha nota" {
		t.Fatalf("title = %v", body["title"])
	}
}
