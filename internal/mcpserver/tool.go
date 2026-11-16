package mcpserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

// Input limits. They protect the notebook from huge payloads sent by a buggy or
// malicious agent; they are validated before any write.
const (
	maxProjectRunes = 100
	maxSummaryRunes = 10000
	maxItems        = 100
	maxItemDetail   = 8192
	maxCommits      = 100
	maxLinks        = 50
	maxComputer     = 64
	defaultItemKind = "chore"
	dateLayout      = "2006-01-02"
)

// summaryItem is one structured piece of work reported by the agent.
type summaryItem struct {
	Kind   string `json:"kind,omitempty" jsonschema:"tipo do item, por exemplo feat, fix, test ou chore; vazio vira chore"`
	Title  string `json:"title" jsonschema:"titulo curto do item concluido"`
	Detail string `json:"detail,omitempty" jsonschema:"detalhe do item; aparece apenas quando o projeto esta no nivel completo"`
	Commit string `json:"commit,omitempty" jsonschema:"hash curto do commit relacionado, se houver"`
	URL    string `json:"url,omitempty" jsonschema:"endereco http ou https relacionado ao commit, se houver"`
}

// summaryCommit is a commit that does not belong to a single item.
type summaryCommit struct {
	Hash    string `json:"hash,omitempty" jsonschema:"hash do commit"`
	Message string `json:"message,omitempty" jsonschema:"mensagem do commit"`
	URL     string `json:"url,omitempty" jsonschema:"endereco http ou https do commit, se houver"`
}

// summaryLink is an extra reference for the session.
type summaryLink struct {
	Label string `json:"label,omitempty" jsonschema:"rotulo do link"`
	URL   string `json:"url" jsonschema:"endereco http ou https"`
}

// projectSummaryInput is the contract of record_project_summary.
type projectSummaryInput struct {
	Project string          `json:"project" jsonschema:"nome do projeto; vira o titulo da entrada no caderno Projetos"`
	Summary string          `json:"summary,omitempty" jsonschema:"resumo curto do que foi feito na sessao"`
	Items   []summaryItem   `json:"items,omitempty" jsonschema:"itens estruturados do trabalho concluido"`
	Commits []summaryCommit `json:"commits,omitempty" jsonschema:"commits que nao pertencem a um item"`
	Links   []summaryLink   `json:"links,omitempty" jsonschema:"links de referencia da sessao"`
	Date    string          `json:"date,omitempty" jsonschema:"dia do trabalho no formato YYYY-MM-DD; vazio usa hoje em UTC"`
}

// canonicalPayload is the stable encoding used to detect a repeated call.
type canonicalPayload struct {
	Project  string          `json:"project"`
	Date     string          `json:"date"`
	Summary  string          `json:"summary"`
	Items    []summaryItem   `json:"items"`
	Commits  []summaryCommit `json:"commits"`
	Links    []summaryLink   `json:"links"`
	Computer string          `json:"computer"`
}

func (s *service) recordProjectSummary(ctx context.Context, req *mcp.CallToolRequest, in projectSummaryInput) (*mcp.CallToolResult, any, error) {
	if s.store == nil {
		return nil, nil, errors.New("diario indisponivel")
	}
	computer := computerFromRequest(req)
	message, err := s.record(ctx, in, computer)
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: message}},
	}, nil, nil
}

// normalize validates the input at the boundary and fills the defaults.
func normalize(in projectSummaryInput) (projectSummaryInput, time.Time, error) {
	in.Project = strings.TrimSpace(in.Project)
	if in.Project == "" {
		return in, time.Time{}, errors.New("project obrigatorio")
	}
	if utf8.RuneCountInString(in.Project) > maxProjectRunes {
		return in, time.Time{}, fmt.Errorf("project maior que %d caracteres", maxProjectRunes)
	}
	summary, err := normalizeSummary(in.Summary)
	if err != nil {
		return in, time.Time{}, err
	}
	in.Summary = summary
	if err := normalizeItems(in.Items); err != nil {
		return in, time.Time{}, err
	}
	if err := normalizeCommits(in.Commits); err != nil {
		return in, time.Time{}, err
	}
	if err := normalizeLinks(in.Links); err != nil {
		return in, time.Time{}, err
	}
	day, err := normalizeDate(in.Date)
	if err != nil {
		return in, time.Time{}, err
	}
	in.Date = day.Format(dateLayout)
	return in, day, nil
}

// normalizeSummary trims and bounds the objective summary shared by both
// contracts.
func normalizeSummary(summary string) (string, error) {
	summary = strings.TrimSpace(summary)
	if utf8.RuneCountInString(summary) > maxSummaryRunes {
		return "", fmt.Errorf("summary maior que %d caracteres", maxSummaryRunes)
	}
	return summary, nil
}

// normalizeItems validates the structured items in place: title required,
// unknown kind becomes chore and every field is trimmed and bounded.
func normalizeItems(items []summaryItem) error {
	if len(items) > maxItems {
		return fmt.Errorf("items acima do limite de %d", maxItems)
	}
	for i := range items {
		item := &items[i]
		item.Kind = strings.TrimSpace(item.Kind)
		if item.Kind == "" {
			item.Kind = defaultItemKind
		}
		item.Title = strings.TrimSpace(item.Title)
		if item.Title == "" {
			return fmt.Errorf("items[%d].title obrigatorio", i)
		}
		item.Detail = strings.TrimSpace(item.Detail)
		if utf8.RuneCountInString(item.Detail) > maxItemDetail {
			return fmt.Errorf("items[%d].detail maior que %d caracteres", i, maxItemDetail)
		}
		item.Commit = strings.TrimSpace(item.Commit)
		item.URL = strings.TrimSpace(item.URL)
	}
	return nil
}

// normalizeCommits trims the commits that do not belong to an item.
func normalizeCommits(commits []summaryCommit) error {
	if len(commits) > maxCommits {
		return fmt.Errorf("commits acima do limite de %d", maxCommits)
	}
	for i := range commits {
		commits[i].Hash = strings.TrimSpace(commits[i].Hash)
		commits[i].Message = strings.TrimSpace(commits[i].Message)
		commits[i].URL = strings.TrimSpace(commits[i].URL)
	}
	return nil
}

// normalizeLinks trims the reference links of a session.
func normalizeLinks(links []summaryLink) error {
	if len(links) > maxLinks {
		return fmt.Errorf("links acima do limite de %d", maxLinks)
	}
	for i := range links {
		links[i].Label = strings.TrimSpace(links[i].Label)
		links[i].URL = strings.TrimSpace(links[i].URL)
	}
	return nil
}

// normalizeDate turns the optional YYYY-MM-DD day into a UTC midnight; an empty
// value means today.
func normalizeDate(rawDate string) (time.Time, error) {
	rawDate = strings.TrimSpace(rawDate)
	if rawDate == "" {
		return startOfDay(time.Now().UTC()), nil
	}
	parsed, err := time.Parse(dateLayout, rawDate)
	if err != nil {
		return time.Time{}, errors.New("date deve ser YYYY-MM-DD")
	}
	return parsed.UTC(), nil
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// sessionStamp combines the work day reported by the agent with the current UTC
// time. The block header shows both because several days accumulate in the same
// project entry.
func sessionStamp(day time.Time) time.Time {
	now := time.Now().UTC()
	return time.Date(day.Year(), day.Month(), day.Day(), now.Hour(), now.Minute(), 0, 0, time.UTC)
}

// record performs the upsert. It returns a short pt-BR message for the agent.
func (s *service) record(ctx context.Context, in projectSummaryInput, computer string) (string, error) {
	in, day, err := normalize(in)
	if err != nil {
		return "", err
	}
	notebook, err := s.store.EnsureMCPNotebook(ctx)
	if err != nil {
		return "", fmt.Errorf("abrir caderno de projetos: %w", err)
	}
	entry, err := s.entry(ctx, notebook.ID, in.Project, day, computer)
	if err != nil {
		return "", err
	}
	note, found, err := s.note(ctx, entry.ID)
	if err != nil {
		return "", err
	}
	marker, err := summaryMarker(in, computer)
	if err != nil {
		return "", err
	}
	block := renderBlock(in, entry.SummaryDetail, computer, marker, sessionStamp(day))

	if found {
		body := noteBody(note)
		if strings.Contains(body, marker) {
			return "resumo de " + in.Project + " ja registrado em " + in.Date, nil
		}
		if err := s.appendBlock(ctx, note.ID, body, note.BodyVersion, block, marker); err != nil {
			return "", err
		}
		return "resumo de " + in.Project + " registrado em " + in.Date, nil
	}

	now := time.Now().UTC()
	created := store.Note{
		ID:              id.New(),
		EntryID:         entry.ID,
		ContentMarkdown: block,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.store.CreateNote(ctx, created); err != nil {
		return "", fmt.Errorf("criar nota do resumo: %w", err)
	}
	return "resumo de " + in.Project + " registrado em " + in.Date, nil
}

// entry finds the project entry by title (case-insensitively) in the MCP
// notebook and creates it when it does not exist. The entry is the project:
// every session of that project appends a block to its note.
func (s *service) entry(ctx context.Context, notebookID, project string, day time.Time, computer string) (store.Entry, error) {
	if entry, ok, err := s.store.FindEntryByNotebookAndTitleFold(ctx, notebookID, project); err != nil {
		return store.Entry{}, fmt.Errorf("procurar projeto: %w", err)
	} else if ok {
		return entry, nil
	}
	now := time.Now().UTC()
	recordedAt := day
	entry := store.Entry{
		ID:             id.New(),
		Title:          project,
		Status:         store.EntryReady,
		Source:         "text",
		NotebookID:     notebookID,
		RecordedAt:     &recordedAt,
		CreatedAt:      now,
		UpdatedAt:      now,
		OriginInstance: computer,
		OriginKind:     store.OriginKindDevice,
		SummaryDetail:  store.SummaryDetailConcise,
	}
	if err := s.store.CreateEntry(ctx, entry); err != nil {
		// A concurrent call may have created the project first. Re-read once
		// before failing, so a race does not turn into an error for the agent.
		if found, ok, findErr := s.store.FindEntryByNotebookAndTitleFold(ctx, notebookID, project); findErr == nil && ok {
			return found, nil
		}
		return store.Entry{}, fmt.Errorf("criar projeto: %w", err)
	}
	return entry, nil
}

// note returns the newest note of the project entry, which is where the session
// blocks accumulate.
func (s *service) note(ctx context.Context, entryID string) (store.Note, bool, error) {
	notes, err := s.store.ListNotes(ctx, entryID)
	if err != nil {
		return store.Note{}, false, fmt.Errorf("listar notas do resumo: %w", err)
	}
	if len(notes) == 0 {
		return store.Note{}, false, nil
	}
	return notes[0], true, nil
}

// appendBlock writes the merged body and retries once when another writer moved
// the note between the read and the write.
func (s *service) appendBlock(ctx context.Context, noteID, body, version, block, marker string) error {
	merged := block
	if strings.TrimSpace(body) != "" {
		merged = body + "\n\n" + block
	}
	_, conflict, err := s.store.UpdateNoteBody(ctx, noteID, merged, version)
	if err != nil {
		return fmt.Errorf("anexar ao projeto: %w", err)
	}
	if !conflict {
		return nil
	}

	fresh, err := s.store.GetNote(ctx, noteID)
	if err != nil {
		return fmt.Errorf("reler projeto: %w", err)
	}
	freshBody := noteBody(fresh)
	if strings.Contains(freshBody, marker) {
		return nil
	}
	merged = block
	if strings.TrimSpace(freshBody) != "" {
		merged = freshBody + "\n\n" + block
	}
	_, conflict, err = s.store.UpdateNoteBody(ctx, noteID, merged, fresh.BodyVersion)
	if err != nil {
		return fmt.Errorf("anexar ao projeto: %w", err)
	}
	if conflict {
		return errors.New("o projeto mudou durante a gravacao; tente novamente")
	}
	return nil
}

func noteBody(note store.Note) string {
	if strings.TrimSpace(note.ContentMarkdown) != "" {
		return note.ContentMarkdown
	}
	return note.Document
}

// summaryMarker is the invisible dedup key of one call. It includes the
// computer so the same payload from another computer is still recorded.
func summaryMarker(in projectSummaryInput, computer string) (string, error) {
	payload := canonicalPayload{
		Project:  in.Project,
		Date:     in.Date,
		Summary:  in.Summary,
		Items:    in.Items,
		Commits:  in.Commits,
		Links:    in.Links,
		Computer: computer,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("codificar resumo: %w", err)
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("<!-- mcp:%s -->", hex.EncodeToString(sum[:])[:12]), nil
}

// computerFromRequest sanitizes the host header into a display name. Anything
// outside [A-Za-z0-9_-] is dropped and the value never reaches a path or an
// identity decision. A missing header reads as "unknown", the v1 behaviour.
func computerFromRequest(req *mcp.CallToolRequest) string {
	if machine := machineFromRequest(req); machine != "" {
		return machine
	}
	return "unknown"
}

// machineFromRequest is the sanitized host header of the MCP call. Unlike the v1
// computer name, a missing header stays empty: the session contract records the
// machine as provenance and does not invent one.
func machineFromRequest(req *mcp.CallToolRequest) string {
	if req == nil || req.Extra == nil {
		return ""
	}
	raw := strings.TrimSpace(req.Extra.Header.Get(hostHeader))
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_' || r == '-':
		default:
			continue
		}
		if b.Len() >= maxComputer {
			break
		}
		b.WriteRune(r)
	}
	return b.String()
}
