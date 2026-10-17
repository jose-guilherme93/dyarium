package store

import (
	"context"
	"fmt"
	"regexp"
	"time"
)

// O dashboard antigo serializava a imagem como HTML renderizado: a URL do
// anexo ia junto, com o token da API no query string. Isso ficou gravado em
// corpos e revisoes. As regras abaixo devolvem o markdown canonico
// (`![legenda](attachment:<id>)`) e, para qualquer sobra, removem o token.
var (
	legacyFigureImage = regexp.MustCompile(`(?is)<figure>\s*<img\b[^>]*\bsrc="[^"]*/attachments/([A-Za-z0-9]+)[^"]*"[^>]*>(?:\s*<figcaption>([^<]*)</figcaption>)?\s*</figure>`)
	legacyImageTag    = regexp.MustCompile(`(?is)<img\b[^>]*\bsrc="[^"]*/attachments/([A-Za-z0-9]+)[^"]*"[^>]*>`)
	legacyMarkdownURL = regexp.MustCompile(`!\[([^\]]*)\]\(/api/v1/attachments/([A-Za-z0-9]+)[^)\s]*\)`)
	attachmentToken   = regexp.MustCompile(`(/api/v1/attachments/[A-Za-z0-9]+)\?token=[^"'\s)<]*`)
)

// scrubAttachmentTokens is the pure text repair: idempotent, no database.
func scrubAttachmentTokens(body string) string {
	body = legacyFigureImage.ReplaceAllStringFunc(body, func(match string) string {
		parts := legacyFigureImage.FindStringSubmatch(match)
		return "![" + parts[2] + "](attachment:" + parts[1] + ")"
	})
	body = legacyImageTag.ReplaceAllString(body, "![](attachment:$1)")
	body = legacyMarkdownURL.ReplaceAllString(body, "![$1](attachment:$2)")
	return attachmentToken.ReplaceAllString(body, "$1")
}

// ScrubAttachmentTokens repairs note bodies and revisions written by the older
// dashboard. It only touches rows that need it and is safe to run on every
// boot. The note body version is bumped, so clients pull the repaired text.
func (s *Store) ScrubAttachmentTokens(ctx context.Context) (notes, revisions int, err error) {
	notes, err = s.scrubNoteBodies(ctx)
	if err != nil {
		return 0, 0, err
	}
	revisions, err = s.scrubNoteRevisions(ctx)
	if err != nil {
		return notes, 0, err
	}
	return notes, revisions, nil
}

const scrubBodyMatch = `(content_markdown LIKE '%token=%' OR content_markdown LIKE '%<figure%' OR content_markdown LIKE '%<img%' OR content_markdown LIKE '%/api/v1/attachments/%')`

func (s *Store) scrubNoteBodies(ctx context.Context) (int, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, content_markdown FROM notes WHERE content_markdown IS NOT NULL AND `+scrubBodyMatch)
	if err != nil {
		return 0, fmt.Errorf("store: scrub notes: %w", err)
	}
	type change struct {
		id   string
		body string
	}
	var changes []change
	for rows.Next() {
		var id, body string
		if err := rows.Scan(&id, &body); err != nil {
			rows.Close()
			return 0, err
		}
		if cleaned := scrubAttachmentTokens(body); cleaned != body {
			changes = append(changes, change{id: id, body: cleaned})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(changes) == 0 {
		return 0, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("store: scrub notes: %w", err)
	}
	defer tx.Rollback()
	now := ts(time.Now())
	for _, change := range changes {
		if _, err := tx.ExecContext(ctx,
			`UPDATE notes SET content_markdown = ?, body_updated_at = ?, updated_at = ? WHERE id = ?`,
			change.body, versionNow(), now, change.id); err != nil {
			return 0, fmt.Errorf("store: scrub note %s: %w", change.id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("store: scrub notes: %w", err)
	}
	return len(changes), nil
}

func (s *Store) scrubNoteRevisions(ctx context.Context) (int, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, document FROM note_revisions WHERE (document LIKE '%token=%' OR document LIKE '%<figure%' OR document LIKE '%<img%' OR document LIKE '%/api/v1/attachments/%')`)
	if err != nil {
		return 0, fmt.Errorf("store: scrub revisions: %w", err)
	}
	type change struct {
		id   string
		body string
	}
	var changes []change
	for rows.Next() {
		var id, body string
		if err := rows.Scan(&id, &body); err != nil {
			rows.Close()
			return 0, err
		}
		if cleaned := scrubAttachmentTokens(body); cleaned != body {
			changes = append(changes, change{id: id, body: cleaned})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(changes) == 0 {
		return 0, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("store: scrub revisions: %w", err)
	}
	defer tx.Rollback()
	for _, change := range changes {
		if _, err := tx.ExecContext(ctx,
			`UPDATE note_revisions SET document = ? WHERE id = ?`, change.body, change.id); err != nil {
			return 0, fmt.Errorf("store: scrub revision %s: %w", change.id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("store: scrub revisions: %w", err)
	}
	return len(changes), nil
}
