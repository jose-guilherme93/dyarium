package api

import (
	"net/http"
	"strings"
	"testing"
)

// A analise feita no aparelho sobe e o dashboard passa a ve-la, com a origem
// marcada.
func TestPutAnalysisStoresOrigin(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")

	body := `{
		"model":"gemma-3-270m",
		"sentiment":0.4,
		"sentiment_label":"positivo",
		"emotions":{"alegria":0.8},
		"people":["Ana"],
		"people_detail":[{"name":"Ana","count":3,"sentiment":-0.2}],
		"places":["Recife"],
		"places_detail":[{"name":"Recife","count":2}],
		"themes":[{"name":"familia","confidence":0.7}],
		"summary":"Um dia bom.",
		"reading":"A nota fala de um encontro.",
		"decisions":["vou viajar"],
		"tasks":["comprar a passagem"],
		"ideas":["escrever um livro"],
		"events":["enterro da Ana"],
		"coverage":{"blocks_read":4,"blocks_total":4,"chars_read":900,"chars_total":900,"audio_ms":8000,"partial":false},
		"schema_version":2,
		"sentence_source":"model",
		"comprehension":80,
		"comprehension_source":"review",
		"stutter_rate":1.5,
		"hesitation_rate":0.5,
		"revised_segments":2
	}`
	rec, payload := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/analysis", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put analysis: %d %s", rec.Code, rec.Body.String())
	}
	if payload["stored"] != true {
		t.Fatalf("stored = %v", payload["stored"])
	}

	_, got := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/analysis", nil)
	if got["origin"] != "app" {
		t.Fatalf("origin = %v", got["origin"])
	}
	if got["model"] != "gemma-3-270m" || got["summary"] != "Um dia bom." {
		t.Fatalf("analise = %v", got)
	}
	if got["comprehension"].(float64) != 80 {
		t.Fatalf("comprehension = %v", got["comprehension"])
	}
	for _, field := range []string{"tasks", "ideas", "events", "decisions"} {
		list, ok := got[field].([]any)
		if !ok || len(list) != 1 {
			t.Fatalf("%s = %v", field, got[field])
		}
	}
	if got["schema_version"].(float64) != 2 || got["sentence_source"] != "model" {
		t.Fatalf("contrato = %v / %v", got["schema_version"], got["sentence_source"])
	}
	coverage, ok := got["coverage"].(map[string]any)
	if !ok || coverage["blocks_read"].(float64) != 4 || coverage["audio_ms"].(float64) != 8000 {
		t.Fatalf("coverage = %v", got["coverage"])
	}
	people, ok := got["people_detail"].([]any)
	if !ok || len(people) != 1 {
		t.Fatalf("people_detail = %v", got["people_detail"])
	}
	person := people[0].(map[string]any)
	if person["count"].(float64) != 3 {
		t.Fatalf("contagem de mencoes = %v", person["count"])
	}
}

// Sync nunca sobrescreve: a segunda analise so entra com replace explicito.
func TestPutAnalysisFirstArrivalWins(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")

	first := `{"model":"a","sentiment":0.2,"summary":"primeira"}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/analysis", strings.NewReader(first))
	if rec.Code != http.StatusOK {
		t.Fatalf("primeira: %d", rec.Code)
	}

	second := `{"model":"b","sentiment":-0.2,"summary":"segunda"}`
	rec, payload := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/analysis", strings.NewReader(second))
	if rec.Code != http.StatusOK {
		t.Fatalf("segunda: %d", rec.Code)
	}
	if payload["stored"] != false {
		t.Fatalf("segunda deveria ser ignorada: %v", payload)
	}
	_, got := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/analysis", nil)
	if got["summary"] != "primeira" {
		t.Fatalf("summary = %v", got["summary"])
	}

	replace := `{"model":"b","sentiment":-0.2,"summary":"refeita","replace":true}`
	rec, payload = doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/analysis", strings.NewReader(replace))
	if rec.Code != http.StatusOK || payload["stored"] != true {
		t.Fatalf("refazer: %d %v", rec.Code, payload)
	}
	_, got = doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/analysis", nil)
	if got["summary"] != "refeita" {
		t.Fatalf("summary apos refazer = %v", got["summary"])
	}
}

func TestPutAnalysisUnknownEntry(t *testing.T) {
	srv := newTestServer(t)
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/nada/analysis", strings.NewReader(`{"summary":"x"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
}

// A analise do navegador guarda o aparelho que processou, para o painel dizer
// que aquilo rodou localmente naquele computador.
func TestPutAnalysisStoresBrowserDevice(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")

	body := `{
		"model":"lfm2.5-230m-q5",
		"sentiment":0.1,
		"sentiment_label":"neutro",
		"summary":"Resumo.",
		"origin":"browser",
		"device_id":"dev-abc123",
		"device_name":"Edge 156 · Windows · Intel HD Graphics 620"
	}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/analysis", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put analysis: %d %s", rec.Code, rec.Body.String())
	}

	_, got := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/analysis", nil)
	if got["origin"] != "browser" {
		t.Fatalf("origin = %v", got["origin"])
	}
	if got["device_id"] != "dev-abc123" {
		t.Fatalf("device_id = %v", got["device_id"])
	}
	if got["device_name"] != "Edge 156 · Windows · Intel HD Graphics 620" {
		t.Fatalf("device_name = %v", got["device_name"])
	}
}

// O aparelho so vale para a origem "browser": uma analise da API nao pode se
// passar por processada localmente.
func TestPutAnalysisDeviceIgnoredOutsideBrowser(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")

	body := `{
		"model":"glm",
		"sentiment":0.1,
		"sentiment_label":"neutro",
		"summary":"Resumo.",
		"origin":"api",
		"device_id":"dev-abc123",
		"device_name":"Edge 156"
	}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/analysis", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put analysis: %d %s", rec.Code, rec.Body.String())
	}

	_, got := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/analysis", nil)
	if got["origin"] != "app" {
		t.Fatalf("origin = %v", got["origin"])
	}
	if got["device_id"] != "" || got["device_name"] != "" {
		t.Fatalf("aparelho vazou para origem nao-browser: %v / %v", got["device_id"], got["device_name"])
	}
}
