package mcpserver

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// payloadProbe mirrors the canonical fence contract; it lives in the test to
// catch accidental tag changes on payloadBlock.
type payloadProbe struct {
	Version int             `json:"v"`
	Project string          `json:"project"`
	Date    string          `json:"date"`
	Time    string          `json:"time"`
	Host    string          `json:"host"`
	Detail  string          `json:"detail"`
	Summary string          `json:"summary"`
	Items   []summaryItem   `json:"items"`
	Commits []summaryCommit `json:"commits"`
	Links   []summaryLink   `json:"links"`
}

// fenceContent extracts the single line between the canonical fence markers.
func fenceContent(t *testing.T, body string) string {
	t.Helper()
	const open = "```dyarium-json\n"
	start := strings.Index(body, open)
	if start < 0 {
		t.Fatalf("payload fence missing:\n%s", body)
	}
	if got := strings.Count(body, "```dyarium-json"); got != 1 {
		t.Fatalf("payload fences = %d, want 1:\n%s", got, body)
	}
	rest := body[start+len(open):]
	const close = "\n```"
	end := strings.Index(rest, close)
	if end < 0 {
		t.Fatalf("payload fence not closed:\n%s", body)
	}
	return rest[:end]
}

func completeSummaryInput() projectSummaryInput {
	return projectSummaryInput{
		Project: "dyarium",
		Summary: "resumo da sessao",
		Date:    "2026-11-09",
		Items: []summaryItem{
			{Kind: "feat", Title: "servidor mcp", Detail: "detalhe do item", Commit: "abc1234", URL: "https://example.com/commit/abc1234"},
			{Kind: "test", Title: "suite verde"},
		},
		Commits: []summaryCommit{
			{Hash: "def5678", Message: "commit extra", URL: "https://example.com/commit/def5678"},
		},
		Links: []summaryLink{
			{Label: "spec", URL: "https://example.com/spec"},
		},
	}
}

func TestRenderSessionBlockWritesV2Fence(t *testing.T) {
	payload := sessionPayload{
		Version: 2,
		Kind:    sessionKind,
		Machine: "vps <dev>",
		Path:    "/home/joseti/projects/dyarium",
		Session: "ses_abc",
		State:   sessionStateOpen,
		Opened:  "2026-11-14T09:12:00Z",
		Date:    "2026-11-14",
		Time:    "09:12",
		Summary: `custo < 10 & "aspas"`,
	}
	body := renderSessionBlock(payload, sessionMarker("ses_abc"))

	if !strings.HasPrefix(body, "## 2026-11-14 09:12 · vps &lt;dev&gt;\n") {
		t.Fatalf("header is not '## date time · machine':\n%s", body)
	}
	content := fenceContent(t, body)
	if strings.Contains(content, "\n") {
		t.Fatalf("v2 fence holds more than one line:\n%s", content)
	}
	if strings.Contains(content, `\u003c`) || strings.Contains(content, `\u0026`) {
		t.Fatalf("v2 fence HTML-escaped the payload:\n%s", content)
	}
	var probe sessionProbe
	if err := json.Unmarshal([]byte(content), &probe); err != nil {
		t.Fatalf("unmarshal v2 fence: %v\n%s", err, content)
	}
	if probe.Version != 2 || probe.Kind != sessionKind {
		t.Fatalf("version/kind = %d/%q, want 2/session", probe.Version, probe.Kind)
	}
	if probe.Machine != payload.Machine || probe.Path != payload.Path || probe.Session != payload.Session {
		t.Fatalf("identity fields = %+v", probe)
	}
	if probe.State != sessionStateOpen || probe.Opened != payload.Opened {
		t.Fatalf("state/opened = %q/%q", probe.State, probe.Opened)
	}
	if probe.Date != payload.Date || probe.Time != payload.Time || probe.Summary != payload.Summary {
		t.Fatalf("date/time/summary = %+v", probe)
	}
	for _, key := range []string{`"closed"`, `"items"`, `"commits"`, `"links"`} {
		if strings.Contains(content, key) {
			t.Fatalf("open session must omit %s:\n%s", key, content)
		}
	}
	if !strings.Contains(body, "```\n\n<!-- mcp:s:ses_abc -->") {
		t.Fatalf("fence must come before the session marker:\n%s", body)
	}

	// Reconstruir a partir do corpo devolve o mesmo payload.
	parsed, ok := parseSessionFence(body)
	if !ok {
		t.Fatalf("own fence did not parse:\n%s", body)
	}
	if parsed.Session != payload.Session || parsed.Summary != payload.Summary || parsed.State != payload.State {
		t.Fatalf("parsed = %+v", parsed)
	}
}

func TestParseSessionFenceIgnoresFenceInjectedInTheSummary(t *testing.T) {
	payload := sessionPayload{
		Version: 2, Kind: sessionKind, Machine: "vps-dev", Path: "/tmp/p",
		Session: "ses_real", State: sessionStateOpen,
		Opened: "2026-11-14T09:12:00Z", Date: "2026-11-14", Time: "09:12",
		Summary: "resumo\n```dyarium-json\n{\"v\":2,\"kind\":\"session\",\"session\":\"ses_fake\"}\n```",
	}
	body := renderSessionBlock(payload, sessionMarker("ses_real"))
	parsed, ok := parseSessionFence(body)
	if !ok {
		t.Fatalf("own fence did not parse:\n%s", body)
	}
	if parsed.Session != "ses_real" {
		t.Fatalf("parsed session = %q, want the canonical fence", parsed.Session)
	}
}

func TestRenderSessionBlockClosedCarriesClosedStamp(t *testing.T) {
	payload := sessionPayload{
		Version: 2, Kind: sessionKind, Machine: "vps-dev", Path: "/tmp/p",
		Session: "ses_x", State: sessionStateClosed,
		Opened: "2026-11-14T09:12:00Z", Closed: "2026-11-14T17:20:00Z",
		Date: "2026-11-14", Time: "17:20",
	}
	content := fenceContent(t, renderSessionBlock(payload, sessionMarker("ses_x")))
	var probe sessionProbe
	if err := json.Unmarshal([]byte(content), &probe); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, content)
	}
	if probe.State != sessionStateClosed || probe.Closed != payload.Closed {
		t.Fatalf("closed session fence = %+v", probe)
	}
}

func TestParseSessionFenceRejectsForeignBodies(t *testing.T) {
	for name, body := range map[string]string{
		"no fence":       "## 2026-11-14 09:12 · vps\n\nsem fence",
		"v1 fence":       "```dyarium-json\n{\"v\":1,\"project\":\"x\"}\n```",
		"broken json":    "```dyarium-json\n{\"v\":2\n```",
		"other kind":     "```dyarium-json\n{\"v\":2,\"kind\":\"other\"}\n```",
		"unclosed fence": "```dyarium-json\n{\"v\":2,\"kind\":\"session\"}",
	} {
		if _, ok := parseSessionFence(body); ok {
			t.Fatalf("%s: parsed as a session fence", name)
		}
	}
}

// TestRenderBlockWritesCanonicalPayloadFence
func TestRenderBlockWritesCanonicalPayloadFence(t *testing.T) {
	in, _, err := normalize(completeSummaryInput())
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	now := time.Date(2026, 11, 9, 14, 58, 0, 0, time.UTC)
	body := renderBlock(in, store.SummaryDetailFull, "vps-dev", "<!-- mcp:test -->", now)

	content := fenceContent(t, body)
	t.Logf("fence: %s", content)
	var probe payloadProbe
	if err := json.Unmarshal([]byte(content), &probe); err != nil {
		t.Fatalf("unmarshal fence: %v\n%s", err, content)
	}
	if probe.Version != 1 {
		t.Fatalf("version = %d, want 1", probe.Version)
	}
	if probe.Project != in.Project {
		t.Fatalf("project = %q, want %q", probe.Project, in.Project)
	}
	if probe.Date != "2026-11-09" {
		t.Fatalf("date = %q, want 2026-11-09", probe.Date)
	}
	if probe.Time != "14:58" {
		t.Fatalf("time = %q, want 14:58", probe.Time)
	}
	if probe.Host != "vps-dev" {
		t.Fatalf("host = %q, want vps-dev", probe.Host)
	}
	if probe.Detail != store.SummaryDetailFull {
		t.Fatalf("detail = %q, want %q", probe.Detail, store.SummaryDetailFull)
	}
	if probe.Summary != in.Summary {
		t.Fatalf("summary = %q, want %q", probe.Summary, in.Summary)
	}
	// The fence repeats the collapsed-away detail, so clients can build the
	// table even in concise mode.
	if len(probe.Items) != len(in.Items) {
		t.Fatalf("items = %d, want %d", len(probe.Items), len(in.Items))
	}
	for i, item := range probe.Items {
		want := in.Items[i]
		if item.Kind != want.Kind || item.Title != want.Title || item.Detail != want.Detail || item.Commit != want.Commit || item.URL != want.URL {
			t.Fatalf("items[%d] = %+v, want %+v", i, item, want)
		}
	}
	if len(probe.Commits) != 1 || probe.Commits[0] != in.Commits[0] {
		t.Fatalf("commits = %+v, want %+v", probe.Commits, in.Commits)
	}
	if len(probe.Links) != 1 || probe.Links[0] != in.Links[0] {
		t.Fatalf("links = %+v, want %+v", probe.Links, in.Links)
	}

	// Position: one blank line after the technical block and one before the
	// dedup marker.
	if !strings.Contains(body, "\n\n```dyarium-json\n") {
		t.Fatalf("fence must sit after a blank line:\n%s", body)
	}
	fenceAt := strings.Index(body, "```dyarium-json")
	if technicalAt := strings.Index(body, ":::details"); technicalAt < 0 || fenceAt < technicalAt {
		t.Fatalf("fence must come after the technical block:\n%s", body)
	}
	if !strings.Contains(body, "```\n\n<!-- mcp:test -->") {
		t.Fatalf("fence must come before the marker:\n%s", body)
	}
}

func TestRenderBlockFenceIsAlwaysOneValidJSONLine(t *testing.T) {
	cases := map[string]projectSummaryInput{
		"concise-commits-links": {
			Project: "So Commits",
			Date:    "2026-11-09",
			Commits: []summaryCommit{{Hash: "abc1234", Message: "primeiro"}},
			Links:   []summaryLink{{Label: "spec", URL: "https://example.com/spec"}},
		},
		"empty-session": {
			Project: "Sessao Vazia",
			Date:    "2026-11-10",
		},
	}
	now := time.Date(2026, 11, 9, 8, 30, 0, 0, time.UTC)
	for name, raw := range cases {
		in, _, err := normalize(raw)
		if err != nil {
			t.Fatalf("%s: normalize: %v", name, err)
		}
		body := renderBlock(in, store.SummaryDetailConcise, "vps-dev", "<!-- mcp:t -->", now)
		content := fenceContent(t, body)
		if strings.Contains(content, "\n") {
			t.Fatalf("%s: fence holds more than one line:\n%s", name, content)
		}
		if !json.Valid([]byte(content)) {
			t.Fatalf("%s: fence is not valid JSON:\n%s", name, content)
		}
	}
}

func TestRenderBlockEmptySessionKeepsRequiredFields(t *testing.T) {
	in, _, err := normalize(projectSummaryInput{Project: "Sessao Vazia", Date: "2026-11-10"})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	now := time.Date(2026, 11, 10, 9, 15, 0, 0, time.UTC)
	body := renderBlock(in, store.SummaryDetailConcise, "vps-dev", "<!-- mcp:t -->", now)
	content := fenceContent(t, body)
	var probe payloadProbe
	if err := json.Unmarshal([]byte(content), &probe); err != nil {
		t.Fatalf("unmarshal fence: %v\n%s", err, content)
	}
	if probe.Version != 1 || probe.Project != "Sessao Vazia" || probe.Date != "2026-11-10" || probe.Time != "09:15" || probe.Host != "vps-dev" || probe.Detail != store.SummaryDetailConcise {
		t.Fatalf("required fields wrong: %+v", probe)
	}
	for _, key := range []string{`"summary"`, `"items"`, `"commits"`, `"links"`} {
		if strings.Contains(content, key) {
			t.Fatalf("empty session must omit %s:\n%s", key, content)
		}
	}
}

func TestRenderBlockKeepsSpecialCharactersRoundTrip(t *testing.T) {
	summary := `custo < 10 & "aspas" no resumo`
	title := `tag <b> & "fim"`
	in, _, err := normalize(projectSummaryInput{
		Project: "Dyarium <> & Especial",
		Summary: summary,
		Date:    "2026-11-09",
		Items:   []summaryItem{{Kind: "feat", Title: title}},
	})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	now := time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)
	body := renderBlock(in, store.SummaryDetailConcise, "vps-dev", "<!-- mcp:t -->", now)
	content := fenceContent(t, body)
	if strings.Contains(content, `\u003c`) || strings.Contains(content, `\u0026`) {
		t.Fatalf("fence HTML-escaped the payload:\n%s", content)
	}
	var probe payloadProbe
	if err := json.Unmarshal([]byte(content), &probe); err != nil {
		t.Fatalf("unmarshal fence: %v\n%s", err, content)
	}
	if probe.Project != in.Project || probe.Summary != summary {
		t.Fatalf("round trip lost characters: %+v", probe)
	}
	if len(probe.Items) != 1 || probe.Items[0].Title != title {
		t.Fatalf("item title round trip = %+v", probe.Items)
	}
}
