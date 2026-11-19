package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func wantIntField(t *testing.T, body map[string]any, key string, want int) {
	t.Helper()
	raw, ok := body[key].(float64)
	if !ok {
		t.Fatalf("%s = %v (%T), want a number", key, body[key], body[key])
	}
	if int(raw) != want {
		t.Fatalf("%s = %v, want %d", key, raw, want)
	}
}

func TestSettingsMCPDefaults(t *testing.T) {
	srv := newTestServer(t)

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	for key, want := range map[string]any{
		"mcp_paused":          false,
		"mcp_include_commits": true,
		"mcp_include_links":   true,
		"mcp_store_full_path": false,
		"mcp_machine_alias":   "",
	} {
		if body[key] != want {
			t.Fatalf("%s = %v, want %v", key, body[key], want)
		}
	}
	wantIntField(t, body, "mcp_idle_hours", 12)
	wantIntField(t, body, "mcp_history_sessions", 3)
}

func TestSettingsMCPAcceptsValidValues(t *testing.T) {
	srv := newTestServer(t)

	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/settings", strings.NewReader(
		`{"mcp_paused":true,"mcp_idle_hours":36,"mcp_history_sessions":0,`+
			`"mcp_include_commits":false,"mcp_include_links":false,`+
			`"mcp_store_full_path":true,"mcp_machine_alias":"  estacao  "}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("put status = %d: %s", rec.Code, rec.Body.String())
	}

	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
	if body["mcp_paused"] != true || body["mcp_include_commits"] != false ||
		body["mcp_include_links"] != false || body["mcp_store_full_path"] != true {
		t.Fatalf("settings not persisted: %v", body)
	}
	if body["mcp_machine_alias"] != "estacao" {
		t.Fatalf("alias = %v, want trimmed", body["mcp_machine_alias"])
	}
	wantIntField(t, body, "mcp_idle_hours", 36)
	wantIntField(t, body, "mcp_history_sessions", 0)
}

func TestSettingsMCPRejectsInvalidValues(t *testing.T) {
	longAlias := strings.Repeat("a", 81)
	cases := []struct {
		name    string
		payload string
		message string
		key     string
	}{
		{name: "idle too low", payload: `{"mcp_idle_hours":0}`, message: "entre 1 e 168", key: "mcp_idle_hours"},
		{name: "idle too high", payload: `{"mcp_idle_hours":169}`, message: "entre 1 e 168", key: "mcp_idle_hours"},
		{name: "history below zero", payload: `{"mcp_history_sessions":-1}`, message: "entre 0 e 10", key: "mcp_history_sessions"},
		{name: "history above ten", payload: `{"mcp_history_sessions":11}`, message: "entre 0 e 10", key: "mcp_history_sessions"},
		{name: "alias too long", payload: fmt.Sprintf(`{"mcp_machine_alias":%q}`, longAlias), message: "80", key: "mcp_machine_alias"},
		{name: "alias with control", payload: `{"mcp_machine_alias":"com\nquebra"}`, message: "controle", key: "mcp_machine_alias"},
		{name: "paused not boolean", payload: `{"mcp_paused":"talvez"}`, message: "booleano", key: "mcp_paused"},
		{name: "commits not boolean", payload: `{"mcp_include_commits":1}`, message: "booleano", key: "mcp_include_commits"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := newTestServer(t)

			rec, body := doJSON(t, srv, http.MethodPut, "/api/v1/settings", strings.NewReader(tc.payload))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
			if code := errorCode(body); code != "invalid_value" {
				t.Fatalf("error code = %q, want invalid_value: %v", code, body)
			}
			raw, _ := body["error"].(map[string]any)
			message, _ := raw["message"].(string)
			if !strings.Contains(message, tc.message) {
				t.Fatalf("message = %q, want %q", message, tc.message)
			}

			// Nenhuma configuracao e gravada quando o corpo tem valor invalido.
			_, current := doJSON(t, srv, http.MethodGet, "/api/v1/settings", nil)
			if tc.key == "mcp_idle_hours" {
				wantIntField(t, current, tc.key, 12)
			}
			if tc.key == "mcp_history_sessions" {
				wantIntField(t, current, tc.key, 3)
			}
			if tc.key == "mcp_machine_alias" && current[tc.key] != "" {
				t.Fatalf("%s was written: %v", tc.key, current[tc.key])
			}
			if tc.key == "mcp_paused" && current[tc.key] != false {
				t.Fatalf("%s was written: %v", tc.key, current[tc.key])
			}
			if tc.key == "mcp_include_commits" && current[tc.key] != true {
				t.Fatalf("%s was written: %v", tc.key, current[tc.key])
			}
		})
	}
}
