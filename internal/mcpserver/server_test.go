package mcpserver

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/joseti/dyarium/internal/store"
)

func openTestService(t *testing.T) *service {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return &service{store: st, logger: logger}
}

func callTool(t *testing.T, svc *service, in projectSummaryInput, host string) string {
	t.Helper()
	req := &mcp.CallToolRequest{
		Params: &mcp.CallToolParamsRaw{Name: toolName},
		Extra:  &mcp.RequestExtra{Header: http.Header{}},
	}
	if host != "" {
		req.Extra.Header.Set(hostHeader, host)
	}
	result, _, err := svc.recordProjectSummary(context.Background(), req, in)
	if err != nil {
		t.Fatalf("record project summary: %v", err)
	}
	if result == nil || len(result.Content) != 1 {
		t.Fatalf("result = %#v", result)
	}
	text, ok := result.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("content type = %T", result.Content[0])
	}
	return text.Text
}

func mcpNotebook(t *testing.T, svc *service) store.Notebook {
	t.Helper()
	notebook, err := svc.store.GetNotebook(context.Background(), store.MCPNotebookID)
	if err != nil {
		t.Fatalf("get mcp notebook: %v", err)
	}
	return notebook
}

func projectEntry(t *testing.T, svc *service, project string) store.Entry {
	t.Helper()
	entry, ok, err := svc.store.FindEntryByNotebookAndTitleFold(context.Background(), store.MCPNotebookID, project)
	if err != nil || !ok {
		t.Fatalf("find project %q: ok=%v err=%v", project, ok, err)
	}
	return entry
}

func projectBody(t *testing.T, svc *service, project string) string {
	t.Helper()
	entry := projectEntry(t, svc, project)
	notes, err := svc.store.ListNotes(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("list notes: %v", err)
	}
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	return notes[0].ContentMarkdown
}

func projectEntries(t *testing.T, svc *service) []store.Entry {
	t.Helper()
	entries, err := svc.store.ListEntriesFilteredNotebook(context.Background(), 100, 0, "", "", "", nil, store.MCPNotebookID)
	if err != nil {
		t.Fatalf("list project entries: %v", err)
	}
	return entries
}

func TestRecordCreatesMCPNotebookAndProjectEntry(t *testing.T) {
	svc := openTestService(t)
	message := callTool(t, svc, projectSummaryInput{
		Project: "Dyarium",
		Summary: "resumo do dia",
		Date:    "2026-11-09",
		Items: []summaryItem{
			{Kind: "feat", Title: "servidor mcp", Detail: "detalhe que nao deve aparecer no conciso"},
			{Title: "teste do store", Commit: "abc1234"},
		},
	}, "dev-box")

	if message == "" {
		t.Fatal("empty tool message")
	}
	notebook := mcpNotebook(t, svc)
	if notebook.Kind != store.NotebookKindMCP || notebook.Name != store.MCPNotebookName {
		t.Fatalf("mcp notebook = %+v", notebook)
	}

	// One entry, the project itself; there is no notebook per project and no
	// daily "Resumo" entry.
	entries := projectEntries(t, svc)
	if len(entries) != 1 {
		t.Fatalf("project entries = %d, want 1: %+v", len(entries), entries)
	}
	entry := entries[0]
	if entry.Title != "Dyarium" {
		t.Fatalf("title = %q, want Dyarium", entry.Title)
	}
	if entry.SummaryDetail != store.SummaryDetailConcise {
		t.Fatalf("summary_detail = %q, want concise", entry.SummaryDetail)
	}
	if entry.Status != store.EntryReady || entry.Source != "text" || entry.NotebookID != store.MCPNotebookID {
		t.Fatalf("entry = %+v", entry)
	}
	if entry.OriginKind != store.OriginKindDevice || entry.OriginInstance != "dev-box" {
		t.Fatalf("origin = %s/%s", entry.OriginKind, entry.OriginInstance)
	}
	if entry.RecordedAt == nil || entry.RecordedAt.Format(dateLayout) != "2026-11-09" {
		t.Fatalf("recorded_at = %v", entry.RecordedAt)
	}
	for _, other := range entries {
		if strings.HasPrefix(other.Title, "Resumo ") {
			t.Fatalf("daily entry must not exist: %q", other.Title)
		}
	}

	body := projectBody(t, svc, "Dyarium")
	if got := strings.Count(body, "- **"); got != 2 {
		t.Fatalf("bullets = %d, want 2:\n%s", got, body)
	}
	if !strings.Contains(body, "- **chore** teste do store · abc1234") {
		t.Fatalf("default kind or commit missing:\n%s", body)
	}
	// The objective summary is part of the concise block too, and comes before
	// the one-line items.
	summaryAt := strings.Index(body, "resumo do dia")
	bulletsAt := strings.Index(body, "- **")
	if summaryAt < 0 || bulletsAt < 0 || summaryAt > bulletsAt {
		t.Fatalf("summary must appear before the bullets:\n%s", body)
	}
	// Detail is hidden behind the collapsible block, closed in concise mode.
	detailsAt := strings.Index(body, ":::details ")
	if detailsAt < 0 || strings.Contains(body, ":::details open") {
		t.Fatalf("concise must open a closed details block:\n%s", body)
	}
	if strings.Contains(body[:detailsAt], "detalhe que nao deve aparecer") {
		t.Fatalf("concise visible part leaked detail:\n%s", body)
	}
	if !strings.Contains(body[detailsAt:], "detalhe que nao deve aparecer") {
		t.Fatalf("detail missing from the collapsible block:\n%s", body)
	}
}

func TestRecordUsesEntrySummaryDetail(t *testing.T) {
	svc := openTestService(t)
	callTool(t, svc, projectSummaryInput{
		Project: "Projeto Completo",
		Summary: "primeira sessao",
		Date:    "2026-11-09",
		Items:   []summaryItem{{Kind: "feat", Title: "inicio"}},
	}, "dev-box")

	entry := projectEntry(t, svc, "Projeto Completo")
	if _, err := svc.store.UpdateEntrySummaryDetail(context.Background(), entry.ID, store.SummaryDetailFull); err != nil {
		t.Fatalf("update summary detail: %v", err)
	}

	callTool(t, svc, projectSummaryInput{
		Project: "Projeto Completo",
		Summary: "resumo completo",
		Date:    "2026-11-10",
		Items: []summaryItem{{
			Kind: "feat", Title: "servidor mcp",
			Detail: "detalhe completo do item", Commit: "abc1234",
			URL: "https://example.com/commit/abc1234",
		}},
		Commits: []summaryCommit{{Hash: "abc1234", Message: "duplicado"}, {Hash: "def5678", Message: "extra"}},
		Links:   []summaryLink{{Label: "spec", URL: "https://example.com/spec"}},
	}, "dev-box")

	body := projectBody(t, svc, "Projeto Completo")
	for _, want := range []string{
		"resumo completo",
		"- **feat** servidor mcp · [abc1234](https://example.com/commit/abc1234)",
		":::details open Detalhes técnicos",
		"detalhe completo do item",
		"Commits:",
		"def5678 extra",
		"Links:",
		"spec: https://example.com/spec",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("full body missing %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "duplicado") {
		t.Fatalf("commit already shown per item was repeated:\n%s", body)
	}
	// The summary appears once, before the collapsible block in full mode.
	if strings.Count(body, "resumo completo") != 1 {
		t.Fatalf("summary repeated or missing:\n%s", body)
	}
	if strings.Index(body, "resumo completo") > strings.Index(body, ":::details open") {
		t.Fatalf("summary must come before the technical block:\n%s", body)
	}
}

func TestRecordDoesNotDuplicateIdenticalCall(t *testing.T) {
	svc := openTestService(t)
	in := projectSummaryInput{
		Project: "Dyarium",
		Summary: "resumo",
		Date:    "2026-11-09",
		Items:   []summaryItem{{Kind: "fix", Title: "correcao"}},
	}
	callTool(t, svc, in, "dev-box")
	callTool(t, svc, in, "dev-box")

	body := projectBody(t, svc, "Dyarium")
	if got := strings.Count(body, "<!-- mcp:"); got != 1 {
		t.Fatalf("dedup markers = %d, want 1:\n%s", got, body)
	}
	if got := strings.Count(body, "## "); got != 1 {
		t.Fatalf("session blocks = %d, want 1:\n%s", got, body)
	}
}

func TestRecordAppendsSecondSessionToSameProject(t *testing.T) {
	svc := openTestService(t)
	base := projectSummaryInput{Project: "Dyarium", Summary: "primeira", Date: "2026-11-09"}
	callTool(t, svc, base, "computador-1")
	base.Summary = "segunda"
	base.Date = "2026-11-10"
	callTool(t, svc, base, "computador-2")

	body := projectBody(t, svc, "Dyarium")
	if got := strings.Count(body, "## "); got != 2 {
		t.Fatalf("session blocks = %d, want 2:\n%s", got, body)
	}
	if !strings.Contains(body, "## 2026-11-09 ") || !strings.Contains(body, "## 2026-11-10 ") {
		t.Fatalf("dates missing from block headers:\n%s", body)
	}
	if !strings.Contains(body, "computador-1") || !strings.Contains(body, "computador-2") {
		t.Fatalf("computer names missing:\n%s", body)
	}
	if entries := projectEntries(t, svc); len(entries) != 1 {
		t.Fatalf("project entries = %d, want 1 (same project appends)", len(entries))
	}
}

func TestRecordReusesProjectCaseInsensitively(t *testing.T) {
	svc := openTestService(t)
	callTool(t, svc, projectSummaryInput{Project: "Dyarium", Summary: "um", Date: "2026-11-09"}, "dev-box")
	callTool(t, svc, projectSummaryInput{Project: "dyarium", Summary: "dois", Date: "2026-11-10"}, "dev-box")

	if entries := projectEntries(t, svc); len(entries) != 1 {
		t.Fatalf("project entries = %d, want 1: %+v", len(entries), entries)
	}
	if got := strings.Count(projectBody(t, svc, "Dyarium"), "## "); got != 2 {
		t.Fatalf("session blocks = %d, want 2", got)
	}
}

func TestRecordDifferentProjectsCreateSeparateEntries(t *testing.T) {
	svc := openTestService(t)
	callTool(t, svc, projectSummaryInput{Project: "Dyarium", Summary: "um", Date: "2026-11-09"}, "dev-box")
	callTool(t, svc, projectSummaryInput{Project: "Outro Projeto", Summary: "dois", Date: "2026-11-09"}, "dev-box")

	entries := projectEntries(t, svc)
	if len(entries) != 2 {
		t.Fatalf("project entries = %d, want 2: %+v", len(entries), entries)
	}
	titles := map[string]bool{}
	for _, entry := range entries {
		titles[entry.Title] = true
	}
	if !titles["Dyarium"] || !titles["Outro Projeto"] {
		t.Fatalf("titles = %v", titles)
	}
}

func TestRecordBlockHeaderHasDateAndTime(t *testing.T) {
	svc := openTestService(t)
	callTool(t, svc, projectSummaryInput{Project: "Dyarium", Summary: "resumo", Date: "2026-11-09"}, "dev-box")
	body := projectBody(t, svc, "Dyarium")
	if !regexp.MustCompile(`(?m)^## 2026-11-09 \d{2}:\d{2} · dev-box$`).MatchString(body) {
		t.Fatalf("header is not '## date time · computer':\n%s", body)
	}
}

func TestRecordSanitizesComputerHeader(t *testing.T) {
	svc := openTestService(t)
	callTool(t, svc, projectSummaryInput{Project: "Dyarium", Summary: "resumo", Date: "2026-11-09"}, "host com espaco!")
	body := projectBody(t, svc, "Dyarium")
	if !strings.Contains(body, "hostcomespaco") {
		t.Fatalf("sanitized computer missing:\n%s", body)
	}
	if strings.Contains(body, "host com espaco") {
		t.Fatalf("raw computer leaked:\n%s", body)
	}
}

func TestRecordConciseWithoutItemsFallsBackToCommitsAndLinks(t *testing.T) {
	svc := openTestService(t)

	callTool(t, svc, projectSummaryInput{
		Project: "So Commits",
		Date:    "2026-11-10",
		Commits: []summaryCommit{
			{Hash: "abc1234", Message: "primeiro", URL: "https://example.com/commit/abc1234"},
			{Hash: "def5678", Message: "segundo"},
		},
	}, "dev-box")
	body := projectBody(t, svc, "So Commits")
	for _, want := range []string{
		"- abc1234 primeiro https://example.com/commit/abc1234",
		"- def5678 segundo",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("concise commit line missing %q:\n%s", want, body)
		}
	}

	callTool(t, svc, projectSummaryInput{
		Project: "So Links",
		Date:    "2026-11-10",
		Links: []summaryLink{
			{Label: "spec", URL: "https://example.com/spec"},
			{URL: "https://example.com/plain"},
		},
	}, "dev-box")
	body = projectBody(t, svc, "So Links")
	for _, want := range []string{
		"- spec: https://example.com/spec",
		"- https://example.com/plain",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("concise link line missing %q:\n%s", want, body)
		}
	}
}

// TestRecordBookNamedProjectIsJustAProject replaces the old book conflict test:
// the MCP notebook is fixed, so a project whose name matches a book is simply a
// project entry.
func TestRecordBookNamedProjectIsJustAProject(t *testing.T) {
	svc := openTestService(t)
	now := time.Now().UTC()
	book := store.Notebook{
		ID: "livro", Name: "Meu Livro", Kind: store.NotebookKindBook,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := svc.store.CreateNotebook(context.Background(), book); err != nil {
		t.Fatalf("create book: %v", err)
	}

	callTool(t, svc, projectSummaryInput{Project: "Meu Livro", Summary: "resumo", Date: "2026-11-09"}, "dev-box")
	if entry := projectEntry(t, svc, "Meu Livro"); entry.NotebookID != store.MCPNotebookID {
		t.Fatalf("project notebook = %q, want %q", entry.NotebookID, store.MCPNotebookID)
	}
}
