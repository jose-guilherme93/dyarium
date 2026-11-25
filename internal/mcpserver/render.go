package mcpserver

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

const (
	detailsLabel = "Detalhes técnicos"
	detailsOpen  = ":::details open "
	detailsClose = ":::\n"
)

// sessionPayload is the canonical v2 fence of a session note: the same content
// as the human block, in one line. Optional fields use omitempty so an empty
// session stays short; `closed` only exists in a closed session.
type sessionPayload struct {
	Version int             `json:"v"`
	Kind    string          `json:"kind"`
	Machine string          `json:"machine"`
	Path    string          `json:"path"`
	Session string          `json:"session"`
	State   string          `json:"state"`
	Opened  string          `json:"opened"`
	Closed  string          `json:"closed,omitempty"`
	Date    string          `json:"date"`
	Time    string          `json:"time"`
	Summary string          `json:"summary,omitempty"`
	Items   []summaryItem   `json:"items,omitempty"`
	Commits []summaryCommit `json:"commits,omitempty"`
	Links   []summaryLink   `json:"links,omitempty"`
}

// renderSessionBlock produces the body of a session note: the header with date,
// time and machine, the summary, one line per item, the collapsible technical
// block, the v2 fence and the session marker. The session note has no
// concise/full mode: the agent always reports the whole session, so the details
// are always present, collapsed. The optional settings decide whether the
// commits and links sections exist; without them both stay on.
func renderSessionBlock(p sessionPayload, marker string, settings ...Settings) string {
	cfg := DefaultSettings()
	if len(settings) > 0 {
		cfg = settings[0]
	}
	var b strings.Builder
	if p.Machine != "" {
		fmt.Fprintf(&b, "## %s %s · %s\n", p.Date, p.Time, safeInline(p.Machine))
	} else {
		fmt.Fprintf(&b, "## %s %s\n", p.Date, p.Time)
	}
	in := projectSummaryInput{
		Summary: p.Summary,
		Items:   p.Items,
		Commits: p.Commits,
		Links:   p.Links,
	}
	if summary := strings.TrimSpace(in.Summary); summary != "" {
		b.WriteString("\n")
		b.WriteString(safeBlock(summary))
		b.WriteString("\n")
	}
	renderItems(&b, in, cfg)
	if len(in.Items) > 0 || strings.TrimSpace(in.Summary) != "" {
		renderTechnical(&b, in, false, cfg)
	}
	b.WriteString("\n")
	if fence := renderSessionPayload(p); fence != "" {
		b.WriteString(fence)
		b.WriteString("\n\n")
	}
	b.WriteString(marker)
	return b.String()
}

// renderSessionPayload encodes the v2 fence. It follows the v1 rules: one line,
// no indentation and HTML not escaped, so a round trip returns the original
// characters.
func renderSessionPayload(p sessionPayload) string {
	var raw strings.Builder
	enc := json.NewEncoder(&raw)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(p); err != nil {
		return ""
	}
	line := strings.TrimSuffix(raw.String(), "\n")
	return "```dyarium-json\n" + line + "\n```"
}

// parseSessionFence reads the v2 fence of an existing note. It is used on reopen
// and on close to preserve what is already sealed; a hand-edited body without a
// valid v2 fence reports false and is left alone. The last fence of the body is
// read: our renderer always writes it after the human text, so a "```" typed
// inside the summary cannot pass for the canonical one.
func parseSessionFence(body string) (sessionPayload, bool) {
	const open = "```dyarium-json\n"
	start := strings.LastIndex(body, open)
	if start < 0 {
		return sessionPayload{}, false
	}
	rest := body[start+len(open):]
	end := strings.Index(rest, "\n```")
	if end < 0 {
		return sessionPayload{}, false
	}
	var p sessionPayload
	if err := json.Unmarshal([]byte(rest[:end]), &p); err != nil {
		return sessionPayload{}, false
	}
	if p.Version != 2 || p.Kind != sessionKind {
		return sessionPayload{}, false
	}
	return p, true
}

// renderBlock produces the markdown block of one session. The objective summary
// comes right after the date in both modes: it is where the agent puts the
// numbers that matter (performance, bugs, versions). Then come one-line items.
// Technical detail, extra commits and links live inside a collapsible block,
// closed in concise mode and open in full mode. After the technical block comes
// the canonical JSON fence so machine clients can parse the same session. The
// optional settings decide whether the commits and links sections exist; without
// them both stay on.
func renderBlock(in projectSummaryInput, detail, computer, marker string, now time.Time, settings ...Settings) string {
	cfg := DefaultSettings()
	if len(settings) > 0 {
		cfg = settings[0]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "## %s · %s\n", now.UTC().Format("2006-01-02 15:04"), safeInline(computer))
	if summary := strings.TrimSpace(in.Summary); summary != "" {
		b.WriteString("\n")
		b.WriteString(safeBlock(summary))
		b.WriteString("\n")
	}
	renderItems(&b, in, cfg)
	// With no items and no summary, renderItems already showed commits or links
	// in the visible part; repeating them in the collapsible would be noise.
	if len(in.Items) > 0 || strings.TrimSpace(in.Summary) != "" {
		renderTechnical(&b, in, detail == store.SummaryDetailFull, cfg)
	}
	b.WriteString("\n")
	// The fence sits right before the dedup marker, one blank line after the
	// technical block and one before the marker. On the (impossible today)
	// encoding failure the fence is omitted; raw payload types never fail, so
	// the human block is never rewritten to hunt down a broken fence.
	if fence := renderPayload(in, computer, detail, now); fence != "" {
		b.WriteString(fence)
		b.WriteString("\n\n")
	}
	b.WriteString(marker)
	return b.String()
}

// payloadBlock is the stable machine contract read by the clients. Optional
// fields use omitempty so an empty session stays a short single line.
type payloadBlock struct {
	Version int             `json:"v"`
	Project string          `json:"project"`
	Date    string          `json:"date"`
	Time    string          `json:"time"`
	Host    string          `json:"host"`
	Detail  string          `json:"detail"`
	Summary string          `json:"summary,omitempty"`
	Items   []summaryItem   `json:"items,omitempty"`
	Commits []summaryCommit `json:"commits,omitempty"`
	Links   []summaryLink   `json:"links,omitempty"`
}

// renderPayload encodes one session as a single-line JSON fence named
// dyarium-json. The values are those of the already normalized input, not the
// escaped human text, and the encoder HTML escaping is off so a round trip
// returns the original characters. The date and time match the block header.
func renderPayload(in projectSummaryInput, computer, detail string, now time.Time) string {
	payload := payloadBlock{
		Version: 1,
		Project: in.Project,
		Date:    now.UTC().Format(dateLayout),
		Time:    now.UTC().Format("15:04"),
		Host:    safeInline(computer),
		Detail:  detail,
		Summary: in.Summary,
		Items:   in.Items,
		Commits: in.Commits,
		Links:   in.Links,
	}
	var raw strings.Builder
	enc := json.NewEncoder(&raw)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(payload); err != nil {
		return ""
	}
	line := strings.TrimSuffix(raw.String(), "\n")
	return "```dyarium-json\n" + line + "\n```"
}

// renderItems writes one line per item. The summary is already written by
// renderBlock. When there are no items and no summary, commits or links stand in
// so the block is not empty; a section disabled in the settings never stands in.
func renderItems(b *strings.Builder, in projectSummaryInput, settings Settings) {
	if len(in.Items) == 0 {
		if strings.TrimSpace(in.Summary) != "" {
			return
		}
		var content strings.Builder
		if settings.IncludeCommits {
			for _, commit := range in.Commits {
				content.WriteString(plainCommit(commit))
				content.WriteString("\n")
			}
		}
		if content.Len() == 0 && settings.IncludeLinks {
			for _, link := range in.Links {
				content.WriteString(plainLink(link))
				content.WriteString("\n")
			}
		}
		if content.Len() > 0 {
			b.WriteString("\n")
			b.WriteString(content.String())
		}
		return
	}
	b.WriteString("\n")
	for _, item := range in.Items {
		line := "- **" + safeInline(item.Kind) + "** " + safeInline(item.Title)
		if item.Commit != "" {
			if link := safeURL(item.URL); link != "" {
				line += " · [" + safeInline(item.Commit) + "](" + link + ")"
			} else {
				line += " · " + safeInline(item.Commit)
			}
		}
		b.WriteString(line)
		b.WriteString("\n")
	}
}

// renderTechnical writes the collapsible "Detalhes técnicos" block: item
// details, commits not already shown next to an item, and links. It is emitted
// in both modes; `open` decides whether the block starts expanded. A disabled
// section is omitted entirely: no header is left with nothing under it.
func renderTechnical(b *strings.Builder, in projectSummaryInput, open bool, settings Settings) {
	var content strings.Builder
	for _, item := range in.Items {
		detail := strings.TrimSpace(item.Detail)
		if detail == "" {
			continue
		}
		content.WriteString("- ")
		content.WriteString(safeInline(item.Title))
		content.WriteString(": ")
		content.WriteString(strings.ReplaceAll(safeBlock(detail), "\n", " "))
		content.WriteString("\n")
	}
	if settings.IncludeCommits {
		shown := map[string]bool{}
		for _, item := range in.Items {
			if item.Commit != "" {
				shown[item.Commit] = true
			}
		}
		var commits strings.Builder
		for _, commit := range in.Commits {
			if commit.Hash != "" && shown[commit.Hash] {
				continue
			}
			commits.WriteString(plainCommit(commit))
			commits.WriteString("\n")
		}
		if commits.Len() > 0 {
			if content.Len() > 0 {
				content.WriteString("\n")
			}
			content.WriteString("Commits:\n")
			content.WriteString(commits.String())
		}
	}
	if settings.IncludeLinks {
		var links strings.Builder
		for _, link := range in.Links {
			links.WriteString(plainLink(link))
			links.WriteString("\n")
		}
		if links.Len() > 0 {
			if content.Len() > 0 {
				content.WriteString("\n")
			}
			content.WriteString("Links:\n")
			content.WriteString(links.String())
		}
	}
	if content.Len() == 0 {
		return
	}
	b.WriteString("\n")
	if open {
		b.WriteString(detailsOpen)
	} else {
		b.WriteString(":::details ")
	}
	b.WriteString(detailsLabel)
	b.WriteString("\n")
	b.WriteString(content.String())
	b.WriteString(detailsClose)
}

// plainCommit is the line format inside the technical block, where markdown is
// not interpreted. The URL stays visible so it can be copied.
func plainCommit(commit summaryCommit) string {
	target := safeURL(commit.URL)
	var b strings.Builder
	b.WriteString("- ")
	switch {
	case commit.Hash != "":
		b.WriteString(safeInline(commit.Hash))
		if commit.Message != "" {
			b.WriteString(" ")
			b.WriteString(safeInline(commit.Message))
		}
	case commit.Message != "":
		b.WriteString(safeInline(commit.Message))
	}
	if target != "" {
		if b.Len() > 2 {
			b.WriteString(" ")
		}
		b.WriteString(target)
	}
	line := strings.TrimRight(b.String(), " ")
	if line == "-" {
		return ""
	}
	return line
}

// plainLink is the line format inside the technical block, where markdown is not
// interpreted. The URL stays visible so it can be copied.
func plainLink(link summaryLink) string {
	target := safeURL(link.URL)
	if target == "" {
		return ""
	}
	label := safeInline(link.Label)
	if label == "" {
		return "- " + target
	}
	return "- " + label + ": " + target
}

// safeInline prepares a value for a single markdown line: it trims, removes line
// breaks and escapes the angle brackets that could open an HTML tag.
func safeInline(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "\r\n", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	return escapeAngles(value)
}

// safeBlock prepares a value for a paragraph, keeping the line breaks the agent
// wrote and still escaping raw HTML.
func safeBlock(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return escapeAngles(value)
}

func escapeAngles(value string) string {
	value = strings.ReplaceAll(value, "<", "&lt;")
	return strings.ReplaceAll(value, ">", "&gt;")
}

// safeURL accepts only absolute http and https URLs and encodes the parentheses
// that would end a markdown link early. Anything else is dropped.
func safeURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	value := parsed.String()
	value = strings.ReplaceAll(value, "(", "%28")
	value = strings.ReplaceAll(value, ")", "%29")
	return value
}
