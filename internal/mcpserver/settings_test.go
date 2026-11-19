package mcpserver

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func setMCPSetting(t *testing.T, svc *service, key, value string) {
	t.Helper()
	if err := svc.store.SetSetting(context.Background(), key, value); err != nil {
		t.Fatalf("set %s: %v", key, err)
	}
}

func listProjects(t *testing.T, svc *service) []ProjectInfo {
	t.Helper()
	projects, err := Projects(context.Background(), svc.store)
	if err != nil {
		t.Fatalf("list projects: %v", err)
	}
	return projects
}

func projectByTitle(t *testing.T, projects []ProjectInfo, title string) ProjectInfo {
	t.Helper()
	for _, project := range projects {
		if project.Title == title {
			return project
		}
	}
	t.Fatalf("project %q missing from %+v", title, projects)
	return ProjectInfo{}
}

func TestSettingsDefaultsLiveInOnePlace(t *testing.T) {
	svc := openTestService(t)

	settings := SettingsFrom(context.Background(), svc.store)
	want := Settings{
		IdleHours:       DefaultIdleHours,
		HistorySessions: DefaultHistorySessions,
		IncludeCommits:  true,
		IncludeLinks:    true,
	}
	if settings != want {
		t.Fatalf("settings = %+v, want %+v", settings, want)
	}
	if got := settings.IdleLimit(); got != time.Duration(DefaultIdleHours)*time.Hour {
		t.Fatalf("idle limit = %v, want %d h", got, DefaultIdleHours)
	}
	if DefaultIdleHours != 12 || DefaultHistorySessions != 3 {
		t.Fatalf("defaults drifted: %d h / %d sessoes", DefaultIdleHours, DefaultHistorySessions)
	}
}

func TestSettingsFromValuesReadsAndFallsBack(t *testing.T) {
	settings := SettingsFromValues(map[string]string{
		SettingPaused:          "true",
		SettingIdleHours:       "36",
		SettingHistorySessions: "0",
		SettingIncludeCommits:  "false",
		SettingIncludeLinks:    "false",
		SettingStoreFullPath:   "true",
		SettingMachineAlias:    "  estacao  ",
	})
	if !settings.Paused || settings.IdleHours != 36 || settings.HistorySessions != 0 ||
		settings.IncludeCommits || settings.IncludeLinks || !settings.StoreFullPath {
		t.Fatalf("settings = %+v", settings)
	}
	if settings.MachineAlias != "estacao" {
		t.Fatalf("alias = %q, want trimmed", settings.MachineAlias)
	}

	// Um valor fora do contrato (banco editado a mao) nao pode quebrar a
	// ferramenta: volta ao padrao em vez de virar estado invalido.
	fallback := SettingsFromValues(map[string]string{
		SettingIdleHours:       "0",
		SettingHistorySessions: "11",
		SettingIncludeCommits:  "talvez",
		SettingMachineAlias:    strings.Repeat("a", MaxMachineAliasRunes+1),
	})
	def := DefaultSettings()
	if fallback.IdleHours != def.IdleHours || fallback.HistorySessions != def.HistorySessions {
		t.Fatalf("invalid numbers did not fall back: %+v", fallback)
	}
	if fallback.IncludeCommits != def.IncludeCommits {
		t.Fatalf("invalid boolean did not fall back: %+v", fallback)
	}
	if len([]rune(fallback.MachineAlias)) != MaxMachineAliasRunes {
		t.Fatalf("alias = %d runes, want capped at %d", len([]rune(fallback.MachineAlias)), MaxMachineAliasRunes)
	}
}

func TestPausedBlocksEveryWrite(t *testing.T) {
	svc := openTestService(t)
	setMCPSetting(t, svc, SettingPaused, "true")
	const path = "/home/joseti/projects/pausado"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_pausa_open"}, "dev-box", ""); err == nil || !strings.Contains(err.Error(), "MCP pausado") {
		t.Fatalf("session_open error = %v, want paused", err)
	}
	if _, err := callSessionClose(t, svc, sessionCloseInput{Directory: path, Session: "ses_pausa_close", Summary: "nada"}, "dev-box", ""); err == nil || !strings.Contains(err.Error(), "MCP pausado") {
		t.Fatalf("session_close error = %v, want paused", err)
	}
	req := sessionRequest("dev-box", "")
	result, _, err := svc.recordProjectSummary(context.Background(), req, projectSummaryInput{
		Project: "pausado", Items: []summaryItem{{Kind: "feat", Title: "nao grava"}},
	})
	if err == nil || !strings.Contains(err.Error(), "MCP pausado") {
		t.Fatalf("record_project_summary error = %v, want paused", err)
	}
	if result != nil {
		t.Fatalf("paused tool returned a result: %#v", result)
	}

	if entries := projectEntries(t, svc); len(entries) != 0 {
		t.Fatalf("paused MCP wrote project entries: %+v", entries)
	}
}

func TestIdleHoursSettingDrivesDerivedState(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/ocioso"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_ociosa"}, "dev-box", ""); err != nil {
		t.Fatalf("open: %v", err)
	}
	note, ok, err := svc.store.FindSessionNote(context.Background(), store.MCPNotebookID, "ses_ociosa")
	if err != nil || !ok {
		t.Fatalf("find session: ok=%v err=%v", ok, err)
	}
	twoHoursAgo := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second).Format(time.RFC3339)
	if _, err := svc.store.DB().ExecContext(context.Background(),
		`UPDATE notes SET updated_at = ? WHERE id = ?`, twoHoursAgo, note.ID); err != nil {
		t.Fatalf("backdate note: %v", err)
	}

	setMCPSetting(t, svc, SettingIdleHours, "1")
	if got := projectByTitle(t, listProjects(t, svc), path).State; got != sessionStateInterrupted {
		t.Fatalf("state = %q, want interrupted with a 1 hour window", got)
	}

	setMCPSetting(t, svc, SettingIdleHours, "12")
	if got := projectByTitle(t, listProjects(t, svc), path).State; got != sessionStateOpen {
		t.Fatalf("state = %q, want open with the 12 hour window", got)
	}
}

func TestHistorySessionsSettingLimitsSessionOpenReport(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/historico-curto"
	setMCPSetting(t, svc, SettingHistorySessions, "1")

	days := []string{"2026-11-14", "2026-11-15", "2026-11-16"}
	for i, day := range days {
		session := "ses_curta_" + string(rune('a'+i))
		name := "velha-" + string(rune('1'+i))
		if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: session, Name: name}, "dev-box", ""); err != nil {
			t.Fatalf("open %s: %v", session, err)
		}
		backdateSession(t, svc, session, parseTestTime(day+"T09:00:00Z"))
	}

	report, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_curta_atual", Name: "atual"}, "dev-box", "")
	if err != nil {
		t.Fatalf("open current: %v", err)
	}
	if !strings.Contains(report, "velha-3") {
		t.Fatalf("history missing the newest past session:\n%s", report)
	}
	for _, old := range []string{"velha-1", "velha-2"} {
		if strings.Contains(report, old) {
			t.Fatalf("history honored the constant instead of mcp_history_sessions=1:\n%s", report)
		}
	}
	if !strings.Contains(report, "3 sessoes") {
		t.Fatalf("totals must still count every session:\n%s", report)
	}
}

func TestHistorySessionsZeroKeepsTotalsWithoutHeader(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/sem-historico"
	setMCPSetting(t, svc, SettingHistorySessions, "0")

	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_sem_hist", Name: "velha"}, "dev-box", ""); err != nil {
		t.Fatalf("open old: %v", err)
	}
	backdateSession(t, svc, "ses_sem_hist", parseTestTime("2026-11-18T09:00:00Z"))

	report, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_sem_hist_atual", Name: "atual"}, "dev-box", "")
	if err != nil {
		t.Fatalf("open current: %v", err)
	}
	if strings.Contains(report, "sessoes anteriores") || strings.Contains(report, "velha") {
		t.Fatalf("history list must be off:\n%s", report)
	}
	if !strings.Contains(report, "total: 1 sessao") {
		t.Fatalf("totals must survive a disabled history:\n%s", report)
	}
}

func TestRenderOmitsCommitsAndLinksWhenDisabled(t *testing.T) {
	in, _, err := normalize(projectSummaryInput{
		Project: "Sem Secoes",
		Date:    "2026-11-19",
		Summary: "resumo",
		Items: []summaryItem{{
			Kind: "feat", Title: "item", Detail: "detalhe do item", Commit: "abc1234",
			URL: "https://example.com/commit/abc1234",
		}},
		Commits: []summaryCommit{{Hash: "def5678", Message: "commit fora do item"}},
		Links:   []summaryLink{{Label: "spec", URL: "https://example.com/spec"}},
	})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	settings := DefaultSettings()
	settings.IncludeCommits = false
	settings.IncludeLinks = false

	body := renderBlock(in, store.SummaryDetailFull, "vps-dev", "<!-- mcp:teste -->", time.Date(2026, 11, 19, 8, 30, 0, 0, time.UTC), settings)
	for _, banned := range []string{"Commits:", "Links:"} {
		if strings.Contains(body, banned) {
			t.Fatalf("disabled section still rendered %q:\n%s", banned, body)
		}
	}
	// O fence canonico continua completo para os clientes; so a parte visivel
	// respeita as secoes desligadas.
	visible, _, _ := strings.Cut(body, "```dyarium-json")
	for _, banned := range []string{"def5678", "https://example.com/spec"} {
		if strings.Contains(visible, banned) {
			t.Fatalf("disabled section still rendered %q:\n%s", banned, body)
		}
	}
	if !strings.Contains(body, "detalhe do item") {
		t.Fatalf("item detail was dropped with the sections:\n%s", body)
	}
	if !strings.Contains(body, ":::details open ") {
		t.Fatalf("technical block lost its header:\n%s", body)
	}

	// Sem detalhe, commit nem link nao sobra secao: nada de cabecalho vazio.
	plain, _, err := normalize(projectSummaryInput{
		Project: "Vazio", Date: "2026-11-19",
		Items: []summaryItem{{Kind: "chore", Title: "sem detalhe"}},
	})
	if err != nil {
		t.Fatalf("normalize plain: %v", err)
	}
	body = renderBlock(plain, store.SummaryDetailConcise, "vps-dev", "<!-- mcp:teste -->", time.Now().UTC(), settings)
	if strings.Contains(body, ":::details") {
		t.Fatalf("empty technical header remained:\n%s", body)
	}
}

func TestRenderSessionOmitsCommitsAndLinksWhenDisabled(t *testing.T) {
	payload := sessionPayload{
		Version: 2,
		Kind:    sessionKind,
		Machine: "vps-dev",
		Path:    "/home/joseti/projects/sessao",
		Session: "ses_render",
		State:   sessionStateOpen,
		Date:    "2026-11-19",
		Time:    "10:00",
		Summary: "resumo",
		Items:   []summaryItem{{Kind: "feat", Title: "item", Detail: "detalhe"}},
		Commits: []summaryCommit{{Hash: "def5678", Message: "fora do item"}},
		Links:   []summaryLink{{Label: "spec", URL: "https://example.com/spec"}},
	}
	settings := DefaultSettings()
	settings.IncludeCommits = false
	settings.IncludeLinks = false

	body := renderSessionBlock(payload, sessionMarker("ses_render"), settings)
	for _, banned := range []string{"Commits:", "Links:"} {
		if strings.Contains(body, banned) {
			t.Fatalf("disabled section still rendered %q:\n%s", banned, body)
		}
	}
	visible, _, _ := strings.Cut(body, "```dyarium-json")
	for _, banned := range []string{"def5678", "https://example.com/spec"} {
		if strings.Contains(visible, banned) {
			t.Fatalf("disabled section still rendered %q:\n%s", banned, body)
		}
	}
	if !strings.Contains(body, "detalhe") {
		t.Fatalf("item detail was dropped:\n%s", body)
	}
}

func TestStoreFullPathSettingHidesAbsolutePath(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/privado/app"

	report, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_caminho"}, "dev-box", "")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if strings.Contains(report, "/home/joseti") {
		t.Fatalf("report leaked the absolute path with mcp_store_full_path off:\n%s", report)
	}
	if !strings.Contains(report, "aberta em app") {
		t.Fatalf("report must show the folder name:\n%s", report)
	}

	// O valor gravado na nota continua completo; so a exibicao encurta.
	note, ok, err := svc.store.FindSessionNote(context.Background(), store.MCPNotebookID, "ses_caminho")
	if err != nil || !ok {
		t.Fatalf("find session: ok=%v err=%v", ok, err)
	}
	if probe := probeNote(t, note); probe.Path != path {
		t.Fatalf("stored path = %q, want the full path", probe.Path)
	}

	closed, err := callSessionClose(t, svc, sessionCloseInput{
		Directory: path, Session: "ses_caminho", Items: []summaryItem{{Kind: "fix", Title: "fim"}},
	}, "dev-box", "")
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if strings.Contains(closed, "/home/joseti") {
		t.Fatalf("close report leaked the absolute path:\n%s", closed)
	}

	if got := projectByTitle(t, listProjects(t, svc), path).Path; got != "app" {
		t.Fatalf("projects path = %q, want the folder name", got)
	}

	setMCPSetting(t, svc, SettingStoreFullPath, "true")
	report, err = callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_caminho"}, "dev-box", "")
	if err != nil {
		t.Fatalf("reopen with full path: %v", err)
	}
	if !strings.Contains(report, "aberta em "+path) {
		t.Fatalf("report must show the full path when the setting is on:\n%s", report)
	}
	if got := projectByTitle(t, listProjects(t, svc), path).Path; got != path {
		t.Fatalf("projects path = %q, want the full path", got)
	}
}

func TestMachineAliasReplacesHostInSummary(t *testing.T) {
	svc := openTestService(t)
	setMCPSetting(t, svc, SettingMachineAlias, "estacao-do-joao")

	callTool(t, svc, projectSummaryInput{
		Project: "Alias",
		Summary: "resumo com apelido",
		Date:    "2026-11-19",
		Items:   []summaryItem{{Kind: "feat", Title: "item"}},
	}, "host-real")

	body := projectBody(t, svc, "Alias")
	if strings.Contains(body, "host-real") {
		t.Fatalf("summary still shows the sanitized host:\n%s", body)
	}
	if !strings.Contains(body, "estacao-do-joao") {
		t.Fatalf("summary does not show the configured alias:\n%s", body)
	}
	if !strings.Contains(body, `"host":"estacao-do-joao"`) {
		t.Fatalf("fence host does not carry the alias:\n%s", body)
	}
}

func TestProjectsListsOnlyTheMCPNotebook(t *testing.T) {
	svc := openTestService(t)
	const path = "/home/joseti/projects/lista"

	if _, err := callSessionOpen(t, svc, sessionOpenInput{Directory: path, Session: "ses_lista_1", Name: "primeira"}, "dev-box", ""); err != nil {
		t.Fatalf("open first: %v", err)
	}
	// A ordem das sessoes e por criacao; o helper do pacote move o relogio da
	// primeira para a segunda ser, sem duvida, a mais recente.
	backdateSession(t, svc, "ses_lista_1", parseTestTime("2026-11-18T09:00:00Z"))
	if _, err := callSessionClose(t, svc, sessionCloseInput{
		Directory: path, Session: "ses_lista_2", Summary: "fechando",
		Items: []summaryItem{{Kind: "feat", Title: "rota nova"}},
	}, "dev-box", ""); err != nil {
		t.Fatalf("close second: %v", err)
	}
	callTool(t, svc, projectSummaryInput{Project: "sem-pasta", Summary: "entrega", Items: []summaryItem{{Kind: "docs", Title: "texto"}}}, "dev-box")

	// Uma nota fora do caderno MCP nunca entra na lista.
	other := store.Entry{ID: "entrada-comum", Title: "/home/joseti/projects/comum", Status: store.EntryReady, Source: "text", NotebookID: store.DefaultNotebookID}
	if err := svc.store.CreateEntry(context.Background(), other); err != nil {
		t.Fatalf("create other entry: %v", err)
	}

	projects := listProjects(t, svc)
	if len(projects) != 2 {
		t.Fatalf("projects = %d, want the two MCP entries: %+v", len(projects), projects)
	}
	if _, err := svc.store.DB().ExecContext(context.Background(), `UPDATE entries SET archived = 1 WHERE id = ?`,
		projectByTitle(t, projects, "sem-pasta").ID); err != nil {
		t.Fatalf("archive project: %v", err)
	}

	projects = listProjects(t, svc)
	withSessions := projectByTitle(t, projects, path)
	if withSessions.Sessions != 2 {
		t.Fatalf("sessions = %d, want 2", withSessions.Sessions)
	}
	if withSessions.State != sessionStateClosed {
		t.Fatalf("state = %q, want closed", withSessions.State)
	}
	if withSessions.Path != "lista" {
		t.Fatalf("path = %q, want the folder name", withSessions.Path)
	}
	if withSessions.SummaryDetail != store.SummaryDetailConcise {
		t.Fatalf("summary_detail = %q", withSessions.SummaryDetail)
	}
	if withSessions.Archived {
		t.Fatalf("project with sessions reads as archived: %+v", withSessions)
	}
	last, err := time.Parse(time.RFC3339, withSessions.LastSessionAt)
	if err != nil {
		t.Fatalf("last_session_at = %q, not RFC 3339: %v", withSessions.LastSessionAt, err)
	}
	if last.IsZero() {
		t.Fatal("last_session_at is zero")
	}

	withoutSessions := projectByTitle(t, projects, "sem-pasta")
	if withoutSessions.Sessions != 0 || withoutSessions.State != "" || withoutSessions.LastSessionAt != "" {
		t.Fatalf("summary-only project = %+v, want no session", withoutSessions)
	}
	if !withoutSessions.Archived {
		t.Fatalf("archived flag not reported: %+v", withoutSessions)
	}
	if withoutSessions.Path != "sem-pasta" {
		t.Fatalf("path = %q, want the project title as folder name", withoutSessions.Path)
	}
}
