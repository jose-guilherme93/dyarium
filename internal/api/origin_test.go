package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// createNoteWithOrigin cria uma nota de texto e devolve o JSON da entrada.
func createNoteWithOrigin(t *testing.T, srv *Server, origin string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/entries", strings.NewReader(`{"title":"nota"}`))
	req.Header.Set("Authorization", "Bearer token-de-teste")
	if origin != "" {
		req.Header.Set("X-Origin-Instance", origin)
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return parsed
}

func TestCreateEntryRecordsOriginOfTheCreator(t *testing.T) {
	srv := newTestServer(t)

	fromApp := createNoteWithOrigin(t, srv, "dev_01J8Z")
	if fromApp["origin_kind"] != "device" || fromApp["origin_instance"] != "dev_01J8Z" {
		t.Fatalf("origem do app = %v/%v", fromApp["origin_instance"], fromApp["origin_kind"])
	}

	// Sem cabecalho (dashboard/API): o criador e o proprio ambiente.
	fromServer := createNoteWithOrigin(t, srv, "")
	if fromServer["origin_kind"] != "server" || fromServer["origin_instance"] != "instancia-de-teste" {
		t.Fatalf("origem do servidor = %v/%v", fromServer["origin_instance"], fromServer["origin_kind"])
	}

	// Cabecalho invalido nao vira origem: cai no ambiente.
	invalid := createNoteWithOrigin(t, srv, "builder <script>")
	if invalid["origin_kind"] != "server" {
		t.Fatalf("cabecalho invalido virou origem: %v", invalid["origin_kind"])
	}
}

// O manifesto tambem leva a origem, para o app saber que a nota veio de fora.
func TestManifestCarriesOrigin(t *testing.T) {
	srv := newTestServer(t)
	created := createNoteWithOrigin(t, srv, "dev_01J8Z")
	id, _ := created["id"].(string)

	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/sync/manifest?kind=entries", nil)
	items, _ := body["items"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["id"] != id {
			continue
		}
		if item["origin_kind"] != "device" || item["origin_instance"] != "dev_01J8Z" {
			t.Fatalf("origem no manifesto = %v/%v", item["origin_instance"], item["origin_kind"])
		}
		return
	}
	t.Fatalf("entrada %q nao apareceu no manifesto", id)
}
