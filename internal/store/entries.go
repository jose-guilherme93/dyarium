package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func parseTS(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// CreateUpload inserts a new resumable upload.
func (s *Store) CreateUpload(ctx context.Context, u Upload) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO uploads (id, status, filename, content_type, size_bytes, sha256,
			title, recorded_at, client_key,
			received_bytes, storage_key, prefix, next_counter, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Status, u.Filename, u.ContentType, u.SizeBytes, nullString(u.SHA256),
		nullString(u.Title), nullTS(u.RecordedAt), nullString(u.ClientKey),
		u.ReceivedBytes, u.StorageKey, u.Prefix, u.NextCounter, ts(u.CreatedAt), ts(u.ExpiresAt))
	if err != nil {
		return fmt.Errorf("store: create upload: %w", err)
	}
	return nil
}

// GetUpload returns an upload by id.
func (s *Store) GetUpload(ctx context.Context, id string) (Upload, error) {
	return s.getUpload(ctx, `WHERE id = ?`, id)
}

// GetUploadByClientKey returns the upload previously created with the given
// client key. The boolean is false when no such upload exists. Used for
// idempotent upload creation.
func (s *Store) GetUploadByClientKey(ctx context.Context, clientKey string) (Upload, bool, error) {
	if clientKey == "" {
		return Upload{}, false, nil
	}
	u, err := s.getUpload(ctx, `WHERE client_key = ?`, clientKey)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Upload{}, false, nil
		}
		return Upload{}, false, err
	}
	return u, true, nil
}

func (s *Store) getUpload(ctx context.Context, where string, arg any) (Upload, error) {
	var u Upload
	var createdAt, expiresAt string
	var sha, title, recordedAt, clientKey sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, status, filename, content_type, size_bytes, sha256,
			title, recorded_at, client_key,
			received_bytes, storage_key, prefix, next_counter, created_at, expires_at
		FROM uploads `+where, arg).Scan(
		&u.ID, &u.Status, &u.Filename, &u.ContentType, &u.SizeBytes, &sha,
		&title, &recordedAt, &clientKey,
		&u.ReceivedBytes, &u.StorageKey, &u.Prefix, &u.NextCounter, &createdAt, &expiresAt)
	if err != nil {
		return Upload{}, err
	}
	u.SHA256 = sha.String
	u.Title = title.String
	if recordedAt.Valid {
		t := parseTS(recordedAt.String)
		u.RecordedAt = &t
	}
	u.ClientKey = clientKey.String
	u.CreatedAt = parseTS(createdAt)
	u.ExpiresAt = parseTS(expiresAt)
	return u, nil
}

// UpdateUploadProgress records the confirmed offset and next nonce counter.
func (s *Store) UpdateUploadProgress(ctx context.Context, id string, received int64, nextCounter uint32) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE uploads SET received_bytes = ?, next_counter = ? WHERE id = ?`,
		received, nextCounter, id)
	if err != nil {
		return fmt.Errorf("store: update upload: %w", err)
	}
	return nil
}

// SetUploadStatus changes an upload status.
func (s *Store) SetUploadStatus(ctx context.Context, id, status string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE uploads SET status = ? WHERE id = ?`, status, id)
	if err != nil {
		return fmt.Errorf("store: set upload status: %w", err)
	}
	return nil
}

// CreateEntry inserts a new entry.
func (s *Store) CreateEntry(ctx context.Context, e Entry) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO entries (id, title, status, source, original_filename, content_type,
			size_bytes, duration_seconds, sha256, recorded_at, created_at, updated_at, deleted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.Title, e.Status, e.Source, e.OriginalFilename, e.ContentType,
		e.SizeBytes, e.DurationSeconds, e.SHA256, nullTS(e.RecordedAt), ts(e.CreatedAt), ts(e.UpdatedAt), nullTS(e.DeletedAt))
	if err != nil {
		return fmt.Errorf("store: create entry: %w", err)
	}
	return nil
}

// GetEntry returns an entry by id.
func (s *Store) GetEntry(ctx context.Context, id string) (Entry, error) {
	var e Entry
	var recordedAt, deletedAt sql.NullString
	var createdAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, COALESCE(title,''), status, source, COALESCE(original_filename,''),
			COALESCE(content_type,''), size_bytes, duration_seconds, COALESCE(sha256,''),
			recorded_at, created_at, updated_at, deleted_at
		FROM entries WHERE id = ? AND deleted_at IS NULL`, id).Scan(
		&e.ID, &e.Title, &e.Status, &e.Source, &e.OriginalFilename, &e.ContentType,
		&e.SizeBytes, &e.DurationSeconds, &e.SHA256, &recordedAt, &createdAt, &updatedAt, &deletedAt)
	if err != nil {
		return Entry{}, err
	}
	if recordedAt.Valid {
		t := parseTS(recordedAt.String)
		e.RecordedAt = &t
	}
	if deletedAt.Valid {
		t := parseTS(deletedAt.String)
		e.DeletedAt = &t
	}
	e.CreatedAt = parseTS(createdAt)
	e.UpdatedAt = parseTS(updatedAt)
	return e, nil
}

// ListEntries returns recent entries, newest first.
func (s *Store) ListEntries(ctx context.Context, limit int) ([]Entry, error) {
	return s.ListEntriesFiltered(ctx, limit, "", "", "")
}

// ListEntriesFiltered returns recent entries, newest first, optionally limited
// to entries that mention the given person, place and/or theme (case
// insensitive). Empty arguments mean no filter.
func (s *Store) ListEntriesFiltered(ctx context.Context, limit int, person, place, theme string) ([]Entry, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT e.id, COALESCE(e.title,''), e.status, e.source, COALESCE(e.original_filename,''),
			COALESCE(e.content_type,''), e.size_bytes, e.duration_seconds, COALESCE(e.sha256,''),
			e.recorded_at, e.created_at, e.updated_at
		FROM entries e WHERE e.deleted_at IS NULL`
	var args []any
	addFilter := func(kind, name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		query += ` AND e.id IN (
			SELECT ee.entry_id FROM entry_entities ee
			JOIN entities en ON en.id = ee.entity_id
			WHERE en.kind = ? AND lower(en.name) = lower(?))`
		args = append(args, kind, name)
	}
	addFilter(EntityPerson, person)
	addFilter(EntityPlace, place)
	addFilter(EntityTheme, theme)
	query += ` ORDER BY e.created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: list entries: %w", err)
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		var e Entry
		var recordedAt sql.NullString
		var createdAt, updatedAt string
		if err := rows.Scan(&e.ID, &e.Title, &e.Status, &e.Source, &e.OriginalFilename,
			&e.ContentType, &e.SizeBytes, &e.DurationSeconds, &e.SHA256, &recordedAt, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("store: scan entry: %w", err)
		}
		if recordedAt.Valid {
			t := parseTS(recordedAt.String)
			e.RecordedAt = &t
		}
		e.CreatedAt = parseTS(createdAt)
		e.UpdatedAt = parseTS(updatedAt)
		out = append(out, e)
	}
	return out, rows.Err()
}

// UpdateEntryStatus changes the status and bumps updated_at.
func (s *Store) UpdateEntryStatus(ctx context.Context, id, status string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE entries SET status = ?, updated_at = ? WHERE id = ?`, status, ts(time.Now()), id)
	if err != nil {
		return fmt.Errorf("store: update entry status: %w", err)
	}
	return nil
}

func nullTS(t *time.Time) any {
	if t == nil {
		return nil
	}
	return ts(*t)
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
