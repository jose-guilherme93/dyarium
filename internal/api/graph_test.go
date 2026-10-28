package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestGraphRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/graph", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("graph sem token = %d, queria 401", rec.Code)
	}
}

func TestGraphEgoAndFocus(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.5, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "Maria", Count: 3},
		{Kind: store.EntityTheme, Name: "trabalho", Count: 1},
	})
	seedRichEntry(t, srv, "e2", now, 0.2, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "Maria", Count: 1},
		{Kind: store.EntityPlace, Name: "Recife", Count: 1},
	})

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/graph", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("graph = %d %s", rec.Code, rec.Body.String())
	}
	center, _ := body["center"].(map[string]any)
	if center["label"] != "Você" {
		t.Fatalf("centro = %+v", center)
	}
	nodes, _ := body["nodes"].([]any)
	if len(nodes) != 3 {
		t.Fatalf("nos = %+v", nodes)
	}
	edges, _ := body["edges"].([]any)
	if len(edges) == 0 {
		t.Fatalf("sem arestas: %+v", body)
	}
	var mariaID string
	for _, raw := range nodes {
		node, _ := raw.(map[string]any)
		if node["label"] == "Maria" {
			mariaID, _ = node["id"].(string)
		}
	}
	if mariaID == "" {
		t.Fatalf("Maria ausente: %+v", nodes)
	}

	rec, focus := doJSON(t, srv, http.MethodGet, "/api/v1/graph?focus="+url.QueryEscape(mariaID), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("focus = %d %s", rec.Code, rec.Body.String())
	}
	var notes, mentions int
	focusNodes, _ := focus["nodes"].([]any)
	for _, raw := range focusNodes {
		node, _ := raw.(map[string]any)
		if node["kind"] == "note" {
			notes++
		}
	}
	focusEdges, _ := focus["edges"].([]any)
	for _, raw := range focusEdges {
		edge, _ := raw.(map[string]any)
		if edge["kind"] == "mention" {
			mentions++
		}
	}
	if notes != 2 || mentions < 3 {
		t.Fatalf("foco = %d notas, %d mencoes (%+v)", notes, mentions, focus)
	}

	rec, _ = doJSON(t, srv, http.MethodGet, "/api/v1/graph?focus=person:nao-existe", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foco inexistente = %d", rec.Code)
	}
}

func TestAuthorSettingsAndEntryAuthor(t *testing.T) {
	srv := newTestServer(t)
	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("settings = %d", rec.Code)
	}
	if body["owner_name"] != "" || body["all_notes_mine"] != true {
		t.Fatalf("padroes de autor = %+v", body)
	}

	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/settings",
		strings.NewReader(`{"owner_name":"  Ana  ","all_notes_mine":false}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("put settings = %d %s", rec.Code, rec.Body.String())
	}
	_, body = doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
	if body["owner_name"] != "Ana" || body["all_notes_mine"] != false {
		t.Fatalf("settings de autor = %+v", body)
	}

	rec, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"citacao","author":"other"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", rec.Code, rec.Body.String())
	}
	if created["author"] != "other" {
		t.Fatalf("autor criado = %+v", created)
	}
	entryID, _ := created["id"].(string)

	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"author":"mixed"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d %s", rec.Code, rec.Body.String())
	}
	_, body = doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if body["author"] != "mixed" {
		t.Fatalf("autor depois do patch = %+v", body)
	}

	// Vazio volta a seguir o padrao da instancia.
	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"author":""}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("limpar autor = %d", rec.Code)
	}
	_, body = doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if body["author"] != "" {
		t.Fatalf("autor limpo = %+v", body)
	}

	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"author":"bogus"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("autor invalido = %d", rec.Code)
	}

	longName := strings.Repeat("a", 81)
	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/settings",
		strings.NewReader(`{"owner_name":"`+longName+`"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("nome longo = %d", rec.Code)
	}
}

func TestGraphCenterUsesOwnerName(t *testing.T) {
	srv := newTestServer(t)
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/settings",
		strings.NewReader(`{"owner_name":"José"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("settings = %d", rec.Code)
	}
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.5, []store.EntityLink{{Kind: store.EntityPerson, Name: "Maria", Count: 1}})
	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/graph", nil)
	center, _ := body["center"].(map[string]any)
	if center["label"] != "José" {
		t.Fatalf("centro = %+v", center)
	}
}

func TestRenameEntityEndpointAndDecisionNodes(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.2, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "Maria", Count: 2},
		{Kind: store.EntityDecision, Name: "Comprar leite", Count: 1},
	})

	rec, body := doJSON(t, srv, http.MethodPatch, "/api/v1/entities/person/Maria",
		strings.NewReader(`{"name":"Marianna"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("rename = %d %s", rec.Code, rec.Body.String())
	}
	if body["name"] != "Marianna" {
		t.Fatalf("rename respondeu %+v", body)
	}
	rec, body = doJSON(t, srv, http.MethodGet, "/api/v1/entities/person/Maria", nil)
	if rec.Code != http.StatusOK || body["name"] != "Marianna" {
		t.Fatalf("alias = %d %+v", rec.Code, body)
	}

	rec, body = doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=decision", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("decisoes = %d", rec.Code)
	}
	entities, _ := body["entities"].([]any)
	if len(entities) != 1 {
		t.Fatalf("decisoes = %+v", entities)
	}
	decision, _ := entities[0].(map[string]any)
	if decision["name"] != "Comprar leite" || decision["kind"] != "decision" {
		t.Fatalf("decisao = %+v", decision)
	}

	_, graph := doJSON(t, srv, http.MethodGet, "/api/v1/graph", nil)
	nodes, _ := graph["nodes"].([]any)
	found := false
	for _, raw := range nodes {
		node, _ := raw.(map[string]any)
		if node["kind"] == "decision" && node["label"] == "Comprar leite" {
			found = true
		}
	}
	if !found {
		t.Fatalf("decisao ausente do grafo: %+v", nodes)
	}
}

func TestAnalysisNamesFollowRename(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	entry := store.Entry{ID: "e1", Title: "nota", Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}
	if err := srv.deps.Store.CreateEntry(context.Background(), entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := srv.deps.Store.SaveRichAnalysis(context.Background(), store.Analysis{
		ID: "a1", EntryID: "e1", CreatedAt: now,
		People:  `["Maria"]`,
		Places:  `["Recife"]`,
		Summary: "Maria chegou em Recife",
		Data: `{"people":[{"name":"Maria","count":2,"relation":"","sentiment":0.2}],` +
			`"places":[{"name":"Recife","count":1}],` +
			`"themes":[{"name":"familia","confidence":0.8}],` +
			`"decisions":["Comprar leite"],` +
			`"reading":"Maria chegou em Recife",` +
			`"key_moments":[{"start_ms":1000,"text":"Maria falou"}],` +
			`"sections":[{"heading":"Casa","kind":"text","reading":"Maria chegou","summary":"","sentiment":{"score":0,"label":"neutro"},"themes":[{"name":"familia","confidence":0.8}],"key_moments":[],"questions":[],"decisions":["Comprar leite"]}]}`,
	}, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "Maria", Count: 2},
		{Kind: store.EntityPlace, Name: "Recife", Count: 1},
		{Kind: store.EntityTheme, Name: "familia", Count: 1},
		{Kind: store.EntityDecision, Name: "Comprar leite", Count: 1},
	}); err != nil {
		t.Fatalf("save analysis: %v", err)
	}

	for _, rename := range []struct{ kind, old, next string }{
		{store.EntityPerson, "Maria", "Marianna"},
		{store.EntityPlace, "Recife", "Recife Antigo"},
		{store.EntityTheme, "familia", "família"},
		{store.EntityDecision, "Comprar leite", "Comprar pão"},
	} {
		rec, _ := doJSON(t, srv, http.MethodPatch,
			"/api/v1/entities/"+rename.kind+"/"+url.PathEscape(rename.old),
			strings.NewReader(`{"name":"`+rename.next+`"}`))
		if rec.Code != http.StatusOK {
			t.Fatalf("rename %s: %d %s", rename.kind, rec.Code, rec.Body.String())
		}
	}

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/analysis", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("analysis = %d %s", rec.Code, rec.Body.String())
	}
	people, _ := body["people"].([]any)
	if len(people) != 1 || people[0] != "Marianna" {
		t.Fatalf("people = %+v", people)
	}
	detail, _ := body["people_detail"].([]any)
	first, _ := detail[0].(map[string]any)
	if first["name"] != "Marianna" {
		t.Fatalf("people_detail = %+v", detail)
	}
	places, _ := body["places"].([]any)
	if len(places) != 1 || places[0] != "Recife Antigo" {
		t.Fatalf("places = %+v", places)
	}
	themes, _ := body["themes"].([]any)
	theme, _ := themes[0].(map[string]any)
	if theme["name"] != "família" {
		t.Fatalf("themes = %+v", themes)
	}
	decisions, _ := body["decisions"].([]any)
	if len(decisions) != 1 || decisions[0] != "Comprar pão" {
		t.Fatalf("decisions = %+v", decisions)
	}
	if body["summary"] != "Marianna chegou em Recife Antigo" {
		t.Fatalf("summary = %q", body["summary"])
	}
	if body["reading"] != "Marianna chegou em Recife Antigo" {
		t.Fatalf("reading = %q", body["reading"])
	}
	moments, _ := body["key_moments"].([]any)
	moment, _ := moments[0].(map[string]any)
	if moment["text"] != "Marianna falou" {
		t.Fatalf("momento = %+v", moments)
	}
}

func TestClaimSelfEndpointMergesPersonIntoOwner(t *testing.T) {
	srv := newTestServer(t)
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/settings",
		strings.NewReader(`{"owner_name":"joseti"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("settings = %d", rec.Code)
	}
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.2, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "José Guilherme", Count: 2},
		{Kind: store.EntityPerson, Name: "Maria", Count: 1},
	})

	path := "/api/v1/entities/person/" + url.PathEscape("José Guilherme") + "/self"
	rec, body := doJSON(t, srv, http.MethodPost, path, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("claim = %d %s", rec.Code, rec.Body.String())
	}
	if body["owner"] != "joseti" {
		t.Fatalf("dono = %+v", body)
	}

	// A pessoa some do mapa; o centro continua sendo o dono.
	_, graph := doJSON(t, srv, http.MethodGet, "/api/v1/graph", nil)
	nodes, _ := graph["nodes"].([]any)
	if len(nodes) != 1 {
		t.Fatalf("nos depois do claim = %+v", nodes)
	}
	if node, _ := nodes[0].(map[string]any); node["label"] != "Maria" {
		t.Fatalf("sobrou %+v", nodes[0])
	}

	rec, _ = doJSON(t, srv, http.MethodGet, "/api/v1/entities/person/"+url.PathEscape("José Guilherme"), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("grafia antiga ainda e uma pessoa: %d", rec.Code)
	}
}

func TestEntityIconEndpoint(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.2, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "Maria", Count: 1},
	})
	rec, body := doJSON(t, srv, http.MethodPut, "/api/v1/entities/person/Maria/icon",
		strings.NewReader(`{"icon":"heart"}`))
	if rec.Code != http.StatusOK || body["icon"] != "heart" {
		t.Fatalf("set icon = %d %+v", rec.Code, body)
	}
	_, graph := doJSON(t, srv, http.MethodGet, "/api/v1/graph", nil)
	nodes, _ := graph["nodes"].([]any)
	if len(nodes) != 1 {
		t.Fatalf("nos = %+v", nodes)
	}
	if node, _ := nodes[0].(map[string]any); node["icon"] != "heart" {
		t.Fatalf("no sem icone = %+v", nodes[0])
	}
	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/entities/person/Maria/icon",
		strings.NewReader(`{"icon":"bogus"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("icone invalido = %d", rec.Code)
	}
}

func TestGraphRejectsUnknownNotebookAndFocusDecision(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.3, []store.EntityLink{
		{Kind: store.EntityDecision, Name: "Comprar leite", Count: 1},
	})

	rec, _ := doJSON(t, srv, http.MethodGet, "/api/v1/graph?notebook_id=nao-existe", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("caderno inexistente = %d, queria 404", rec.Code)
	}

	_, graph := doJSON(t, srv, http.MethodGet, "/api/v1/graph", nil)
	nodes, _ := graph["nodes"].([]any)
	var decisionID string
	for _, raw := range nodes {
		node, _ := raw.(map[string]any)
		if node["kind"] == "decision" {
			decisionID, _ = node["id"].(string)
		}
	}
	if decisionID == "" {
		t.Fatalf("decisao ausente do grafo: %+v", nodes)
	}

	// Duplo clique numa decisao abre o grafo local dela, como em qualquer no.
	rec, focus := doJSON(t, srv, http.MethodGet, "/api/v1/graph?focus="+url.QueryEscape(decisionID), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("foco na decisao = %d %s", rec.Code, rec.Body.String())
	}
	focusNodes, _ := focus["nodes"].([]any)
	var notes int
	for _, raw := range focusNodes {
		node, _ := raw.(map[string]any)
		if node["kind"] == "note" && node["label"] == "entrada e1" {
			notes++
		}
	}
	if notes != 1 {
		t.Fatalf("foco da decisao sem a nota: %+v", focusNodes)
	}
	focusEdges, _ := focus["edges"].([]any)
	mention := false
	for _, raw := range focusEdges {
		edge, _ := raw.(map[string]any)
		if edge["kind"] == "mention" && edge["target"] == decisionID {
			mention = true
		}
	}
	if !mention {
		t.Fatalf("foco da decisao sem aresta de mencao: %+v", focusEdges)
	}
}

func TestMergeCanonicalizesTranscriptAndPreview(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	seedPlainEntry(t, srv, "e1")
	now := time.Now().UTC()
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t1", EntryID: "e1", Model: "whisper", Text: "Hoje falei com Mariana", CreatedAt: now,
	}, []store.Segment{{
		ID: "s1", StartMS: 0, EndMS: 1000, Text: "Hoje falei com Mariana", CreatedAt: now,
	}}); err != nil {
		t.Fatalf("transcript: %v", err)
	}
	seedRichEntry(t, srv, "e2", now, 0.1, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "Mariana", Count: 1},
	})
	rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entities/person/Mariana",
		strings.NewReader(`{"name":"Marianna"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("rename = %d", rec.Code)
	}

	// A transcricao visivel resolve a grafia antiga para a sobrevivente.
	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/transcript", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("transcript = %d", rec.Code)
	}
	if body["text"] != "Hoje falei com Marianna" {
		t.Fatalf("texto = %v", body["text"])
	}
	segments, _ := body["segments"].([]any)
	if len(segments) != 1 {
		t.Fatalf("segmentos = %+v", segments)
	}
	if seg, _ := segments[0].(map[string]any); seg["text"] != "Hoje falei com Marianna" {
		t.Fatalf("segmento = %+v", segments[0])
	}

	// A pagina de segmentos que o painel do audio carrega sob demanda tambem.
	rec, page := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/segments", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("segments = %d", rec.Code)
	}
	pageSegs, _ := page["segments"].([]any)
	if len(pageSegs) != 1 {
		t.Fatalf("pagina = %+v", page["segments"])
	}
	if seg, _ := pageSegs[0].(map[string]any); seg["text"] != "Hoje falei com Marianna" {
		t.Fatalf("pagina do segmento = %+v", pageSegs[0])
	}

	// A previa da lista, quando vem da transcricao, tambem.
	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	entries, _ := list["entries"].([]any)
	for _, raw := range entries {
		item, _ := raw.(map[string]any)
		if item["id"] == "e1" {
			if item["preview"] != "Hoje falei com Marianna" {
				t.Fatalf("previa = %v", item["preview"])
			}
			return
		}
	}
	t.Fatalf("entrada e1 nao apareceu na lista")
}
