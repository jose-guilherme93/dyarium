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
		"places":["Recife"],
		"themes":[{"name":"familia","confidence":0.7}],
		"summary":"Um dia bom.",
		"reading":"A nota fala de um encontro.",
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
