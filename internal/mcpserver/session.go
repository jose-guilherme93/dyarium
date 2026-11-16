package mcpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

// O contrato de sessao por pasta: uma entry por (maquina, caminho) no caderno
// Projetos e uma nota por sessao. Nada de tabela nova: o estado da sessao mora
// no fence v2 da propria nota e e derivado na leitura.

const (
	sessionOpenTool  = "session_open"
	sessionCloseTool = "session_close"

	// sessionIDMetaKey is where an MCP client announces the id of its own
	// session. OpenCode sends it in the tools/call _meta object.
	sessionIDMetaKey = "ai.opencode/sessionID"

	sessionKind = "session"

	sessionStateOpen        = "open"
	sessionStateClosed      = "closed"
	sessionStateInterrupted = "interrupted"

	maxPathRunes = 512
	maxNameRunes = 120

	sessionIDPrefix = "ses_"
	// sessionIDBytes yields the 12 hex characters of a generated id.
	sessionIDBytes = 6

	// maxHistoryBytes caps the folder history returned by session_open.
	maxHistoryBytes = 2048
	// historySessions is how many previous sessions the agent sees.
	historySessions = 3
	// historyReserveBytes stays free so the totals line always fits.
	historyReserveBytes = 64
	// maxHistoryPathBytes caps how much of the path the history header shows, so
	// a pathological path cannot eat the budget of the totals.
	maxHistoryPathBytes = 256
	// sessionIdleLimit is when an open session reads as interrupted. The state
	// is derived on read: the server never writes it and has no periodic job.
	sessionIdleLimit = 12 * time.Hour
)

// sessionOpenInput is the contract of session_open.
type sessionOpenInput struct {
	Directory string `json:"directory" jsonschema:"caminho absoluto da pasta do projeto"`
	Name      string `json:"name,omitempty" jsonschema:"nome curto da sessao; vazio usa o nome da pasta"`
	Summary   string `json:"summary,omitempty" jsonschema:"resumo curto do que a sessao vai fazer"`
	Session   string `json:"session,omitempty" jsonschema:"id da sessao do cliente; vazio usa o id de _meta ou gera um"`
}

// sessionCloseInput is the contract of session_close.
type sessionCloseInput struct {
	Directory string          `json:"directory,omitempty" jsonschema:"caminho absoluto da pasta, quando a sessao nao foi aberta pelo servidor"`
	Session   string          `json:"session,omitempty" jsonschema:"id da sessao; vazio usa o id de _meta ou gera um"`
	Summary   string          `json:"summary,omitempty" jsonschema:"resumo curto do que foi feito na sessao"`
	Items     []summaryItem   `json:"items,omitempty" jsonschema:"itens estruturados do trabalho concluido"`
	Commits   []summaryCommit `json:"commits,omitempty" jsonschema:"commits que nao pertencem a um item"`
	Links     []summaryLink   `json:"links,omitempty" jsonschema:"links de referencia da sessao"`
	Date      string          `json:"date,omitempty" jsonschema:"dia do trabalho no formato YYYY-MM-DD; vazio usa hoje em UTC"`
}

func (s *service) sessionOpen(ctx context.Context, req *mcp.CallToolRequest, in sessionOpenInput) (*mcp.CallToolResult, any, error) {
	if s.store == nil {
		return nil, nil, errors.New("diario indisponivel")
	}
	sessionID, err := resolveSessionID(req, in.Session)
	if err != nil {
		return nil, nil, err
	}
	message, err := s.openSession(ctx, in, machineFromRequest(req), sessionID)
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: message}},
	}, nil, nil
}

func (s *service) sessionClose(ctx context.Context, req *mcp.CallToolRequest, in sessionCloseInput) (*mcp.CallToolResult, any, error) {
	if s.store == nil {
		return nil, nil, errors.New("diario indisponivel")
	}
	sessionID, err := resolveSessionID(req, in.Session)
	if err != nil {
		return nil, nil, err
	}
	message, err := s.closeSession(ctx, in, machineFromRequest(req), sessionID)
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: message}},
	}, nil, nil
}

// openSession opens (or reopens) the note of one session.
func (s *service) openSession(ctx context.Context, in sessionOpenInput, machine, sessionID string) (string, error) {
	dir, err := normalizeSessionPath(in.Directory)
	if err != nil {
		return "", err
	}
	name, err := normalizeSessionName(in.Name, dir)
	if err != nil {
		return "", err
	}
	summary, err := normalizeSummary(in.Summary)
	if err != nil {
		return "", err
	}
	notebook, err := s.store.EnsureMCPNotebook(ctx)
	if err != nil {
		return "", fmt.Errorf("abrir caderno de projetos: %w", err)
	}
	entry, err := s.store.EnsureProjectEntry(ctx, notebook.ID, dir, machine)
	if err != nil {
		return "", err
	}

	existing, found, err := s.store.FindSessionNote(ctx, notebook.ID, sessionID)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC().Truncate(time.Second)
	if found {
		// So um nome enviado explicitamente renomeia a nota; sem nome o titulo
		// atual e o nome escolhido na abertura.
		if err := s.reopenSession(ctx, existing, sessionID, strings.TrimSpace(in.Name), summary); err != nil {
			return "", err
		}
		return s.pathHistory(ctx, entry.ID, dir, existing.ID, sessionReportLine(sessionID, dir))
	}

	payload := sessionPayload{
		Version: 2,
		Kind:    sessionKind,
		Machine: machine,
		Path:    dir,
		Session: sessionID,
		State:   sessionStateOpen,
		Opened:  now.Format(time.RFC3339),
		Date:    now.Format(dateLayout),
		Time:    now.Format("15:04"),
		Summary: summary,
	}
	note := store.Note{
		ID:              id.New(),
		EntryID:         entry.ID,
		Title:           name,
		ContentMarkdown: renderSessionBlock(payload, sessionMarker(sessionID)),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.store.CreateNote(ctx, note); err != nil {
		return "", fmt.Errorf("criar nota da sessao: %w", err)
	}
	return s.pathHistory(ctx, entry.ID, dir, note.ID, sessionReportLine(sessionID, dir))
}

// sessionReportLine is the first line of the session_open result. It always
// carries the session id, even when the client sent it in _meta: it is the only
// way a client that did not name the session can close the same note later.
func sessionReportLine(sessionID, dir string) string {
	return "sessao " + sessionID + " aberta em " + historyPath(dir)
}

// reopenSession keeps the identity of the first open: the same note, the same
// opened stamp and the same fence. It updates the name when one was sent and,
// when a new summary arrives, the rendered body; a body edited by hand (without
// a valid v2 fence) is only touched, never rewritten.
func (s *service) reopenSession(ctx context.Context, note store.Note, sessionID, name, summary string) error {
	if name != "" && name != note.Title {
		if err := s.store.UpdateNoteTitle(ctx, note.ID, name); err != nil {
			return err
		}
	}
	if summary != "" {
		payload, ok := parseSessionFence(noteBody(note))
		if !ok {
			return s.store.TouchNote(ctx, note.ID)
		}
		if payload.Session == "" {
			payload.Session = sessionID
		}
		if payload.Summary != summary {
			payload.Summary = summary
			body := renderSessionBlock(payload, sessionMarker(payload.Session))
			if err := s.replaceSessionBody(ctx, note, body); err != nil {
				return err
			}
		}
	}
	return s.store.TouchNote(ctx, note.ID)
}

// closeSession seals the session note with the closing report. A session that
// was never opened is created already closed when the caller knows the folder.
func (s *service) closeSession(ctx context.Context, in sessionCloseInput, machine, sessionID string) (string, error) {
	dir, err := normalizeOptionalSessionPath(in.Directory)
	if err != nil {
		return "", err
	}
	summary, err := normalizeSummary(in.Summary)
	if err != nil {
		return "", err
	}
	if err := normalizeItems(in.Items); err != nil {
		return "", err
	}
	if err := normalizeCommits(in.Commits); err != nil {
		return "", err
	}
	if err := normalizeLinks(in.Links); err != nil {
		return "", err
	}
	day, err := normalizeDate(in.Date)
	if err != nil {
		return "", err
	}
	notebook, err := s.store.EnsureMCPNotebook(ctx)
	if err != nil {
		return "", fmt.Errorf("abrir caderno de projetos: %w", err)
	}
	existing, found, err := s.store.FindSessionNote(ctx, notebook.ID, sessionID)
	if err != nil {
		return "", err
	}

	now := time.Now().UTC().Truncate(time.Second)
	stamp := sessionStamp(day)
	closed := now.Format(time.RFC3339)
	if found {
		payload, ok := parseSessionFence(noteBody(existing))
		if !ok {
			payload = sessionPayload{
				Opened: now.Format(time.RFC3339),
			}
		}
		payload.Version = 2
		payload.Kind = sessionKind
		if payload.Session == "" {
			payload.Session = sessionID
		}
		if payload.Path == "" {
			payload.Path = dir
		}
		if payload.Machine == "" {
			payload.Machine = machine
		}
		if payload.Opened == "" {
			payload.Opened = now.Format(time.RFC3339)
		}
		payload.State = sessionStateClosed
		payload.Closed = closed
		payload.Date = stamp.Format(dateLayout)
		payload.Time = stamp.Format("15:04")
		// Um fechamento sem resumo ou sem itens nao apaga o que ja foi
		// registrado na abertura; o que vem preenchido vence.
		if summary != "" {
			payload.Summary = summary
		}
		if len(in.Items) > 0 {
			payload.Items = in.Items
		}
		if len(in.Commits) > 0 {
			payload.Commits = in.Commits
		}
		if len(in.Links) > 0 {
			payload.Links = in.Links
		}
		body := renderSessionBlock(payload, sessionMarker(payload.Session))
		if err := s.replaceSessionBody(ctx, existing, body); err != nil {
			return "", err
		}
		return "sessao " + payload.Session + " fechada em " + payload.Path, nil
	}
	if dir == "" {
		return "", fmt.Errorf("sessao %s nao encontrada; informe o directory do projeto para registrar o fechamento", sessionID)
	}
	entry, err := s.store.EnsureProjectEntry(ctx, notebook.ID, dir, machine)
	if err != nil {
		return "", err
	}
	payload := sessionPayload{
		Version: 2,
		Kind:    sessionKind,
		Machine: machine,
		Path:    dir,
		Session: sessionID,
		State:   sessionStateClosed,
		Opened:  closed,
		Closed:  closed,
		Date:    stamp.Format(dateLayout),
		Time:    stamp.Format("15:04"),
		Summary: summary,
		Items:   in.Items,
		Commits: in.Commits,
		Links:   in.Links,
	}
	note := store.Note{
		ID:              id.New(),
		EntryID:         entry.ID,
		Title:           defaultSessionName(dir),
		ContentMarkdown: renderSessionBlock(payload, sessionMarker(sessionID)),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.store.CreateNote(ctx, note); err != nil {
		return "", fmt.Errorf("criar nota da sessao: %w", err)
	}
	return "sessao " + sessionID + " fechada em " + dir + " (nota criada, sem abertura previa)", nil
}

// replaceSessionBody writes a new body over the note, retrying once when another
// writer moved it between the read and the write.
func (s *service) replaceSessionBody(ctx context.Context, note store.Note, body string) error {
	_, conflict, err := s.store.UpdateNoteBody(ctx, note.ID, body, note.BodyVersion)
	if err != nil {
		return fmt.Errorf("gravar sessao: %w", err)
	}
	if !conflict {
		return nil
	}
	fresh, err := s.store.GetNote(ctx, note.ID)
	if err != nil {
		return fmt.Errorf("reler sessao: %w", err)
	}
	_, conflict, err = s.store.UpdateNoteBody(ctx, note.ID, body, fresh.BodyVersion)
	if err != nil {
		return fmt.Errorf("gravar sessao: %w", err)
	}
	if conflict {
		return errors.New("a sessao mudou durante a gravacao; tente novamente")
	}
	return nil
}

// pathHistory is the rest of the session_open result, after the line that
// carries the session id: the last sessions of the folder, newest first, one
// line each, plus the totals. The opening line is passed in and counts against
// the cap, so a long id or path never pushes the totals out of the result.
func (s *service) pathHistory(ctx context.Context, entryID, dir, currentNoteID, firstLine string) (string, error) {
	notes, err := s.store.ListNotes(ctx, entryID)
	if err != nil {
		return "", fmt.Errorf("ler historico do projeto: %w", err)
	}
	// O banco guarda created_at com resolucao de segundos; o desempate por id
	// mantem a ordem estavel sem depender da ordem de insercao.
	sort.SliceStable(notes, func(i, j int) bool {
		if !notes[i].CreatedAt.Equal(notes[j].CreatedAt) {
			return notes[i].CreatedAt.After(notes[j].CreatedAt)
		}
		return notes[i].ID > notes[j].ID
	})

	type pastSession struct {
		name  string
		date  string
		items int
		state string
	}
	var past []pastSession
	items := 0
	now := time.Now().UTC()
	for _, note := range notes {
		if note.ID == currentNoteID {
			continue
		}
		payload, ok := parseSessionFence(noteBody(note))
		count := 0
		if ok {
			count = len(payload.Items)
		}
		items += count
		state := ""
		if ok {
			state = sessionState(payload, note, now)
		}
		past = append(past, pastSession{
			name:  note.Title,
			date:  sessionDate(note, payload, ok),
			items: count,
			state: state,
		})
	}

	var out strings.Builder
	if firstLine != "" {
		out.WriteString(firstLine)
		out.WriteString("\n")
	}
	if len(past) == 0 {
		out.WriteString("primeira sessao em ")
		out.WriteString(historyPath(dir))
		return capBytes(out.String(), maxHistoryBytes), nil
	}
	out.WriteString("sessoes anteriores em ")
	out.WriteString(historyPath(dir))
	out.WriteString(":\n")

	var lines strings.Builder
	for i, session := range past {
		if i >= historySessions {
			break
		}
		name := session.name
		if strings.TrimSpace(name) == "" {
			name = defaultSessionName(dir)
		}
		line := session.date + " " + safeInline(name) + " (" + itemLabel(session.items)
		if session.state == sessionStateInterrupted {
			line += ", " + sessionStateInterrupted
		}
		line += ")\n"
		if out.Len()+lines.Len()+len(line)+historyReserveBytes > maxHistoryBytes {
			break
		}
		lines.WriteString(line)
	}
	out.WriteString(lines.String())
	out.WriteString("\ntotal: ")
	out.WriteString(sessionLabel(len(past)))
	out.WriteString(", ")
	out.WriteString(itemLabel(items))
	return capBytes(out.String(), maxHistoryBytes), nil
}

// sessionState derives the state the client reads. An open session with more
// than 12 hours without activity reads as interrupted; the fence is never
// rewritten because of it.
func sessionState(payload sessionPayload, note store.Note, now time.Time) string {
	if payload.State != sessionStateOpen {
		return payload.State
	}
	if now.Sub(note.UpdatedAt) > sessionIdleLimit {
		return sessionStateInterrupted
	}
	return sessionStateOpen
}

// sessionDate is the day shown in the history line: the day recorded in the
// fence, or the day the note was created when the body has no valid fence.
func sessionDate(note store.Note, payload sessionPayload, ok bool) string {
	if ok && payload.Date != "" {
		return payload.Date
	}
	return note.CreatedAt.UTC().Format(dateLayout)
}

func sessionLabel(count int) string {
	if count == 1 {
		return "1 sessao"
	}
	return fmt.Sprintf("%d sessoes", count)
}

func itemLabel(count int) string {
	if count == 1 {
		return "1 item"
	}
	return fmt.Sprintf("%d itens", count)
}

// capBytes hard-caps a string without splitting a rune.
func capBytes(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return value[:cut]
}

// historyPath is the folder as the history header shows it. The tail is kept
// because it is the informative part, and the size is bounded so the totals
// always fit in the result.
func historyPath(dir string) string {
	value := safeInline(dir)
	if len(value) <= maxHistoryPathBytes {
		return value
	}
	cut := len(value) - maxHistoryPathBytes
	for cut < len(value) && !utf8.RuneStart(value[cut]) {
		cut++
	}
	return "..." + value[cut:]
}

// resolveSessionID picks the session identity: the id the client announces in
// the tools/call _meta wins over the param, and a generated id is the last
// resort.
func resolveSessionID(req *mcp.CallToolRequest, param string) (string, error) {
	if req != nil && req.Params != nil {
		if value, ok := req.Params.Meta[sessionIDMetaKey]; ok {
			raw, isString := value.(string)
			if !isString {
				return "", errors.New("session invalido em _meta")
			}
			raw = strings.TrimSpace(raw)
			if raw != "" {
				if !id.Valid(raw) {
					return "", errors.New("session invalido em _meta")
				}
				return raw, nil
			}
		}
	}
	param = strings.TrimSpace(param)
	if param != "" {
		if !id.Valid(param) {
			return "", errors.New("session invalido; use letras, digitos, _ e -")
		}
		return param, nil
	}
	return newSessionID()
}

// newSessionID generates the id of a session the client did not name.
func newSessionID() (string, error) {
	var b [sessionIDBytes]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("gerar session id: %w", err)
	}
	return sessionIDPrefix + hex.EncodeToString(b[:]), nil
}

// sessionMarker is the invisible key that lets the server find the note of a
// session without parsing bodies. The id is validated before it gets here.
func sessionMarker(sessionID string) string {
	return "<!-- mcp:s:" + sessionID + " -->"
}

// normalizeSessionPath validates the folder at the boundary and returns its
// canonical form, so "/a/b/" and "/a/b" are the same project.
func normalizeSessionPath(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("directory obrigatorio")
	}
	if utf8.RuneCountInString(raw) > maxPathRunes {
		return "", fmt.Errorf("directory maior que %d caracteres", maxPathRunes)
	}
	if err := rejectControl(raw, "directory"); err != nil {
		return "", err
	}
	if !strings.HasPrefix(raw, "/") {
		return "", errors.New("directory deve ser um caminho absoluto")
	}
	for _, segment := range strings.Split(raw, "/") {
		if segment == ".." {
			return "", errors.New("directory nao pode conter '..'")
		}
	}
	cleaned := path.Clean(raw)
	if !strings.HasPrefix(cleaned, "/") {
		return "", errors.New("directory deve ser um caminho absoluto")
	}
	return cleaned, nil
}

// normalizeOptionalSessionPath is normalizeSessionPath that accepts an empty
// value (session_close does not need the folder when the session is open).
func normalizeOptionalSessionPath(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	return normalizeSessionPath(raw)
}

// defaultSessionName is the name a session gets when the caller does not send
// one: the folder name.
func defaultSessionName(dir string) string {
	if base := path.Base(dir); base != "" && base != "." && base != "/" {
		return base
	}
	return dir
}

// normalizeSessionName validates the human name of the session and falls back to
// the folder name.
func normalizeSessionName(raw, dir string) (string, error) {
	name := strings.TrimSpace(raw)
	if utf8.RuneCountInString(name) > maxNameRunes {
		return "", fmt.Errorf("name maior que %d caracteres", maxNameRunes)
	}
	if err := rejectControl(name, "name"); err != nil {
		return "", err
	}
	if name == "" {
		name = defaultSessionName(dir)
	}
	return name, nil
}

// rejectControl refuses NUL and every other control character: they are never a
// legitimate path or name and could corrupt a line of the note.
func rejectControl(value, field string) error {
	if strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
		return fmt.Errorf("%s com caracter de controle", field)
	}
	return nil
}
