package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/joseti/dyarium/internal/mcpserver"
	"github.com/joseti/dyarium/internal/store"
)

func withMCP(t *testing.T) *Server {
	t.Helper()
	srv := newTestServer(t)
	srv.deps.MCP = mcpserver.New(srv.deps.Store, srv.deps.Logger, "test")
	return srv
}

func TestMCPRequiresBearerToken(t *testing.T) {
	srv := withMCP(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestMCPInitializeReturnsInstructions(t *testing.T) {
	srv := withMCP(t)
	body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer token-de-teste")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	payload := rec.Body.String()
	for _, want := range []string{"instructions", "record_project_summary", "diario central"} {
		if !strings.Contains(payload, want) {
			t.Fatalf("initialize response missing %q:\n%s", want, payload)
		}
	}
}

func TestEntrySummaryDetailPayload(t *testing.T) {
	srv := newTestServer(t)

	rec, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"title":"Projeto"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", rec.Code, rec.Body.String())
	}
	if created["summary_detail"] != store.SummaryDetailConcise {
		t.Fatalf("created summary_detail = %v", created["summary_detail"])
	}
	entryID, _ := created["id"].(string)
	if entryID == "" {
		t.Fatal("created entry has no id")
	}

	_, entry := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if entry["summary_detail"] != store.SummaryDetailConcise {
		t.Fatalf("get summary_detail = %v", entry["summary_detail"])
	}

	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"summary_detail":"full"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch status = %d: %s", rec.Code, rec.Body.String())
	}
	_, entry = doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if entry["summary_detail"] != store.SummaryDetailFull {
		t.Fatalf("patched summary_detail = %v", entry["summary_detail"])
	}

	rec, errBody := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"summary_detail":"verboso"}`))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid patch status = %d, want 422: %s", rec.Code, rec.Body.String())
	}
	if code := errorCode(errBody); code != "invalid_summary_detail" {
		t.Fatalf("error code = %q, want invalid_summary_detail", code)
	}
	_, entry = doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if entry["summary_detail"] != store.SummaryDetailFull {
		t.Fatalf("invalid patch changed summary_detail to %v", entry["summary_detail"])
	}
}

func TestNotebookSummaryDetailIsGone(t *testing.T) {
	srv := newTestServer(t)

	rec, created := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Projeto","summary_detail":"full"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := created["summary_detail"]; ok {
		t.Fatalf("created notebook still carries summary_detail: %v", created)
	}
	notebookID, _ := created["id"].(string)

	// The field is no longer parsed, so a patch with only summary_detail is an
	// empty patch instead of changing a notebook preference.
	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+notebookID,
		strings.NewReader(`{"summary_detail":"full"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("patch status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
}

func TestMCPNotebookSerializesAndIsProtected(t *testing.T) {
	srv := newTestServer(t)

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/notebooks", nil)
	notebooks, _ := list["notebooks"].([]any)
	var mcp map[string]any
	for _, raw := range notebooks {
		item, _ := raw.(map[string]any)
		if item["id"] == store.MCPNotebookID {
			mcp = item
		}
	}
	if mcp == nil {
		t.Fatalf("mcp notebook missing from list: %v", list)
	}
	if mcp["kind"] != store.NotebookKindMCP || mcp["name"] != store.MCPNotebookName {
		t.Fatalf("mcp notebook = %v", mcp)
	}
	if _, ok := mcp["summary_detail"]; ok {
		t.Fatalf("mcp notebook carries summary_detail: %v", mcp)
	}

	rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+store.MCPNotebookID,
		strings.NewReader(`{"name":"Projetos"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("rename mcp notebook status = %d: %s", rec.Code, rec.Body.String())
	}

	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+store.MCPNotebookID,
		strings.NewReader(`{"kind":"notes"}`))
	if rec.Code != http.StatusConflict {
		t.Fatalf("kind change status = %d, want 409: %s", rec.Code, rec.Body.String())
	}

	rec, _ = doJSON(t, srv, http.MethodDelete, "/api/v1/notebooks/"+store.MCPNotebookID, nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("delete status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
}

func TestClientCannotCreateMCPNotebook(t *testing.T) {
	srv := newTestServer(t)

	rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Outro","kind":"mcp"}`))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("create status = %d, want 422: %s", rec.Code, rec.Body.String())
	}

	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/notebooks",
		strings.NewReader(`{"name":"Comum"}`))
	notebookID, _ := created["id"].(string)
	rec, _ = doJSON(t, srv, http.MethodPatch, "/api/v1/notebooks/"+notebookID,
		strings.NewReader(`{"kind":"mcp"}`))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("patch kind status = %d, want 422: %s", rec.Code, rec.Body.String())
	}
}

// errorCode extracts the contract error code from a response body.
func errorCode(body map[string]any) string {
	raw, _ := body["error"].(map[string]any)
	code, _ := raw["code"].(string)
	return code
}
