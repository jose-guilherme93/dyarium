package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Campo editavel da nota, usado para dizer qual lado brigou num conflito.
const (
	FieldTitle      = "title"
	FieldRecordedAt = "recorded_at"
	FieldBody       = "body"
)

// versionNow is the current version stamp of a field. Nanoseconds matter: two
// writes in the same second still have to be ordered.
func versionNow() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

// versionAfter reports whether `stored` is newer than the version the client last
// read. An empty client version means "I never read it", which never conflicts
// (legacy clients keep working with plain last-write-wins).
func versionAfter(stored, clientRead string) bool {
	clientRead = strings.TrimSpace(clientRead)
	if clientRead == "" || strings.TrimSpace(stored) == "" {
		return false
	}
	storedAt, err := time.Parse(time.RFC3339, stored)
	if err != nil {
		return false
	}
	clientAt, err := time.Parse(time.RFC3339, clientRead)
	if err != nil {
		return false
	}
	return storedAt.After(clientAt)
}

// EntryFieldVersions returns the current versions of an entry's editable fields.
func (s *Store) EntryFieldVersions(ctx context.Context, id string) (title, recordedAt string, err error) {
	var t, r sql.NullString
	err = s.db.QueryRowContext(ctx,
		`SELECT title_updated_at, recorded_at_updated_at FROM entries WHERE id = ?`, id).Scan(&t, &r)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("store: entry field versions: %w", err)
	}
	return t.String, r.String, nil
}

// UpdateEntryFields writes the editable fields of an entry, each with its own
// version. It returns the versions after the write and the names of the fields
// that had already changed since the client read them: those are NOT applied, so
// the caller can ask the user whose version wins instead of silently losing one.
func (s *Store) UpdateEntryFields(ctx context.Context, id string, title *string, recordedAt *time.Time, readTitle, readRecorded string) (map[string]string, []string, error) {
	storedTitle, storedRecorded, err := s.EntryFieldVersions(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	var conflict []string
	versions := map[string]string{FieldTitle: storedTitle, FieldRecordedAt: storedRecorded}

	if title != nil && versionAfter(storedTitle, readTitle) {
		conflict = append(conflict, FieldTitle)
	}
	if recordedAt != nil && versionAfter(storedRecorded, readRecorded) {
		conflict = append(conflict, FieldRecordedAt)
	}
	if len(conflict) > 0 {
		return versions, conflict, nil
	}

	stamp := versionNow()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("store: update entry fields: %w", err)
	}
	defer tx.Rollback()

	if title != nil {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET title = ?, title_updated_at = ?, updated_at = ? WHERE id = ?`,
			*title, stamp, ts(time.Now()), id); err != nil {
			return nil, nil, fmt.Errorf("store: update title: %w", err)
		}
		versions[FieldTitle] = stamp
	}
	if recordedAt != nil {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET recorded_at = ?, recorded_at_updated_at = ?, updated_at = ? WHERE id = ?`,
			ts(*recordedAt), stamp, ts(time.Now()), id); err != nil {
			return nil, nil, fmt.Errorf("store: update recorded_at: %w", err)
		}
		versions[FieldRecordedAt] = stamp
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, fmt.Errorf("store: update entry fields: %w", err)
	}
	return versions, nil, nil
}

// NoteFieldVersion returns the current version of a note body.
func (s *Store) NoteFieldVersion(ctx context.Context, id string) (string, error) {
	var version sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT body_updated_at FROM notes WHERE id = ?`, id).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("store: note field version: %w", err)
	}
	return version.String, nil
}
