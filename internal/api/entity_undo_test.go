package api

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// Renomear devolve o id da edicao e o desfazer volta ao estado anterior: nome,
// mencoes e o alias antigo.
func TestRenameEntityHasUndo(t *testing.T) {
	srv := newTestServer(t)
	seedRichEntry(t, srv, "e1", time.Now().UTC(), 0,
		[]store.EntityLink{{Kind: store.EntityPerson, Name: "Maria", Count: 3}})

	rec, body := doJSON(t, srv, http.MethodPatch, "/api/v1/entities/person/Maria",
		strings.NewReader(`{"name":"Mariana"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("rename: status %d (%s)", rec.Code, rec.Body.String())
	}
	editID, _ := body["edit_id"].(string)
	if editID == "" {
		t.Fatalf("rename sem edit_id: %v", body)
	}

	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/entities/edits/"+editID+"/undo", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("undo: status %d (%s)", rec.Code, rec.Body.String())
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=person", nil)
	entities, _ := list["entities"].([]any)
	found := false
	for _, raw := range entities {
		item, _ := raw.(map[string]any)
		if item["name"] == "Maria" && item["mentions"] == float64(3) {
			found = true
		}
		if item["name"] == "Mariana" {
			t.Fatalf("nome novo continuou depois do desfazer: %v", entities)
		}
	}
	if !found {
		t.Fatalf("Maria nao voltou: %v", entities)
	}

	// O segundo desfazer da mesma edicao nao existe mais.
	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/entities/edits/"+editID+"/undo", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("segundo undo: status %d, want 404", rec.Code)
	}
}

func TestUndoSelfRestoresPerson(t *testing.T) {
	srv := newTestServer(t)
	seedRichEntry(t, srv, "e1", time.Now().UTC(), 0,
		[]store.EntityLink{{Kind: store.EntityPerson, Name: "eu", Count: 2}})

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entities/person/eu/self", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("claim: status %d (%s)", rec.Code, rec.Body.String())
	}
	editID, _ := body["edit_id"].(string)
	if editID == "" {
		t.Fatalf("claim sem edit_id: %v", body)
	}

	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entities/edits/"+editID+"/undo", nil); rec.Code != http.StatusOK {
		t.Fatalf("undo: status %d", rec.Code)
	}
	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=person", nil)
	entities, _ := list["entities"].([]any)
	found := false
	for _, raw := range entities {
		item, _ := raw.(map[string]any)
		if item["name"] == "eu" {
			found = true
		}
	}
	if !found {
		t.Fatalf("a pessoa reivindicada nao voltou: %v", entities)
	}
	aliases, _ := list["owner_aliases"].([]any)
	for _, raw := range aliases {
		if raw == "eu" {
			t.Fatalf("owner alias continuou depois do desfazer: %v", aliases)
		}
	}
}

// Uma edicao mais nova bloqueia o desfazer da anterior: reverter apagaria a
// mudanca recente.
func TestUndoOlderEditConflicts(t *testing.T) {
	srv := newTestServer(t)
	seedRichEntry(t, srv, "e1", time.Now().UTC(), 0,
		[]store.EntityLink{
			{Kind: store.EntityPerson, Name: "Maria", Count: 1},
			{Kind: store.EntityPerson, Name: "Ana", Count: 1},
		})

	_, first := doJSON(t, srv, http.MethodPatch, "/api/v1/entities/person/Maria",
		strings.NewReader(`{"name":"Maria II"}`))
	firstID, _ := first["edit_id"].(string)
	doJSON(t, srv, http.MethodPatch, "/api/v1/entities/person/Ana",
		strings.NewReader(`{"name":"Ana II"}`))

	rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entities/edits/"+firstID+"/undo", nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("undo antigo: status %d, want 409", rec.Code)
	}
}
