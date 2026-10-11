package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEntryTags(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")

	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/tags", strings.NewReader(`{"tags":["viagem","familia"]}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("definir tags: status %d", rec.Code)
	}

	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/tags", nil)
	tags, _ := body["tags"].([]any)
	if len(tags) != 2 {
		t.Fatalf("tags = %+v", body)
	}

	// Replacing with a single tag drops the previous ones.
	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/tags", strings.NewReader(`{"tags":["trabalho"]}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("substituir tags: status %d", rec.Code)
	}
	_, body = doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/tags", nil)
	tags, _ = body["tags"].([]any)
	if len(tags) != 1 || tags[0].(map[string]any)["name"] != "trabalho" {
		t.Fatalf("tags = %+v", tags)
	}

	// The entry list carries the tag names.
	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	entries, _ := list["entries"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %+v", entries)
	}
	entryTags, _ := entries[0].(map[string]any)["tags"].([]any)
	if len(entryTags) != 1 || entryTags[0] != "trabalho" {
		t.Fatalf("tags da entrada = %+v", entries[0])
	}
}

func TestEntryTagsRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	req := httptest.NewRequest(http.MethodPut, "/api/v1/entries/e1/tags", strings.NewReader(`{"tags":["x"]}`))
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sem token: status %d, want 401", rec.Code)
	}
}
