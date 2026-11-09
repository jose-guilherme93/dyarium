package mcpserver

import (
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

// renderBlock produces the markdown block of one session. The objective summary
// comes right after the date in both modes: it is where the agent puts the
// numbers that matter (performance, bugs, versions). Then come one-line items.
// Technical detail, extra commits and links live inside a collapsible block,
// closed in concise mode and open in full mode.
func renderBlock(in projectSummaryInput, detail, computer, marker string, now time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## %s · %s\n", now.UTC().Format("2006-01-02 15:04"), safeInline(computer))
	if summary := strings.TrimSpace(in.Summary); summary != "" {
		b.WriteString("\n")
		b.WriteString(safeBlock(summary))
		b.WriteString("\n")
	}
	renderItems(&b, in)
	// With no items and no summary, renderItems already showed commits or links
	// in the visible part; repeating them in the collapsible would be noise.
	if len(in.Items) > 0 || strings.TrimSpace(in.Summary) != "" {
		renderTechnical(&b, in, detail == store.SummaryDetailFull)
	}
	b.WriteString("\n")
	b.WriteString(marker)
	return b.String()
}

// renderItems writes one line per item. The summary is already written by
// renderBlock. When there are no items and no summary, commits or links stand in
// so the block is not empty.
func renderItems(b *strings.Builder, in projectSummaryInput) {
	if len(in.Items) == 0 {
		if strings.TrimSpace(in.Summary) != "" {
			return
		}
		var content strings.Builder
		for _, commit := range in.Commits {
			content.WriteString(plainCommit(commit))
			content.WriteString("\n")
		}
		if content.Len() == 0 {
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
// in both modes; `open` decides whether the block starts expanded.
func renderTechnical(b *strings.Builder, in projectSummaryInput, open bool) {
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
