package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// callMCPTool performs a tools/call over the real Streamable HTTP transport,
// which is the same path OpenCode uses.
func callMCPTool(t *testing.T, srv *Server, name, arguments string) string {
	t.Helper()
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"` + name + `","arguments":` + arguments + `}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer token-de-teste")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s status = %d: %s", name, rec.Code, rec.Body.String())
	}
	payload := rec.Body.String()
	if strings.Contains(payload, `"isError":true`) {
		t.Fatalf("%s returned a tool error: %s", name, payload)
	}
	return payload
}

func TestMCPProjectsEndpointListsProjects(t *testing.T) {
	srv := withMCP(t)
	const path = "/home/joseti/projects/api-lista"

	callMCPTool(t, srv, "session_open", `{"directory":"`+path+`","session":"ses_api_1","name":"primeira"}`)
	// Duas sessoes no mesmo segundo nao tem ordem observavel; o helper move a
	// primeira para ontem para a segunda ser, sem duvida, a mais recente.
	ctx := context.Background()
	first, ok, err := srv.deps.Store.FindSessionNote(ctx, store.MCPNotebookID, "ses_api_1")
	if err != nil || !ok {
		t.Fatalf("find first session: ok=%v err=%v", ok, err)
	}
	if _, err := srv.deps.Store.DB().ExecContext(ctx,
		`UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?`,
		"2026-11-18T09:00:00Z", "2026-11-18T09:00:00Z", first.ID); err != nil {
		t.Fatalf("backdate first session: %v", err)
	}
	callMCPTool(t, srv, "session_close", `{"directory":"`+path+`","session":"ses_api_2","summary":"fim da sessao","items":[{"kind":"feat","title":"rota nova"}]}`)

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/mcp/projects", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	projects, _ := body["projects"].([]any)
	if len(projects) != 1 {
		t.Fatalf("projects = %v, want one", body["projects"])
	}
	project, _ := projects[0].(map[string]any)
	if project["title"] != path {
		t.Fatalf("title = %v", project["title"])
	}
	if project["id"] == "" {
		t.Fatalf("id missing: %v", project)
	}
	if project["sessions"] != float64(2) {
		t.Fatalf("sessions = %v, want 2", project["sessions"])
	}
	if project["state"] != "closed" {
		t.Fatalf("state = %v, want closed", project["state"])
	}
	if project["path"] != "api-lista" {
		t.Fatalf("path = %v, want the folder name", project["path"])
	}
	if project["summary_detail"] != "concise" {
		t.Fatalf("summary_detail = %v", project["summary_detail"])
	}
	if project["archived"] != false {
		t.Fatalf("archived = %v", project["archived"])
	}
	stamp, _ := project["last_session_at"].(string)
	if _, err := time.Parse(time.RFC3339, stamp); err != nil {
		t.Fatalf("last_session_at = %q, not RFC 3339: %v", stamp, err)
	}
}

func TestMCPProjectsEndpointIsProtected(t *testing.T) {
	srv := withMCP(t)

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/mcp/projects", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// TestPausedMCPIsAToolError proves the pause lands as a tool result, not as an
// HTTP failure: the agent must see the message and stop, while the transport
// keeps answering 200.
func TestPausedMCPIsAToolError(t *testing.T) {
	srv := withMCP(t)
	if rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/settings", strings.NewReader(`{"mcp_paused":true}`)); rec.Code != http.StatusOK {
		t.Fatalf("pause status = %d: %s", rec.Code, rec.Body.String())
	}

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"session_open","arguments":{"directory":"/home/joseti/projects/pausado","session":"ses_http"}}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer token-de-teste")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 with a tool error: %s", rec.Code, rec.Body.String())
	}
	payload := rec.Body.String()
	if !strings.Contains(payload, `"isError":true`) || !strings.Contains(payload, "MCP pausado") {
		t.Fatalf("response = %s, want an isError result naming the pause", payload)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/mcp/projects", nil)
	if projects, _ := list["projects"].([]any); len(projects) != 0 {
		t.Fatalf("paused MCP wrote projects: %v", projects)
	}
}

func TestMCPProjectsEndpointEmptyIsAnArray(t *testing.T) {
	srv := withMCP(t)

	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/mcp/projects", nil)
	projects, ok := body["projects"].([]any)
	if !ok {
		t.Fatalf("projects = %v, want an empty array", body["projects"])
	}
	if len(projects) != 0 {
		t.Fatalf("projects = %v, want empty", projects)
	}
}
