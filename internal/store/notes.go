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

// UpdateEntryTitle updates the editable title of an entry.
func (s *Store) UpdateEntryTitle(ctx context.Context, id, title string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE entries SET title = ?, updated_at = ? WHERE id = ?`, title, ts(time.Now()), id)
	if err != nil {
		return fmt.Errorf("store: update title: %w", err)
	}
	return nil
}

// UpdateEntryRecordedAt updates the event date of an entry.
func (s *Store) UpdateEntryRecordedAt(ctx context.Context, id string, recorded time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE entries SET recorded_at = ?, updated_at = ? WHERE id = ?`, ts(recorded), ts(time.Now()), id)
	if err != nil {
		return fmt.Errorf("store: update recorded_at: %w", err)
	}
	return nil
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

// CreateNote inserts a note.
func (s *Store) CreateNote(ctx context.Context, n Note) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO notes (id, entry_id, title, document, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		n.ID, n.EntryID, n.Title, n.Document, ts(n.CreatedAt), ts(n.UpdatedAt))
	if err != nil {
		return fmt.Errorf("store: create note: %w", err)
	}
	return nil
}

// ListNotes returns the notes of an entry.
func (s *Store) ListNotes(ctx context.Context, entryID string) ([]Note, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, entry_id, COALESCE(title,''), document, created_at, updated_at
		FROM notes WHERE entry_id = ? ORDER BY created_at DESC`, entryID)
	if err != nil {
		return nil, fmt.Errorf("store: list notes: %w", err)
	}
	defer rows.Close()
	var out []Note
	for rows.Next() {
		var n Note
		var createdAt, updatedAt string
		if err := rows.Scan(&n.ID, &n.EntryID, &n.Title, &n.Document, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		n.CreatedAt = parseTS(createdAt)
		n.UpdatedAt = parseTS(updatedAt)
		out = append(out, n)
	}
	return out, rows.Err()
}

// GetNote returns a note by id.
func (s *Store) GetNote(ctx context.Context, id string) (Note, error) {
	var n Note
	var createdAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, entry_id, COALESCE(title,''), document, created_at, updated_at
		FROM notes WHERE id = ?`, id).Scan(&n.ID, &n.EntryID, &n.Title, &n.Document, &createdAt, &updatedAt)
	if err != nil {
		return Note{}, err
	}
	n.CreatedAt = parseTS(createdAt)
	n.UpdatedAt = parseTS(updatedAt)
	return n, nil
}

// UpdateNote replaces the document (if non-empty) and records a revision.
func (s *Store) UpdateNote(ctx context.Context, id, title, document string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var current string
	if err := tx.QueryRowContext(ctx, `SELECT document FROM notes WHERE id = ?`, id).Scan(&current); err != nil {
		if err == sql.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	now := ts(time.Now())
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO note_revisions (id, note_id, document, created_at) VALUES (?, ?, ?, ?)`,
		newID(), id, current, now); err != nil {
		return fmt.Errorf("store: insert revision: %w", err)
	}
	if document != "" {
		if _, err := tx.ExecContext(ctx,
			`UPDATE notes SET title = ?, document = ?, updated_at = ? WHERE id = ?`,
			title, document, now, id); err != nil {
			return fmt.Errorf("store: update note: %w", err)
		}
	} else {
		if _, err := tx.ExecContext(ctx,
			`UPDATE notes SET title = ?, updated_at = ? WHERE id = ?`, title, now, id); err != nil {
			return fmt.Errorf("store: update note title: %w", err)
		}
	}
	return tx.Commit()
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
