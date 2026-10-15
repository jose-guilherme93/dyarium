package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestEntryLinks(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	seedPlainEntry(t, srv, "e2")

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries/e1/links",
		strings.NewReader(`{"to_entry_id":"e2","label":"continuacao"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("link interno: status %d, body %v", rec.Code, body)
	}
	if body["to_entry_id"] != "e2" || body["label"] != "continuacao" {
		t.Fatalf("link interno inesperado: %v", body)
	}

	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/entries/e1/links",
		strings.NewReader(`{"url":"https://example.com/x"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("link externo: status %d", rec.Code)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/links", nil)
	links, _ := list["links"].([]any)
	if len(links) != 2 {
		t.Fatalf("links = %+v", links)
	}
	internal := links[0].(map[string]any)
	if internal["to_entry_id"] != "e2" || internal["title"] != "e2" {
		t.Fatalf("link interno sem titulo resolvido: %v", internal)
	}
}

func TestCreateLinkValidation(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")

	cases := []struct {
		name string
		body string
		want int
	}{
		{"sem destino", `{}`, http.StatusBadRequest},
		{"dois destinos", `{"to_entry_id":"e1","url":"https://example.com"}`, http.StatusBadRequest},
		{"auto link", `{"to_entry_id":"e1"}`, http.StatusBadRequest},
		{"url invalida", `{"url":"ftp://example.com"}`, http.StatusBadRequest},
		{"destino inexistente", `{"to_entry_id":"en_inexistente"}`, http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entries/e1/links", strings.NewReader(tc.body))
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

func TestDeleteLink(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")

	_, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries/e1/links",
		strings.NewReader(`{"url":"https://example.com"}`))
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("id do link ausente: %v", body)
	}

	rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/links/"+id, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("remover link: status %d", rec.Code)
	}
	rec, _ = doJSON(t, srv, http.MethodDelete, "/api/v1/links/"+id, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("remover de novo: status %d, want 404", rec.Code)
	}
}
