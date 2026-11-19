package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/joseti/dyarium/internal/store"
)

// sessionProbe mirrors the v2 fence contract; it lives in the test so an
// accidental tag change on sessionPayload fails here.
type sessionProbe struct {
	Version int             `json:"v"`
	Kind    string          `json:"kind"`
	Machine string          `json:"machine"`
	Path    string          `json:"path"`
	Session string          `json:"session"`
	State   string          `json:"state"`
	Opened  string          `json:"opened"`
	Closed  string          `json:"closed"`
	Date    string          `json:"date"`
	Time    string          `json:"time"`
	Summary string          `json:"summary"`
	Items   []summaryItem   `json:"items"`
	Commits []summaryCommit `json:"commits"`
	Links   []summaryLink   `json:"links"`
}

func sessionRequest(host, metaSession string) *mcp.CallToolRequest {
	req := &mcp.CallToolRequest{
		Params: &mcp.CallToolParamsRaw{Name: sessionOpenTool},
		Extra:  &mcp.RequestExtra{Header: http.Header{}},
	}
	if host != "" {
		req.Extra.Header.Set(hostHeader, host)
	}
	if metaSession != "" {
		req.Params.Meta = mcp.Meta{sessionIDMetaKey: metaSession}
	}
	return req
}

func sessionText(t *testing.T, result *mcp.CallToolResult) (string, error) {
	t.Helper()
	if result == nil || len(result.Content) != 1 {
		t.Fatalf("result = %#v", result)
	}
	text, ok := result.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("content type = %T", result.Content[0])
	}
	return text.Text, nil
}

func callSessionOpen(t *testing.T, svc *service, in sessionOpenInput, host, metaSession string) (string, error) {
	t.Helper()
	result, _, err := svc.sessionOpen(context.Background(), sessionRequest(host, metaSession), in)
	if err != nil {
		return "", err
	}
	return sessionText(t, result)
}

func callSessionClose(t *testing.T, svc *service, in sessionCloseInput, host, metaSession string) (string, error) {
	t.Helper()
	result, _, err := svc.sessionClose(context.Background(), sessionRequest(host, metaSession), in)
	if err != nil {
		return "", err
	}
	return sessionText(t, result)
}

func sessionNotes(t *testing.T, svc *service, entryID string) []store.Note {
	t.Helper()
	notes, err := svc.store.ListNotes(context.Background(), entryID)
	if err != nil {
		t.Fatalf("list notes: %v", err)
	}
	return notes
}

func pathEntry(t *testing.T, svc *service, path, machine string) store.Entry {
	t.Helper()
	entry, ok, err := svc.store.FindProjectEntry(context.Background(), store.MCPNotebookID, path, machine)
	if err != nil || !ok {
		t.Fatalf("find project entry %q on %q: ok=%v err=%v", path, machine, ok, err)
	}
	return entry
}

func probeNote(t *testing.T, note store.Note) sessionProbe {
	t.Helper()
	var probe sessionProbe
	content := fenceContent(t, note.ContentMarkdown)
	if err := json.Unmarshal([]byte(content), &probe); err != nil {
		t.Fatalf("unmarshal session fence: %v\n%s", err, content)
	}
	return probe
}

func TestSessionOpenCreatesOneEntryPerPathAndMachine(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/dyarium"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_a"}, "alpha", ""); err != nil {
		t.Fatalf("open first session: %v", err)
	}
	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_b", Name: "outra"}, "alpha", ""); err != nil {
		t.Fatalf("open second session: %v", err)
	}

	entry := pathEntry(t, svc, path, "alpha")
	if entry.OriginKind != store.OriginKindMCP || entry.OriginInstance != "alpha" {
		t.Fatalf("origin = %s/%s, want alpha/mcp", entry.OriginInstance, entry.OriginKind)
	}
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 2 {
		t.Fatalf("notes = %d, want two sessions in the same entry", len(notes))
	}

	// The same path on another machine is another entry, never the same one.
	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_c"}, "beta", ""); err != nil {
		t.Fatalf("open session on other machine: %v", err)
	}
	if entries := projectEntries(t, svc); len(entries) != 2 {
		t.Fatalf("project entries = %d, want 2 (one per machine): %+v", len(entries), entries)
	}
	other := pathEntry(t, svc, path, "beta")
	if other.ID == entry.ID {
		t.Fatal("different machines shared the same entry")
	}

	// A trailing slash and a repeated separator are the same path.
	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path + "/", Session: "ses_d"}, "alpha", ""); err != nil {
		t.Fatalf("open session with trailing slash: %v", err)
	}
	if notes := sessionNotes(t, svc, entry.ID); len(notes) != 3 {
		t.Fatalf("notes = %d, want 3 (trailing slash must reuse the entry)", len(notes))
	}
	if entries := projectEntries(t, svc); len(entries) != 2 {
		t.Fatalf("project entries = %d, want 2 after the trailing slash", len(entries))
	}
}

func TestSessionOpenIsIdempotent(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/reopen"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_x", Name: "primeira", Summary: "resumo um",
	}, "dev-box", ""); err != nil {
		t.Fatalf("open: %v", err)
	}
	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	first := probeNote(t, notes[0])
	if notes[0].Title != "primeira" {
		t.Fatalf("title = %q, want primeira", notes[0].Title)
	}

	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_x", Name: "segunda", Summary: "resumo dois",
	}, "dev-box", ""); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	notes = sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want the same note reopened", len(notes))
	}
	if notes[0].Title != "segunda" {
		t.Fatalf("title = %q, want the updated name", notes[0].Title)
	}
	if !strings.Contains(notes[0].ContentMarkdown, "resumo dois") {
		t.Fatalf("reopen did not write the new summary:\n%s", notes[0].ContentMarkdown)
	}
	if strings.Contains(notes[0].ContentMarkdown, "resumo um") {
		t.Fatalf("reopen kept the old summary:\n%s", notes[0].ContentMarkdown)
	}
	again := probeNote(t, notes[0])
	if again.Opened != first.Opened {
		t.Fatalf("opened = %q, want the original %q", again.Opened, first.Opened)
	}
	if again.State != sessionStateOpen {
		t.Fatalf("state = %q, want open", again.State)
	}
	if again.Session != "ses_x" {
		t.Fatalf("session = %q, want ses_x", again.Session)
	}

	// Reabrir sem nome nao renomeia a nota para o nome da pasta, e reabrir sem
	// resumo nao reescreve o corpo.
	before := notes[0]
	bodyBefore := before.ContentMarkdown
	versionBefore := before.BodyVersion
	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_x",
	}, "dev-box", ""); err != nil {
		t.Fatalf("reopen without name: %v", err)
	}
	notes = sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	if notes[0].Title != "segunda" {
		t.Fatalf("title = %q, want it kept as segunda", notes[0].Title)
	}
	if notes[0].ContentMarkdown != bodyBefore || notes[0].BodyVersion != versionBefore {
		t.Fatalf("a reopen without data rewrote the note:\n%s", notes[0].ContentMarkdown)
	}
}

func TestSessionIDFromMetaWinsOverParam(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/meta"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_param",
	}, "dev-box", "ses_meta"); err != nil {
		t.Fatalf("open: %v", err)
	}
	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	if probe := probeNote(t, notes[0]); probe.Session != "ses_meta" {
		t.Fatalf("session = %q, want the id from _meta", probe.Session)
	}
	if _, ok, err := svc.store.FindSessionNote(context.Background(), store.MCPNotebookID, "ses_param"); err != nil || ok {
		t.Fatalf("param id was used instead of meta: ok=%v err=%v", ok, err)
	}
	if _, ok, err := svc.store.FindSessionNote(context.Background(), store.MCPNotebookID, "ses_meta"); err != nil || !ok {
		t.Fatalf("meta id is not addressable: ok=%v err=%v", ok, err)
	}
}

func TestSessionOpenGeneratesSessionID(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/gerado"
	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path}, "dev-box", ""); err != nil {
		t.Fatalf("open: %v", err)
	}
	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	probe := probeNote(t, notes[0])
	if !strings.HasPrefix(probe.Session, "ses_") || len(probe.Session) != len("ses_")+12 {
		t.Fatalf("generated session = %q, want ses_ and 12 hex chars", probe.Session)
	}
	if strings.Trim(probe.Session[len("ses_"):], "0123456789abcdef") != "" {
		t.Fatalf("generated session = %q, want hex digits", probe.Session)
	}
}

func TestSessionCloseSealsSession(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/fechar"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_close", Name: "login",
	}, "dev-box", ""); err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := callSessionClose(t, svc, sessionCloseInput{
		Directory: path,
		Session:   "ses_close",
		Summary:   "fechando a sessao",
		Date:      "2026-11-09",
		Items: []summaryItem{
			{Kind: "feat", Title: "login novo", Commit: "abc1234", URL: "https://example.com/c/abc1234"},
			{Title: "sem tipo"},
		},
		Commits: []summaryCommit{{Hash: "def5678", Message: "extra"}},
		Links:   []summaryLink{{Label: "spec", URL: "https://example.com/spec"}},
	}, "dev-box", ""); err != nil {
		t.Fatalf("close: %v", err)
	}

	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want the session note sealed in place", len(notes))
	}
	note := notes[0]
	probe := probeNote(t, note)
	if probe.Version != 2 || probe.Kind != "session" {
		t.Fatalf("fence = v%d/%q, want v2/session", probe.Version, probe.Kind)
	}
	if probe.State != sessionStateClosed {
		t.Fatalf("state = %q, want closed", probe.State)
	}
	if probe.Closed == "" {
		t.Fatal("closed timestamp missing from the fence")
	}
	if _, err := time.Parse(time.RFC3339, probe.Closed); err != nil {
		t.Fatalf("closed = %q, not RFC 3339: %v", probe.Closed, err)
	}
	if probe.Opened == "" || probe.Opened > probe.Closed {
		t.Fatalf("opened = %q, closed = %q", probe.Opened, probe.Closed)
	}
	if probe.Machine != "dev-box" || probe.Path != path || probe.Session != "ses_close" {
		t.Fatalf("identity fields = %+v", probe)
	}
	if probe.Date != "2026-11-09" {
		t.Fatalf("date = %q, want the reported day", probe.Date)
	}
	if probe.Summary != "fechando a sessao" {
		t.Fatalf("summary = %q", probe.Summary)
	}
	if len(probe.Items) != 2 || len(probe.Commits) != 1 || len(probe.Links) != 1 {
		t.Fatalf("payload arrays = %d/%d/%d", len(probe.Items), len(probe.Commits), len(probe.Links))
	}
	if probe.Items[1].Kind != defaultItemKind {
		t.Fatalf("unknown kind = %q, want %s", probe.Items[1].Kind, defaultItemKind)
	}
	if !strings.Contains(note.ContentMarkdown, "## 2026-11-09 ") {
		t.Fatalf("header does not carry the reported day:\n%s", note.ContentMarkdown)
	}
	if !strings.Contains(note.ContentMarkdown, "- **feat** login novo · [abc1234](https://example.com/c/abc1234)") {
		t.Fatalf("item line missing:\n%s", note.ContentMarkdown)
	}
	if !strings.Contains(note.ContentMarkdown, "<!-- mcp:s:ses_close -->") {
		t.Fatalf("session marker missing:\n%s", note.ContentMarkdown)
	}
	if got := strings.Count(note.ContentMarkdown, "```dyarium-json"); got != 1 {
		t.Fatalf("fences = %d, want 1:\n%s", got, note.ContentMarkdown)
	}
	if strings.Contains(note.ContentMarkdown, sessionStateInterrupted) {
		t.Fatalf("interrupted state must never be written:\n%s", note.ContentMarkdown)
	}
}

func TestSessionCloseWithoutOpenCreatesClosedNote(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/so-fim"

	if _, err := callSessionClose(t, svc, sessionCloseInput{
		Directory: path,
		Session:   "ses_only_close",
		Summary:   "so o fechamento",
		Date:      "2026-11-10",
		Items:     []summaryItem{{Kind: "fix", Title: "correcao"}},
	}, "dev-box", ""); err != nil {
		t.Fatalf("close without open: %v", err)
	}

	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	if notes[0].Title != "so-fim" {
		t.Fatalf("title = %q, want the folder name", notes[0].Title)
	}
	probe := probeNote(t, notes[0])
	if probe.State != sessionStateClosed || probe.Closed == "" {
		t.Fatalf("fence = %+v, want a closed session", probe)
	}
	if probe.Opened != probe.Closed {
		t.Fatalf("opened = %q, want the close stamp %q when there was no open", probe.Opened, probe.Closed)
	}
	if probe.Session != "ses_only_close" || probe.Path != path {
		t.Fatalf("identity fields = %+v", probe)
	}
}

func TestSessionCloseWithoutMatchNeedsDirectory(t *testing.T) {
	svc := openTestService(t)
	_, err := callSessionClose(t, svc, sessionCloseInput{
		Session: "ses_orfao",
		Items:   []summaryItem{{Kind: "feat", Title: "nada"}},
	}, "dev-box", "")
	if err == nil {
		t.Fatal("close without an open session and without a directory must fail")
	}
	if !strings.Contains(err.Error(), "directory") {
		t.Fatalf("error = %q, want an actionable message naming directory", err)
	}
	if entries := projectEntries(t, svc); len(entries) != 0 {
		t.Fatalf("project entries = %d, want 0 after a rejected close", len(entries))
	}
}

func TestSessionCloseWithoutSessionIDGeneratesOne(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/sem-id"
	if _, err := callSessionClose(t, svc, sessionCloseInput{
		Directory: path,
		Date:      "2026-11-10",
		Items:     []summaryItem{{Kind: "docs", Title: "texto"}},
	}, "dev-box", ""); err != nil {
		t.Fatalf("close: %v", err)
	}
	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	probe := probeNote(t, notes[0])
	if !strings.HasPrefix(probe.Session, "ses_") || len(probe.Session) != len("ses_")+12 {
		t.Fatalf("session = %q, want a generated ses_ id", probe.Session)
	}
}

func TestSessionOpenHistoryListsLatestThreeNewestFirst(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/historico"
	days := []string{"2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"}

	for i, day := range days {
		session := fmt.Sprintf("ses_h%d", i+1)
		name := fmt.Sprintf("sessao-%d", i+1)
		if _, err := callSessionOpen(t, svc, sessionOpenInput{
			Directory: path, Session: session, Name: name,
		}, "dev-box", ""); err != nil {
			t.Fatalf("open %s: %v", session, err)
		}
		items := make([]summaryItem, i+1)
		for j := range items {
			items[j] = summaryItem{Kind: "feat", Title: fmt.Sprintf("item-%d-%d", i+1, j+1)}
		}
		if _, err := callSessionClose(t, svc, sessionCloseInput{
			Directory: path, Session: session, Date: day, Items: items,
		}, "dev-box", ""); err != nil {
			t.Fatalf("close %s: %v", session, err)
		}
		// O banco guarda created_at com resolucao de segundos e as sessoes do
		// teste nascem no mesmo segundo; a data real vem do dia reportado.
		backdateSession(t, svc, session, parseTestTime(day+"T09:00:00Z"))
	}

	report, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_atual", Name: "atual",
	}, "dev-box", "")
	if err != nil {
		t.Fatalf("open current: %v", err)
	}
	if len(report) > maxHistoryBytes {
		t.Fatalf("history = %d bytes, want at most %d", len(report), maxHistoryBytes)
	}
	for _, want := range []string{"sessao-4", "sessao-3", "sessao-2", "2026-11-13", "2026-11-12", "2026-11-11"} {
		if !strings.Contains(report, want) {
			t.Fatalf("history missing %q:\n%s", want, report)
		}
	}
	if strings.Contains(report, "sessao-1") {
		t.Fatalf("history listed a fourth session:\n%s", report)
	}
	newest := strings.Index(report, "sessao-4")
	middle := strings.Index(report, "sessao-3")
	oldest := strings.Index(report, "sessao-2")
	if newest < 0 || middle < newest || oldest < middle {
		t.Fatalf("history is not newest first:\n%s", report)
	}
	if !strings.Contains(report, "4 sessoes") || !strings.Contains(report, "10 itens") {
		t.Fatalf("totals missing or wrong (want 4 sessoes, 10 itens):\n%s", report)
	}
	if !strings.Contains(report, "sessao-4 (4 itens)") {
		t.Fatalf("per-session item count missing:\n%s", report)
	}
}

// backdateSession moves the creation clock of one session note so ordering
// tests do not depend on the second resolution of the database clock.
func backdateSession(t *testing.T, svc *service, session string, at time.Time) {
	t.Helper()
	note, ok, err := svc.store.FindSessionNote(context.Background(), store.MCPNotebookID, session)
	if err != nil || !ok {
		t.Fatalf("find session %s: ok=%v err=%v", session, ok, err)
	}
	if _, err := svc.store.DB().ExecContext(context.Background(),
		`UPDATE notes SET created_at = ? WHERE id = ?`, at.UTC().Format(time.RFC3339), note.ID); err != nil {
		t.Fatalf("backdate session %s: %v", session, err)
	}
}

func TestSessionHistoryRespectsSizeCap(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/gigante"

	// Uma nota fora do contrato (corpo escrito a mao) nao pode estourar o
	// resultado da ferramenta.
	notebook, err := svc.store.EnsureMCPNotebook(context.Background())
	if err != nil {
		t.Fatalf("ensure mcp notebook: %v", err)
	}
	entry, err := svc.store.EnsureProjectEntry(context.Background(), notebook.ID, path, "dev-box")
	if err != nil {
		t.Fatalf("ensure project entry: %v", err)
	}
	now := time.Now().UTC()
	if err := svc.store.CreateNote(context.Background(), store.Note{
		ID: "nota-gigante", EntryID: entry.ID,
		Title:           strings.Repeat("titulo enorme ", 300),
		ContentMarkdown: "",
		CreatedAt:       now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	report, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_cap", Name: "atual",
	}, "dev-box", "")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if len(report) > maxHistoryBytes {
		t.Fatalf("history = %d bytes, want at most %d:\n%s", len(report), maxHistoryBytes, report)
	}
	if !strings.Contains(report, "total:") {
		t.Fatalf("history dropped the totals:\n%s", report)
	}

	// Um caminho patologico tambem nao estoura o limite.
	uri := "/" + strings.Repeat("<", 500)
	report, err = callSessionOpen(t, svc, sessionOpenInput{
		Directory: uri, Session: "ses_cap_path", Name: "caminho",
	}, "dev-box", "")
	if err != nil {
		t.Fatalf("open with long path: %v", err)
	}
	if len(report) > maxHistoryBytes {
		t.Fatalf("history with a long path = %d bytes, want at most %d:\n%s", len(report), maxHistoryBytes, report)
	}
	if !strings.Contains(report, "primeira sessao") {
		t.Fatalf("first-session report missing:\n%s", report)
	}
}

func TestSessionOpenTouchesWithoutRewriting(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/heartbeat"
	ctx := context.Background()

	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_beat", Name: "batida", Summary: "resumo",
	}, "dev-box", ""); err != nil {
		t.Fatalf("open: %v", err)
	}
	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	note := notes[0]

	// Envelhece a nota 13 horas: o estado interrompido e derivado na leitura e
	// nunca escrito pelo servidor.
	if _, err := svc.store.DB().ExecContext(ctx,
		`UPDATE notes SET updated_at = ? WHERE id = ?`, "2020-01-01T00:00:00Z", note.ID); err != nil {
		t.Fatalf("backdate note: %v", err)
	}

	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_beat",
	}, "dev-box", ""); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}

	after := sessionNotes(t, svc, entry.ID)[0]
	if !after.UpdatedAt.After(parseTestTime("2020-01-01T00:00:00Z")) {
		t.Fatalf("updated_at was not touched: %v", after.UpdatedAt)
	}
	if after.BodyVersion != note.BodyVersion {
		t.Fatalf("body version moved on a heartbeat: %q -> %q", note.BodyVersion, after.BodyVersion)
	}
	if after.ContentMarkdown != note.ContentMarkdown {
		t.Fatalf("body changed on a heartbeat:\n%s", after.ContentMarkdown)
	}
	if probe := probeNote(t, after); probe.State != sessionStateOpen {
		t.Fatalf("state = %q, want open", probe.State)
	}
	if strings.Contains(after.ContentMarkdown, sessionStateInterrupted) {
		t.Fatalf("heartbeat wrote the interrupted state:\n%s", after.ContentMarkdown)
	}
}

func parseTestTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return parsed
}

func TestSessionIDArrivesThroughMCPMeta(t *testing.T) {
	svc := openTestService(t)
	ctx := context.Background()
	server := newServer(svc.store, svc.logger, "test")
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	serverSession, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatalf("connect server: %v", err)
	}
	defer serverSession.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("connect client: %v", err)
	}
	defer clientSession.Close()

	// A chamada atravessa o JSON de verdade: o _meta chega ao servidor como o
	// cliente OpenCode envia, e vence o parametro session.
	result, err := clientSession.CallTool(ctx, &mcp.CallToolParams{
		Name:      sessionOpenTool,
		Arguments: map[string]any{"directory": "/home/joseti/projects/meta-e2e", "session": "ses_param"},
		Meta:      mcp.Meta{sessionIDMetaKey: "ses_meta_e2e"},
	})
	if err != nil {
		t.Fatalf("call tool: %v", err)
	}
	if result.IsError {
		t.Fatalf("tool error: %+v", result.Content)
	}

	entry := pathEntry(t, svc, "/home/joseti/projects/meta-e2e", "")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	if probe := probeNote(t, notes[0]); probe.Session != "ses_meta_e2e" {
		t.Fatalf("session = %q, want the id from _meta", probe.Session)
	}
}

func TestSessionOpenReportStartsWithSessionID(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/com-id"

	report, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path}, "dev-box", "")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	first, rest, ok := strings.Cut(report, "\n")
	if !ok || rest == "" {
		t.Fatalf("report has no second line:\n%s", report)
	}
	prefix := "sessao "
	// Com mcp_store_full_path desligado (o padrao), o relatorio mostra so o
	// nome da pasta; o caminho absoluto continua na nota.
	suffix := " aberta em com-id"
	if !strings.HasPrefix(first, prefix) || !strings.HasSuffix(first, suffix) {
		t.Fatalf("first line = %q, want 'sessao <id> aberta em com-id'", first)
	}
	reported := strings.TrimSuffix(strings.TrimPrefix(first, prefix), suffix)
	if !strings.HasPrefix(reported, "ses_") {
		t.Fatalf("reported session = %q", reported)
	}
	if !strings.Contains(rest, "primeira sessao em com-id") {
		t.Fatalf("history was not kept after the id line:\n%s", report)
	}

	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	if probe := probeNote(t, notes[0]); probe.Session != reported {
		t.Fatalf("the report id %q is not the id of the note (%q)", reported, probe.Session)
	}
}

func TestSessionCloseReportStartsWithSessionID(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/fechada-com-id"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_msg",
	}, "dev-box", ""); err != nil {
		t.Fatalf("open: %v", err)
	}
	message, err := callSessionClose(t, svc, sessionCloseInput{
		Session: "ses_msg",
		Items:   []summaryItem{{Kind: "fix", Title: "correcao"}},
	}, "dev-box", "")
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if !strings.HasPrefix(message, "sessao ses_msg fechada") {
		t.Fatalf("close message = %q, want it to start with the session id", message)
	}
	if strings.Contains(message, "nota criada") {
		t.Fatalf("close of an open session reported a created note: %q", message)
	}

	created, err := callSessionClose(t, svc, sessionCloseInput{
		Directory: "/home/joseti/projects/fechada-sem-abrir",
		Session:   "ses_msg_created",
		Items:     []summaryItem{{Kind: "docs", Title: "texto"}},
	}, "dev-box", "")
	if err != nil {
		t.Fatalf("close without open: %v", err)
	}
	if !strings.HasPrefix(created, "sessao ses_msg_created fechada") {
		t.Fatalf("close message = %q, want it to start with the session id", created)
	}
	if !strings.Contains(created, "nota criada") {
		t.Fatalf("close without open must say it created the note: %q", created)
	}
}

// TestSessionRoundTripWithoutMetaSealsTheSameNote proves a client that never
// sends _meta and never names the session can close the note it opened: the
// server reports the generated id and the close finds that same note.
func TestSessionRoundTripWithoutMetaSealsTheSameNote(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/ida-e-volta"
	ctx := context.Background()

	report, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path}, "dev-box", "")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	first, _, _ := strings.Cut(report, "\n")
	sessionID, rest, ok := strings.Cut(strings.TrimPrefix(first, "sessao "), " aberta em ")
	if !ok || rest == "" || !strings.HasPrefix(sessionID, "ses_") {
		t.Fatalf("could not read the session id from %q", first)
	}
	if _, ok, err := svc.store.FindSessionNote(ctx, store.MCPNotebookID, sessionID); err != nil || !ok {
		t.Fatalf("reported id is not addressable: ok=%v err=%v", ok, err)
	}

	message, err := callSessionClose(t, svc, sessionCloseInput{
		Session: sessionID,
		Summary: "fim do trabalho",
		Items:   []summaryItem{{Kind: "feat", Title: "entrega"}},
	}, "dev-box", "")
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if !strings.HasPrefix(message, "sessao "+sessionID+" fechada") {
		t.Fatalf("close message = %q", message)
	}
	if strings.Contains(message, "nota criada") {
		t.Fatalf("close created a note instead of sealing the open one: %q", message)
	}

	entry := pathEntry(t, svc, path, "dev-box")
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want the open note sealed in place", len(notes))
	}
	probe := probeNote(t, notes[0])
	if probe.Session != sessionID || probe.State != sessionStateClosed {
		t.Fatalf("sealed note = %+v", probe)
	}
	if len(probe.Items) != 1 || probe.Summary != "fim do trabalho" {
		t.Fatalf("sealed note lost the report: %+v", probe)
	}
}

func TestSessionOpenRejectsHostileInput(t *testing.T) {
	cases := []struct {
		name string
		in   sessionOpenInput
		want string
	}{
		{"relative path", sessionOpenInput{Directory: "projetos/dyarium"}, "directory"},
		{"empty path", sessionOpenInput{Directory: "   "}, "directory"},
		{"traversal", sessionOpenInput{Directory: "/home/u/../etc"}, ".."},
		{"nul byte", sessionOpenInput{Directory: "/tmp/a\x00b"}, "caracter"},
		{"control char", sessionOpenInput{Directory: "/tmp/a\x07b"}, "caracter"},
		{"long path", sessionOpenInput{Directory: "/" + strings.Repeat("a", 600)}, "512"},
		{"long name", sessionOpenInput{Directory: "/tmp/ok", Name: strings.Repeat("n", 121)}, "120"},
		{"control in name", sessionOpenInput{Directory: "/tmp/ok", Name: "no\x00me"}, "caracter"},
		{"bad session id", sessionOpenInput{Directory: "/tmp/ok", Session: "ses a;drop"}, "session"},
	}
	for _, tc := range cases {
		svc := openTestService(t)
		_, err := callSessionOpen(t, svc, tc.in, "dev-box", "")
		if err == nil {
			t.Fatalf("%s: expected an error", tc.name)
		}
		if !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: error = %q, want it to mention %q", tc.name, err.Error(), tc.want)
		}
		if entries := projectEntries(t, svc); len(entries) != 0 {
			t.Fatalf("%s: hostile input created %d entries", tc.name, len(entries))
		}
	}
}

func TestSessionCloseRejectsHostileInput(t *testing.T) {
	items := make([]summaryItem, 101)
	for i := range items {
		items[i] = summaryItem{Kind: "feat", Title: fmt.Sprintf("item-%d", i)}
	}
	cases := []struct {
		name string
		in   sessionCloseInput
		want string
	}{
		{"traversal", sessionCloseInput{Directory: "/home/u/../../etc"}, ".."},
		{"nul byte", sessionCloseInput{Directory: "/tmp/a\x00b"}, "caracter"},
		{"too many items", sessionCloseInput{Directory: "/tmp/ok", Items: items}, "100"},
		{"bad date", sessionCloseInput{Directory: "/tmp/ok", Date: "2026-13-40"}, "YYYY-MM-DD"},
		{"bad session", sessionCloseInput{Directory: "/tmp/ok", Session: "../../x"}, "session"},
	}
	for _, tc := range cases {
		svc := openTestService(t)
		if _, err := callSessionClose(t, svc, tc.in, "dev-box", ""); err == nil {
			t.Fatalf("%s: expected an error", tc.name)
		} else if !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: error = %q, want it to mention %q", tc.name, err.Error(), tc.want)
		}
		if entries := projectEntries(t, svc); len(entries) != 0 {
			t.Fatalf("%s: hostile input created %d entries", tc.name, len(entries))
		}
	}
}

func TestSessionOpenWithoutHostHeaderLeavesMachineEmpty(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/sem-maquina"
	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_nohost"}, "", ""); err != nil {
		t.Fatalf("open without host header: %v", err)
	}
	entry := pathEntry(t, svc, path, "")
	if entry.OriginInstance != "" {
		t.Fatalf("origin_instance = %q, want empty", entry.OriginInstance)
	}
	notes := sessionNotes(t, svc, entry.ID)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	probe := probeNote(t, notes[0])
	if probe.Machine != "" {
		t.Fatalf("machine = %q, want empty", probe.Machine)
	}
	if strings.Contains(notes[0].ContentMarkdown, " · \n") {
		t.Fatalf("empty machine left a dangling separator:\n%s", notes[0].ContentMarkdown)
	}
	if !strings.HasPrefix(notes[0].ContentMarkdown, "## ") {
		t.Fatalf("header missing:\n%s", notes[0].ContentMarkdown)
	}

	// O cabecalho continua sanitizado, como no resumo v1.
	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: "/tmp/outro", Session: "ses_host"}, "host com espaco!", ""); err != nil {
		t.Fatalf("open with dirty host: %v", err)
	}
	dirty := pathEntry(t, svc, "/tmp/outro", "hostcomespaco")
	if dirty.OriginInstance != "hostcomespaco" {
		t.Fatalf("sanitized machine = %q", dirty.OriginInstance)
	}
}

func TestSessionOpenHistoryOfFirstSession(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/primeira"
	report, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_first"}, "dev-box", "")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if !strings.Contains(report, "primeira sessao em primeira") {
		t.Fatalf("report does not name the folder:\n%s", report)
	}
	if len(report) > maxHistoryBytes {
		t.Fatalf("report = %d bytes", len(report))
	}
}

func TestSessionOpenKeepsHistoryForTheSameMachineOnly(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/duas-maquinas"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_alpha", Name: "da-alpha",
	}, "alpha", ""); err != nil {
		t.Fatalf("open alpha: %v", err)
	}
	report, err := callSessionOpen(t, svc, sessionOpenInput{
		Directory: path, Session: "ses_beta", Name: "da-beta",
	}, "beta", "")
	if err != nil {
		t.Fatalf("open beta: %v", err)
	}
	if strings.Contains(report, "da-alpha") {
		t.Fatalf("history leaked the other machine:\n%s", report)
	}
}
