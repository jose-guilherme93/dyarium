package api

import (
	"net/http"
	"strings"
	"testing"
)

func notebookByName(t *testing.T, body map[string]any, name string) map[string]any {
	t.Helper()
	notebooks, _ := body["notebooks"].([]any)
	for _, item := range notebooks {
		notebook := item.(map[string]any)
		if notebook["name"] == name {
			return notebook
		}
	}
	t.Fatalf("caderno %q ausente de %v", name, notebooks)
	return nil
}

func TestNotebooksLifecycle(t *testing.T) {
	srv := newTestServer(t)

	_, listed := doJSON(t, srv, http.MethodGet, "/api/v1/notebooks", nil)
	notebooks, _ := listed["notebooks"].([]any)
	if len(notebooks) != 1 {
		t.Fatalf("cadernos iniciais = %+v", notebooks)
	}
	defaultNotebook := notebooks[0].(map[string]any)
	if defaultNotebook["name"] != "Notas ao acaso" || defaultNotebook["is_default"] != true {
		t.Fatalf("caderno padrao = %+v", defaultNotebook)
	}
	defaultID := defaultNotebook["id"].(string)

	rec, created := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Trabalho","color":"#C7D8F2"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar caderno: status %d (%s)", rec.Code, rec.Body.String())
	}
	workID := created["id"].(string)

	// A nota nasce no caderno pedido e a listagem filtra por ele.
	rec, entry := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"reuniao","notebook_id":"`+workID+`"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar nota: status %d (%s)", rec.Code, rec.Body.String())
	}
	if entry["notebook_id"] != workID {
		t.Fatalf("notebook_id = %v, want %s", entry["notebook_id"], workID)
	}
	_, work := doJSON(t, srv, http.MethodGet, "/api/v1/entries?notebook_id="+workID, nil)
	if countEntries(work) != 1 {
		t.Fatalf("notas do trabalho = %+v", work)
	}
	_, misc := doJSON(t, srv, http.MethodGet, "/api/v1/entries?notebook_id="+defaultID, nil)
	if countEntries(misc) != 0 {
		t.Fatalf("notas do caderno padrao = %+v", misc)
	}

	// Mover a nota pelo PATCH.
	entryID := entry["id"].(string)
	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"notebook_id":"`+defaultID+`"}`)); rec.Code != http.StatusOK {
		t.Fatalf("mover nota: status %d", rec.Code)
	}
	_, misc = doJSON(t, srv, http.MethodGet, "/api/v1/entries?notebook_id="+defaultID, nil)
	if countEntries(misc) != 1 {
		t.Fatalf("nota deveria estar no caderno padrao: %+v", misc)
	}

	// Renomear e recolorir.
	rec, renamed := doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+workID,
		strings.NewReader(`{"name":"Estudo","color":"#C9E4C5"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("renomear caderno: status %d (%s)", rec.Code, rec.Body.String())
	}
	if renamed["name"] != "Estudo" || renamed["color"] != "#C9E4C5" {
		t.Fatalf("caderno renomeado = %+v", renamed)
	}

	// Excluir move as notas para o caderno padrao.
	if rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/notebooks/"+workID, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("excluir caderno: status %d", rec.Code)
	}
	_, detail := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if detail["notebook_id"] != defaultID {
		t.Fatalf("notebook_id depois da exclusao = %v, want %s", detail["notebook_id"], defaultID)
	}
}

func TestDefaultNotebookIsProtected(t *testing.T) {
	srv := newTestServer(t)
	_, listed := doJSON(t, srv, http.MethodGet, "/api/v1/notebooks", nil)
	defaultID := listed["notebooks"].([]any)[0].(map[string]any)["id"].(string)

	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+defaultID,
		strings.NewReader(`{"name":"Outro"}`)); rec.Code != http.StatusConflict {
		t.Fatalf("renomear padrao: status %d, want 409", rec.Code)
	}
	if rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/notebooks/"+defaultID, nil); rec.Code != http.StatusConflict {
		t.Fatalf("excluir padrao: status %d, want 409", rec.Code)
	}
}

func TestNotebookRejectsInvalidColor(t *testing.T) {
	srv := newTestServer(t)
	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Trabalho","color":"red"}`)); rec.Code != http.StatusBadRequest {
		t.Fatalf("cor invalida: status %d, want 400", rec.Code)
	}
}

func TestNotebookNameConflict(t *testing.T) {
	srv := newTestServer(t)
	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Trabalho"}`)); rec.Code != http.StatusCreated {
		t.Fatalf("criar: status %d", rec.Code)
	}
	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"trabalho"}`)); rec.Code != http.StatusConflict {
		t.Fatalf("duplicado: status %d, want 409", rec.Code)
	}
	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Notas ao acaso"}`)); rec.Code != http.StatusConflict {
		t.Fatalf("nome do padrao: status %d, want 409", rec.Code)
	}
}

func TestTagRenameMerges(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	seedPlainEntry(t, srv, "e2")
	doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/tags", strings.NewReader(`{"tags":["viagem"]}`))
	doJSON(t, srv, http.MethodPut, "/api/v1/entries/e2/tags", strings.NewReader(`{"tags":["ferias"]}`))

	_, listed := doJSON(t, srv, http.MethodGet, "/api/v1/tags", nil)
	tags, _ := listed["tags"].([]any)
	var sourceID, targetID string
	for _, item := range tags {
		tag := item.(map[string]any)
		switch tag["name"] {
		case "viagem":
			sourceID = tag["id"].(string)
		case "ferias":
			targetID = tag["id"].(string)
		}
		if color, _ := tag["color"].(string); color == "" {
			t.Fatalf("tag sem cor: %+v", tag)
		}
	}
	if sourceID == "" || targetID == "" {
		t.Fatalf("tags de teste ausentes: %+v", tags)
	}

	rec, merged := doJSON(t, srv, http.MethodPatch, "/api/v1/tags/"+sourceID,
		strings.NewReader(`{"name":"ferias"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("mesclar tag: status %d (%s)", rec.Code, rec.Body.String())
	}
	if merged["id"] != targetID || merged["merged"] != true {
		t.Fatalf("resultado da mescla = %+v", merged)
	}

	_, entryTags := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/tags", nil)
	got, _ := entryTags["tags"].([]any)
	if len(got) != 1 || got[0].(map[string]any)["name"] != "ferias" {
		t.Fatalf("tags de e1 depois da mescla = %+v", got)
	}
}

func TestEntryRequiresValidNotebook(t *testing.T) {
	srv := newTestServer(t)
	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"x","notebook_id":"nao-existe"}`)); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("criar com caderno invalido: status %d, want 422", rec.Code)
	}
	seedPlainEntry(t, srv, "e1")
	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/e1",
		strings.NewReader(`{"notebook_id":"nao-existe"}`)); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("mover para caderno invalido: status %d, want 422", rec.Code)
	}
	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/e1",
		strings.NewReader(`{"notebook_id":""}`)); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("caderno vazio: status %d, want 422", rec.Code)
	}
}
