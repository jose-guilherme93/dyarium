package api

import (
	"net/http"
	"strings"
	"testing"
)

// O app cria notas offline com um id temporal proprio; o servidor aceita esse id
// e a hora de criacao, para a nota cair na posicao cronologica certa.

func TestCreateEntryAcceptsClientID(t *testing.T) {
	srv := newTestServer(t)
	const clientID = "note_01J8Z0000000000000000000A"

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries", strings.NewReader(
		`{"id":"`+clientID+`","title":"criada offline","created_at":"2026-10-11T14:00:00Z"}`,
	))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	if body["id"] != clientID {
		t.Fatalf("id = %v, want %s", body["id"], clientID)
	}
	if body["created_at"] != "2026-10-11T14:00:00Z" {
		t.Fatalf("created_at = %v, want 2026-10-11T14:00:00Z", body["created_at"])
	}
}

func TestCreateEntryIsIdempotentByClientID(t *testing.T) {
	srv := newTestServer(t)
	const clientID = "note_01J8Z0000000000000000000B"
	payload := strings.NewReader(`{"id":"` + clientID + `","title":"mesma nota"}`)

	first, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entries", payload)
	if first.Code != http.StatusCreated {
		t.Fatalf("first: status = %d, want 201", first.Code)
	}

	_, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"id":"`+clientID+`","title":"mesma nota"}`))
	if body["id"] != clientID {
		t.Fatalf("second: id = %v, want %s", body["id"], clientID)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	entries, _ := list["entries"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1 (nao pode duplicar)", len(entries))
	}
}

func TestCreateEntryRejectsInvalidClientID(t *testing.T) {
	srv := newTestServer(t)
	rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"id":"id invalido","title":"x"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
