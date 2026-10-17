package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
		{"sem metricas", `{"device_id":"dev_1","schema":1}`, http.StatusBadRequest},
		{"metricas nao sao objeto", `{"device_id":"dev_1","schema":1,"writing":[1,2]}`, http.StatusBadRequest},
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
