package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("store: nao encontrado")

// ListSettings returns all settings as a key/value map.
func (s *Store) ListSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return nil, fmt.Errorf("store: list settings: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// SoftDeleteEntry marks an entry as deleted.
func (s *Store) SoftDeleteEntry(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE entries SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		ts(time.Now()), EntryDeleted, ts(time.Now()), id)
	if err != nil {
		return fmt.Errorf("store: soft delete: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RestoreEntry undoes a soft delete, so the entry becomes visible again. It is
// idempotent: restoring an entry that is already live succeeds. It returns
// ErrNotFound only when the entry does not exist at all (never existed, or was
// already purged by the cleanup job).
func (s *Store) RestoreEntry(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE entries SET deleted_at = NULL, status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
		EntryReady, ts(time.Now()), id)
	if err != nil {
		return fmt.Errorf("store: restore entry: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return nil
	}
	var one int
	err = s.db.QueryRowContext(ctx, `SELECT 1 FROM entries WHERE id = ?`, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("store: restore entry: %w", err)
	}
	return nil
}

// CreateNote inserts a note.
func (s *Store) CreateNote(ctx context.Context, n Note) error {
	bodyVersion := versionNow()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO notes (id, entry_id, title, document, content_markdown, body_updated_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		n.ID, n.EntryID, n.Title, n.Document, n.ContentMarkdown, bodyVersion,
		ts(n.CreatedAt), ts(n.UpdatedAt))
	if err != nil {
		return fmt.Errorf("store: create note: %w", err)
	}
	return nil
}

// ListNotes returns the notes of an entry.
func (s *Store) ListNotes(ctx context.Context, entryID string) ([]Note, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, entry_id, COALESCE(title,''), document, COALESCE(content_markdown,''),
			body_updated_at, created_at, updated_at
		FROM notes WHERE entry_id = ? ORDER BY created_at DESC`, entryID)
	if err != nil {
		return nil, fmt.Errorf("store: list notes: %w", err)
	}
	defer rows.Close()
	var out []Note
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// GetNote returns a note by id.
func (s *Store) GetNote(ctx context.Context, id string) (Note, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, entry_id, COALESCE(title,''), document, COALESCE(content_markdown,''),
			body_updated_at, created_at, updated_at
		FROM notes WHERE id = ?`, id)
	n, err := scanNote(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Note{}, sql.ErrNoRows
	}
	return n, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanNote(row rowScanner) (Note, error) {
	var n Note
	var bodyVersion sql.NullString
	var createdAt, updatedAt string
	if err := row.Scan(&n.ID, &n.EntryID, &n.Title, &n.Document, &n.ContentMarkdown,
		&bodyVersion, &createdAt, &updatedAt); err != nil {
		return Note{}, err
	}
	if bodyVersion.Valid {
		if t := parseTS(bodyVersion.String); !t.IsZero() {
			n.BodyUpdatedAt = &t
		}
	}
	n.CreatedAt = parseTS(createdAt)
	n.UpdatedAt = parseTS(updatedAt)
	return n, nil
}

// UpdateNoteBody writes the markdown body and records a revision of the previous
// text. It is a no-op (no revision, new version) when nothing changed. It reports
// a conflict instead of writing when the body moved on since the client read it.
func (s *Store) UpdateNoteBody(ctx context.Context, id, markdown, readVersion string) (version string, conflict bool, err error) {
	stored, err := s.NoteFieldVersion(ctx, id)
	if err != nil {
		return "", false, err
	}
	if versionAfter(stored, readVersion) {
		return stored, true, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", false, fmt.Errorf("store: update note body: %w", err)
	}
	defer tx.Rollback()

	var current string
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(content_markdown, document) FROM notes WHERE id = ?`, id).Scan(&current); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, ErrNotFound
		}
		return "", false, err
	}
	stamp := versionNow()
	if current == markdown {
		// Nada mudou: nao grava revisao nem mexe na versao.
		return stored, false, tx.Commit()
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO note_revisions (id, note_id, document, created_at) VALUES (?, ?, ?, ?)`,
		newID(), id, current, ts(time.Now())); err != nil {
		return "", false, fmt.Errorf("store: insert revision: %w", err)
	}
	// Zap the legacy BlockNote document on the first markdown write: it was only
	// a fallback for notes not converted yet, and keeping it would resurrect the
	// old text when the body is emptied (the analysis and the dashboard both fall
	// back to it when content_markdown is empty). The previous body is already
	// safe in note_revisions.
	if _, err := tx.ExecContext(ctx,
		`UPDATE notes SET content_markdown = ?, document = '', body_updated_at = ?, updated_at = ? WHERE id = ?`,
		markdown, stamp, ts(time.Now()), id); err != nil {
		return "", false, fmt.Errorf("store: update note body: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", false, fmt.Errorf("store: update note body: %w", err)
	}
	return stamp, false, nil
}

// DeleteNote removes a note and its revisions.
func (s *Store) DeleteNote(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM notes WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("store: delete note: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListRevisionsPage returns one page of a note's revisions, newest first. It
// reads one extra row to report whether another page exists.
func (s *Store) ListRevisionsPage(ctx context.Context, noteID string, offset, limit int) ([]NoteRevision, bool, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, note_id, document, created_at FROM note_revisions
		WHERE note_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
		noteID, limit+1, offset)
	if err != nil {
		return nil, false, fmt.Errorf("store: list revision page: %w", err)
	}
	defer rows.Close()
	var out []NoteRevision
	for rows.Next() {
		var rev NoteRevision
		var createdAt string
		if err := rows.Scan(&rev.ID, &rev.NoteID, &rev.Document, &createdAt); err != nil {
			return nil, false, err
		}
		rev.CreatedAt = parseTS(createdAt)
		out = append(out, rev)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}

// ListRevisions returns the revisions of a note, newest first.
func (s *Store) ListRevisions(ctx context.Context, noteID string) ([]NoteRevision, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, note_id, document, created_at FROM note_revisions
		WHERE note_id = ? ORDER BY created_at DESC`, noteID)
	if err != nil {
		return nil, fmt.Errorf("store: list revisions: %w", err)
	}
	defer rows.Close()
	var out []NoteRevision
	for rows.Next() {
		var rev NoteRevision
		var createdAt string
		if err := rows.Scan(&rev.ID, &rev.NoteID, &rev.Document, &createdAt); err != nil {
			return nil, err
		}
		rev.CreatedAt = parseTS(createdAt)
		out = append(out, rev)
	}
	return out, rows.Err()
}
