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
func (s *Store) UpdateEntryFields(ctx context.Context, id string, title *string, recordedAt *time.Time, notebookID *string, archived *bool, readTitle, readRecorded string) (map[string]string, []string, error) {
	var storedTitle, storedRecorded, storedNotebook string
	var storedRecordedRaw sql.NullString
	var storedArchived int
	var storedTitleVersion, storedRecordedVersion sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(title,''), recorded_at, COALESCE(notebook_id,''), archived,
			title_updated_at, recorded_at_updated_at
		FROM entries WHERE id = ?`, id).Scan(
		&storedTitle, &storedRecordedRaw, &storedNotebook, &storedArchived,
		&storedTitleVersion, &storedRecordedVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("store: entry field versions: %w", err)
	}
	storedRecorded = storedRecordedRaw.String
	if notebookID != nil {
		if err := s.NotebookExists(ctx, strings.TrimSpace(*notebookID)); err != nil {
			return nil, nil, err
		}
	}
	var conflict []string
	versions := map[string]string{FieldTitle: storedTitleVersion.String, FieldRecordedAt: storedRecordedVersion.String}

	if title != nil && versionAfter(storedTitleVersion.String, readTitle) {
		conflict = append(conflict, FieldTitle)
	}
	if recordedAt != nil && versionAfter(storedRecordedVersion.String, readRecorded) {
		conflict = append(conflict, FieldRecordedAt)
	}
	if len(conflict) > 0 {
		return versions, conflict, nil
	}

	// Nao regrave um campo com o mesmo valor: cada gravacao subiria a versao e
	// faria outro cliente levar 409 sem que nada tivesse mudado.
	writeTitle := title != nil && *title != storedTitle
	writeRecorded := recordedAt != nil && ts(*recordedAt) != storedRecorded
	writeNotebook := notebookID != nil && strings.TrimSpace(*notebookID) != storedNotebook
	writeArchived := archived != nil && boolInt(*archived) != storedArchived
	if !writeTitle && !writeRecorded && !writeNotebook && !writeArchived {
		return versions, nil, nil
	}

	stamp := versionNow()
	updatedAt := ts(time.Now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("store: update entry fields: %w", err)
	}
	defer tx.Rollback()

	if writeTitle {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET title = ?, title_updated_at = ?, updated_at = ? WHERE id = ?`,
			*title, stamp, updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update title: %w", err)
		}
		versions[FieldTitle] = stamp
	}
	if writeRecorded {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET recorded_at = ?, recorded_at_updated_at = ?, updated_at = ? WHERE id = ?`,
			ts(*recordedAt), stamp, updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update recorded_at: %w", err)
		}
		versions[FieldRecordedAt] = stamp
	}
	// Caderno e um ponteiro, nao texto: nao tem versao nem conflito. Mover a
	// nota no celular e no desktop ao mesmo tempo e raro; a ultima gravacao vence.
	if writeNotebook {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET notebook_id = ?, updated_at = ? WHERE id = ?`,
			strings.TrimSpace(*notebookID), updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update notebook: %w", err)
		}
	}
	// Arquivar e um interruptor, nao texto: nao tem versao nem conflito. Quem
	// arrived depois manda, e o estado e o mesmo nos dois lugares.
	if writeArchived {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET archived = ?, updated_at = ? WHERE id = ?`,
			boolInt(*archived), updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update archived: %w", err)
		}
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
