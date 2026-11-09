package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestEntityLabelEndpoint(t *testing.T) {
	srv := newTestServer(t)
	seedRichEntry(t, srv, "e1", time.Now().UTC(), 0,
		[]store.EntityLink{{Kind: store.EntityPerson, Name: "Maria", Count: 2}})

	rec, body := doJSON(t, srv, http.MethodPut, "/api/v1/entities/person/Maria/label",
		strings.NewReader(`{"label":"  gata  "}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("label: status %d (%s)", rec.Code, rec.Body.String())
	}
	if body["label"] != "gata" {
		t.Fatalf("label = %v", body["label"])
	}
	if body["edit_id"] == "" || body["edit_id"] == nil {
		t.Fatalf("label sem edit_id: %+v", body)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=person", nil)
	entities, _ := list["entities"].([]any)
	if len(entities) != 1 {
		t.Fatalf("entities = %+v", list)
	}
	if entities[0].(map[string]any)["label"] != "gata" {
		t.Fatalf("a lista nao trouxe o label: %+v", entities[0])
	}

	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/entities/person/Maria/label",
		strings.NewReader(`{"label":"`+strings.Repeat("a", 81)+`"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("label longo: status %d, want 400", rec.Code)
	}
	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/entities/person/Ninguem/label",
		strings.NewReader(`{"label":"x"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("entidade inexistente: status %d, want 404", rec.Code)
	}
}

func TestChangeEntityKindEndpointAndUndo(t *testing.T) {
	srv := newTestServer(t)
	seedRichEntry(t, srv, "e1", time.Now().UTC(), 0,
		[]store.EntityLink{{Kind: store.EntityPerson, Name: "Maria", Count: 3}})

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entities/person/Maria/kind",
		strings.NewReader(`{"kind":"place"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("kind: status %d (%s)", rec.Code, rec.Body.String())
	}
	if body["kind"] != "place" || body["name"] != "Maria" {
		t.Fatalf("entidade = %+v", body)
	}
	editID, _ := body["edit_id"].(string)
	if editID == "" {
		t.Fatalf("kind sem edit_id: %+v", body)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=person", nil)
	if entities, _ := list["entities"].([]any); len(entities) != 0 {
		t.Fatalf("person continuou: %+v", entities)
	}
	rejections, _ := list["rejections"].([]any)
	if len(rejections) != 1 {
		t.Fatalf("rejeicoes = %+v", list["rejections"])
	}
	rejection, _ := rejections[0].(map[string]any)
	if rejection["kind"] != "person" || rejection["name_key"] != "maria" {
		t.Fatalf("rejeicao = %+v", rejection)
	}

	_, places := doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=place", nil)
	placeEntities, _ := places["entities"].([]any)
	if len(placeEntities) != 1 || placeEntities[0].(map[string]any)["name"] != "Maria" {
		t.Fatalf("place = %+v", places)
	}

	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entities/edits/"+editID+"/undo", nil); rec.Code != http.StatusOK {
		t.Fatalf("undo: status %d", rec.Code)
	}
	_, list = doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=person", nil)
	entities, _ := list["entities"].([]any)
	if len(entities) != 1 || entities[0].(map[string]any)["name"] != "Maria" {
		t.Fatalf("person nao voltou: %+v", entities)
	}
	rejections, _ = list["rejections"].([]any)
	if len(rejections) != 0 {
		t.Fatalf("rejeicao nao foi removida: %+v", rejections)
	}

	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/entities/person/Maria/kind",
		strings.NewReader(`{"kind":"person"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("kind igual: status %d, want 400", rec.Code)
	}
}

func TestDeleteEntityEndpoint(t *testing.T) {
	srv := newTestServer(t)
	seedRichEntry(t, srv, "e1", time.Now().UTC(), 0,
		[]store.EntityLink{{Kind: store.EntityPerson, Name: "Maria", Count: 2}})

	rec, body := doJSON(t, srv, http.MethodDelete, "/api/v1/entities/person/Maria", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: status %d (%s)", rec.Code, rec.Body.String())
	}
	if body["status"] != "ok" || body["edit_id"] == "" || body["edit_id"] == nil {
		t.Fatalf("delete = %+v", body)
	}
	rejection, _ := body["rejection"].(map[string]any)
	if rejection["kind"] != "person" || rejection["name"] != "Maria" || rejection["name_key"] != "maria" {
		t.Fatalf("rejeicao = %+v", rejection)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=person", nil)
	if entities, _ := list["entities"].([]any); len(entities) != 0 {
		t.Fatalf("entidade continuou: %+v", entities)
	}
	rejections, _ := list["rejections"].([]any)
	if len(rejections) != 1 {
		t.Fatalf("rejeicoes = %+v", list["rejections"])
	}

	editID, _ := body["edit_id"].(string)
	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entities/edits/"+editID+"/undo", nil); rec.Code != http.StatusOK {
		t.Fatalf("undo: status %d", rec.Code)
	}
	_, list = doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=person", nil)
	entities, _ := list["entities"].([]any)
	if len(entities) != 1 || entities[0].(map[string]any)["name"] != "Maria" {
		t.Fatalf("entidade nao voltou: %+v", entities)
	}
	rejections, _ = list["rejections"].([]any)
	if len(rejections) != 0 {
		t.Fatalf("rejeicao nao foi removida: %+v", rejections)
	}
}

func TestEntityRejectionEndpoints(t *testing.T) {
	srv := newTestServer(t)

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entity-rejections",
		strings.NewReader(`{"kind":"person","name":"  Você  "}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("reject: status %d (%s)", rec.Code, rec.Body.String())
	}
	rejection, _ := body["rejection"].(map[string]any)
	if rejection["name_key"] != "voce" || rejection["kind"] != "person" {
		t.Fatalf("rejeicao = %+v", rejection)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entities", nil)
	rejections, _ := list["rejections"].([]any)
	if len(rejections) != 1 {
		t.Fatalf("rejeicoes = %+v", list["rejections"])
	}

	// A remocao acha pela chave normalizada, mesmo com outra grafia.
	rec, _ = doJSON(t, srv, http.MethodDelete, "/api/v1/entity-rejections/person/voce", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("remove rejection: status %d (%s)", rec.Code, rec.Body.String())
	}
	_, list = doJSON(t, srv, http.MethodGet, "/api/v1/entities", nil)
	rejections, _ = list["rejections"].([]any)
	if len(rejections) != 0 {
		t.Fatalf("rejeicao continuou: %+v", rejections)
	}

	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/entity-rejections",
		strings.NewReader(`{"kind":"bogus","name":"x"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("kind invalido: status %d, want 400", rec.Code)
	}
	rec, _ = doJSON(t, srv, http.MethodPost, "/api/v1/entity-rejections",
		strings.NewReader(`{"kind":"person","name":"  "}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("nome vazio: status %d, want 400", rec.Code)
	}
}

func TestEntityCurationRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodPut, "/api/v1/entities/person/Maria/label"},
		{http.MethodPost, "/api/v1/entities/person/Maria/kind"},
		{http.MethodDelete, "/api/v1/entities/person/Maria"},
		{http.MethodPost, "/api/v1/entity-rejections"},
		{http.MethodDelete, "/api/v1/entity-rejections/person/Maria"},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s sem token: status %d, want 401", tc.method, tc.path, rec.Code)
		}
	}
}
