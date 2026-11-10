package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestEntryIconPayload(t *testing.T) {
	srv := newTestServer(t)

	rec, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"Projeto"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", rec.Code, rec.Body.String())
	}
	if icon, ok := created["icon"]; !ok || icon != "" {
		t.Fatalf("created icon = %v, want empty", created["icon"])
	}
	entryID, _ := created["id"].(string)
	if entryID == "" {
		t.Fatal("created entry has no id")
	}

	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"icon":"🌿"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch icon status = %d: %s", rec.Code, rec.Body.String())
	}
	_, entry := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if entry["icon"] != "🌿" {
		t.Fatalf("patched icon = %v, want 🌿", entry["icon"])
	}

	// Um patch sem icon preserva o valor gravado.
	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"Outro"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch title status = %d: %s", rec.Code, rec.Body.String())
	}
	_, entry = doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if entry["icon"] != "🌿" {
		t.Fatalf("icon after title patch = %v, want 🌿", entry["icon"])
	}

	// Caractere de controle e conteudo invalido: 422 e o valor continua.
	rec, errBody := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"icon":"linha\u000aquebrada"}`))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid icon status = %d, want 422: %s", rec.Code, rec.Body.String())
	}
	if code := errorCode(errBody); code != "invalid_icon" {
		t.Fatalf("error code = %q, want invalid_icon", code)
	}
	_, entry = doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if entry["icon"] != "🌿" {
		t.Fatalf("invalid patch changed icon to %v", entry["icon"])
	}

	// Vazio limpa o icone; o cliente decide o fallback.
	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"icon":""}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("clear icon status = %d: %s", rec.Code, rec.Body.String())
	}
	_, entry = doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if entry["icon"] != "" {
		t.Fatalf("cleared icon = %v, want empty", entry["icon"])
	}
}
