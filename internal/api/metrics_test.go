package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestPutMetricsStoresSnapshotPerDevice(t *testing.T) {
	srv := newTestServer(t)
	payload := `{"device_id":"dev_abc123","device_name":"emulador","schema":1,` +
		`"generated_at":"2026-10-16T12:00:00Z",` +
		`"writing":{"words":1234,"notes":7},` +
		`"history":{"weekly":[{"label":"12/10","words":20,"notes":2}],"calendar":[],"max_weekly":20,"max_daily":5}}`

	rec, body := doJSON(t, srv, http.MethodPut, "/api/v1/metrics", strings.NewReader(payload))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body["status"] != "ok" {
		t.Fatalf("status = %v, want ok", body["status"])
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/metrics", nil)
	snapshots, _ := list["snapshots"].([]any)
	if len(snapshots) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(snapshots))
	}
	item, _ := snapshots[0].(map[string]any)
	if item["device_id"] != "dev_abc123" {
		t.Fatalf("device_id = %v", item["device_id"])
	}
	if item["device_name"] != "emulador" {
		t.Fatalf("device_name = %v", item["device_name"])
	}
	writing, _ := item["writing"].(map[string]any)
	if writing["words"] != float64(1234) {
		t.Fatalf("writing.words = %v, want 1234", writing["words"])
	}
	history, _ := item["history"].(map[string]any)
	if history["max_weekly"] != float64(20) {
		t.Fatalf("history.max_weekly = %v, want 20", history["max_weekly"])
	}
}

// O schema 2 preserva o documento inteiro (janelas, sequencia e secoes que o
// servidor ainda nao conhece), em vez de reconstruir so escrita + historico.
func TestPutMetricsAcceptsSchema2AndPreservesDocument(t *testing.T) {
	srv := newTestServer(t)
	payload := `{"device_id":"dev_v2","device_name":"celular","schema":2,` +
		`"generated_at":"2026-10-19T12:00:00Z",` +
		`"streak":{"current":5,"longest":9,"wrote_today":true},` +
		`"windows":{"7d":{"writing":{"words":12},"topics":{"themes":[{"label":"trabalho","count":2}]}},` +
		`"30d":{"voice":{"audio_count":2}},"365d":{}},` +
		`"history":{"weekly":[]},` +
		`"extra":{"keep":true}}`

	rec, body := doJSON(t, srv, http.MethodPut, "/api/v1/metrics", strings.NewReader(payload))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body["schema"] != float64(2) {
		t.Fatalf("schema = %v, want 2", body["schema"])
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/metrics", nil)
	if list["schema"] != float64(2) {
		t.Fatalf("schema da listagem = %v, want 2", list["schema"])
	}
	snapshots, _ := list["snapshots"].([]any)
	if len(snapshots) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(snapshots))
	}
	item, _ := snapshots[0].(map[string]any)
	streak, _ := item["streak"].(map[string]any)
	if streak["current"] != float64(5) {
		t.Fatalf("streak.current = %v, want 5", streak["current"])
	}
	windows, _ := item["windows"].(map[string]any)
	seven, _ := windows["7d"].(map[string]any)
	writing, _ := seven["writing"].(map[string]any)
	if writing["words"] != float64(12) {
		t.Fatalf("windows.7d.writing.words = %v, want 12", writing["words"])
	}
	topics, _ := seven["topics"].(map[string]any)
	themes, _ := topics["themes"].([]any)
	if len(themes) != 1 {
		t.Fatalf("windows.7d.topics.themes = %v, want 1 item", themes)
	}
	extra, _ := item["extra"].(map[string]any)
	if extra["keep"] != true {
		t.Fatalf("secao desconhecida nao foi preservada: %v", item)
	}
}

func TestPutMetricsRejectsOversizedDocument(t *testing.T) {
	srv := newTestServer(t)
	payload := fmt.Sprintf(
		`{"device_id":"dev_big","schema":2,"streak":{},"windows":{},"extra":%q}`,
		strings.Repeat("a", maxMetricsPayloadBytes),
	)
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/metrics", strings.NewReader(payload))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (%s)", rec.Code, rec.Body.String())
	}
}

// O snapshot e por aparelho: reenviar substitui o anterior em vez de acumular.
func TestPutMetricsReplacesSameDevice(t *testing.T) {
	srv := newTestServer(t)
	first := `{"device_id":"dev_1","schema":1,"writing":{"words":10}}`
	second := `{"device_id":"dev_1","schema":1,"writing":{"words":99}}`

	if rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/metrics", strings.NewReader(first)); rec.Code != http.StatusOK {
		t.Fatalf("first status = %d, want 200", rec.Code)
	}
	if rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/metrics", strings.NewReader(second)); rec.Code != http.StatusOK {
		t.Fatalf("second status = %d, want 200", rec.Code)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/metrics", nil)
	snapshots, _ := list["snapshots"].([]any)
	if len(snapshots) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(snapshots))
	}
	item, _ := snapshots[0].(map[string]any)
	writing, _ := item["writing"].(map[string]any)
	if writing["words"] != float64(99) {
		t.Fatalf("writing.words = %v, want 99 (ultimo envio)", writing["words"])
	}
}

func TestPutMetricsValidatesInput(t *testing.T) {
	srv := newTestServer(t)
	cases := []struct {
		name    string
		payload string
		want    int
	}{
		{"sem device_id", `{"schema":1,"writing":{"words":1}}`, http.StatusBadRequest},
		{"device_id invalido", `{"device_id":"com espaco","schema":1,"writing":{"words":1}}`, http.StatusBadRequest},
		{"schema desconhecido", `{"device_id":"dev_1","schema":99,"writing":{"words":1}}`, http.StatusBadRequest},
		{"schema antigo demais", `{"device_id":"dev_1","schema":0,"writing":{}}`, http.StatusBadRequest},
		{"sem metricas", `{"device_id":"dev_1","schema":1}`, http.StatusBadRequest},
		{"metricas nao sao objeto", `{"device_id":"dev_1","schema":1,"writing":[1,2]}`, http.StatusBadRequest},
		{"schema 2 sem janelas", `{"device_id":"dev_1","schema":2,"streak":{}}`, http.StatusBadRequest},
		{"schema 2 sem sequencia", `{"device_id":"dev_1","schema":2,"windows":{}}`, http.StatusBadRequest},
		{"schema 2 janelas nao sao objeto", `{"device_id":"dev_1","schema":2,"windows":[]}`, http.StatusBadRequest},
		{"schema 2 streak invalido", `{"device_id":"dev_1","schema":2,"windows":{},"streak":[]}`, http.StatusBadRequest},
		{"history nao e objeto", `{"device_id":"dev_1","schema":1,"writing":{},"history":[]}`, http.StatusBadRequest},
		{"generated_at invalido", `{"device_id":"dev_1","schema":1,"generated_at":"ontem","writing":{"words":1}}`, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/metrics", strings.NewReader(tc.payload))
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

// --- corpo da nota em markdown e conflito por campo ---

func seedEntryWithNote(t *testing.T, srv *Server, entryID string) {
	t.Helper()
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateEntry(context.Background(), store.Entry{
		ID: entryID, Title: "nota", Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
}

// O corpo vai e volta byte a byte: markdown e o formato dos dois lados.
func TestNoteBodyRoundTripsMarkdown(t *testing.T) {
	srv := newTestServer(t)
	const entryID = "note_01J8Z0000000000000000000E"
	seedEntryWithNote(t, srv, entryID)

	const markdown = "## Título\n\nUm **parágrafo** com [link](https://exemplo).\n\n- item\n- outro\n\n| a | b |\n| - | - |\n"

	rec, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":`+strconv.Quote(markdown)+`}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	noteID, _ := created["id"].(string)
	if noteID == "" {
		t.Fatalf("create sem id: %v", created)
	}

	if rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID,
		strings.NewReader(`{"content_markdown":`+strconv.Quote(markdown)+`}`)); rec.Code != http.StatusOK {
		t.Fatalf("update status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}

	_, got := doJSON(t, srv, http.MethodGet, "/api/v1/notes/"+noteID, nil)
	if got["content_markdown"] != markdown {
		t.Fatalf("content_markdown =\n%v\nwant\n%v", got["content_markdown"], markdown)
	}
}

// Ler, editar e gravar de novo sem divergencia: passa, e o corpo segue igual.
func TestNoteBodyAcceptsEditWithCurrentVersion(t *testing.T) {
	srv := newTestServer(t)
	const entryID = "note_01J8Z0000000000000000000F"
	seedEntryWithNote(t, srv, entryID)

	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":"primeiro"}`))
	noteID, _ := created["id"].(string)
	version, _ := created["body_version"].(string)
	if version == "" {
		t.Fatalf("create sem body_version: %v", created)
	}

	body := `{"content_markdown":"segundo","base_version":` + strconv.Quote(version) + `}`
	rec, saved := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID, strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	versions, _ := saved["versions"].(map[string]any)
	if versions["body"] == nil || versions["body"] == version {
		t.Fatalf("a versao do corpo deveria ter mudado: %v", versions)
	}
}

// O corpo mudou no outro lugar depois que o cliente leu: 409, e nada e escrito.
func TestNoteBodyConflictDoesNotOverwrite(t *testing.T) {
	srv := newTestServer(t)
	const entryID = "note_01J8Z0000000000000000000G"
	seedEntryWithNote(t, srv, entryID)

	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":"original"}`))
	noteID, _ := created["id"].(string)
	readVersion, _ := created["body_version"].(string)

	// O desktop grava depois que o celular leu.
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID,
		strings.NewReader(`{"content_markdown":"versao do desktop"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("gravacao do desktop: status = %d", rec.Code)
	}

	// O celular tenta gravar sobre a versao antiga.
	rec, conflict := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID,
		strings.NewReader(`{"content_markdown":"meu texto","base_version":`+strconv.Quote(readVersion)+`}`))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (%s)", rec.Code, rec.Body.String())
	}
	fields, _ := conflict["conflict"].([]any)
	if len(fields) != 1 || fields[0] != "body" {
		t.Fatalf("conflict = %v, want [body]", fields)
	}

	_, got := doJSON(t, srv, http.MethodGet, "/api/v1/notes/"+noteID, nil)
	if got["content_markdown"] != "versao do desktop" {
		t.Fatalf("o conflito nao deveria ter escrito: %v", got["content_markdown"])
	}
}

// Salvar o mesmo texto nao gera revisao nova (o historico so muda quando muda).
func TestNoteBodyUnchangedWritesNoRevision(t *testing.T) {
	srv := newTestServer(t)
	const entryID = "note_01J8Z0000000000000000000H"
	seedEntryWithNote(t, srv, entryID)

	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":"igual"}`))
	noteID, _ := created["id"].(string)

	for i := 0; i < 3; i++ {
		if rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID,
			strings.NewReader(`{"content_markdown":"igual"}`)); rec.Code != http.StatusOK {
			t.Fatalf("gravacao %d: status = %d", i, rec.Code)
		}
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/notes/"+noteID+"/revisions", nil)
	revisions, _ := list["revisions"].([]any)
	if len(revisions) != 0 {
		t.Fatalf("revisoes = %d, want 0 (texto nao mudou)", len(revisions))
	}
}

func TestMetricsRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestDeleteMetricsRemovesDevice(t *testing.T) {
	srv := newTestServer(t)
	payload := `{"device_id":"dev_fantasma","schema":1,"writing":{"words":1}}`
	if rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/metrics", strings.NewReader(payload)); rec.Code != http.StatusOK {
		t.Fatalf("put status = %d, want 200", rec.Code)
	}

	rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/metrics/dev_fantasma", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204 (%s)", rec.Code, rec.Body.String())
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/metrics", nil)
	snapshots, _ := list["snapshots"].([]any)
	if len(snapshots) != 0 {
		t.Fatalf("snapshots = %d, want 0", len(snapshots))
	}

	if rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/metrics/dev_fantasma", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404", rec.Code)
	}
}
