package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func doJSON(t *testing.T, srv *Server, method, path string, body io.Reader) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	req.Header.Set("Authorization", "Bearer token-de-teste")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	var parsed map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
			t.Fatalf("decode %s: %v", path, err)
		}
	}
	return rec, parsed
}

func seedRichEntry(t *testing.T, srv *Server, id string, when time.Time, sentiment float64, links []store.EntityLink) {
	t.Helper()
	ctx := context.Background()
	entry := store.Entry{ID: id, Title: "entrada " + id, Status: store.EntryStored, Source: "upload", CreatedAt: when, UpdatedAt: when}
	if err := srv.deps.Store.CreateEntry(ctx, entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	analysis := store.Analysis{
		ID: "a-" + id, EntryID: id, Model: "m", Sentiment: sentiment, SentimentLabel: "positivo",
		Data:      `{"sentiment":{"score":0.5,"label":"positivo"},"themes":[{"name":"familia","confidence":0.9}],"key_moments":[{"start_ms":1000,"text":"oi"}],"questions":["e agora?"],"decisions":[]}`,
		CreatedAt: when,
	}
	if err := srv.deps.Store.SaveRichAnalysis(ctx, analysis, links); err != nil {
		t.Fatalf("save rich analysis: %v", err)
	}
}

func TestCreateTextEntry(t *testing.T) {
	srv := newTestServer(t)
	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries", strings.NewReader(`{"title":"Ideia escrita"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body %s", rec.Code, rec.Body.String())
	}
	if body["title"] != "Ideia escrita" || body["source"] != "text" {
		t.Fatalf("entrada = %+v", body)
	}
	rec, body = doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	entries, _ := body["entries"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %+v", entries)
	}
}

func TestEntitiesRequireAuth(t *testing.T) {
	srv := newTestServer(t)
	for _, path := range []string{"/api/v1/entities", "/api/v1/mood", "/api/v1/entities/person/Maria"} {
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s sem token: status = %d, want 401", path, rec.Code)
		}
	}
}

func TestListEntitiesAndDetail(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.5, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "Maria", Count: 3, Relation: "irma", Sentiment: floatPtr(0.4)},
		{Kind: store.EntityPlace, Name: "Recife", Count: 2},
	})

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=person", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	entities, _ := body["entities"].([]any)
	if len(entities) != 1 {
		t.Fatalf("entities = %+v", body)
	}
	first, _ := entities[0].(map[string]any)
	if first["name"] != "Maria" || first["mentions"].(float64) != 3 {
		t.Fatalf("entidade = %+v", first)
	}

	rec, _ = doJSON(t, srv, http.MethodGet, "/api/v1/entities?kind=bogus", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("kind invalido: status = %d, want 400", rec.Code)
	}

	rec, body = doJSON(t, srv, http.MethodGet, "/api/v1/entities/person/Maria", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("detalhe status = %d", rec.Code)
	}
	list, _ := body["entry_list"].([]any)
	if body["name"] != "Maria" || len(list) != 1 {
		t.Fatalf("detalhe = %+v", body)
	}

	rec, _ = doJSON(t, srv, http.MethodGet, "/api/v1/entities/person/Ninguem", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("entidade inexistente: status = %d, want 404", rec.Code)
	}
}

func TestListEntriesFilteredByEntity(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.5, []store.EntityLink{{Kind: store.EntityPerson, Name: "Maria", Count: 1}})
	seedRichEntry(t, srv, "e2", now, 0.5, []store.EntityLink{{Kind: store.EntityPerson, Name: "Joao", Count: 1}})

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries?person=Maria", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	entries, _ := body["entries"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %+v", entries)
	}
	if entries[0].(map[string]any)["id"] != "e1" {
		t.Fatalf("entrada errada: %+v", entries[0])
	}
}

func TestMoodEndpoint(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.4, nil)

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/mood", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	mood, _ := body["mood"].([]any)
	if len(mood) != 1 {
		t.Fatalf("mood = %+v", body)
	}
	point, _ := mood[0].(map[string]any)
	if point["sentiment"].(float64) != 0.4 {
		t.Fatalf("ponto = %+v", point)
	}
}

func TestAnalysisIncludesRichFields(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedRichEntry(t, srv, "e1", now, 0.5, nil)

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/analysis", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body["sentiment_label"] != "positivo" {
		t.Fatalf("sentiment_label = %v", body["sentiment_label"])
	}
	if _, ok := body["themes"].([]any); !ok {
		t.Fatalf("themes ausente: %+v", body)
	}
	if _, ok := body["key_moments"].([]any); !ok {
		t.Fatalf("key_moments ausente: %+v", body)
	}
}

func TestListAnalyzeModelsRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/analyze/models", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sem token: status = %d, want 401", rec.Code)
	}
}

func TestListAnalyzeModels(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{{"id": "qwen3.8-flash"}, {"id": "glm-5.3-flash"}},
		})
	}))
	defer provider.Close()

	srv := newTestServer(t)
	if err := srv.deps.Store.SetSetting(context.Background(), "analyze_base_url", provider.URL); err != nil {
		t.Fatalf("set base url: %v", err)
	}

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/analyze/models", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	models, _ := body["models"].([]any)
	if len(models) != 2 || models[0] != "qwen3.8-flash" {
		t.Fatalf("models = %+v", body)
	}
}

func TestSettingsExposeThemes(t *testing.T) {
	srv := newTestServer(t)
	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d", rec.Code)
	}
	if body["analysis_themes"] == "" {
		t.Fatalf("analysis_themes sem default: %+v", body)
	}

	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/settings",
		strings.NewReader(`{"analysis_themes":"trabalho, casa"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("put status = %d", rec.Code)
	}
	_, body = doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
	if body["analysis_themes"] != "trabalho, casa" {
		t.Fatalf("analysis_themes = %v", body["analysis_themes"])
	}
}

func floatPtr(v float64) *float64 { return &v }
