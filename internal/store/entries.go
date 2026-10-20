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
			title, recorded_at, client_key, entry_id, result_attachment_id, local_transcribe,
			entry_created_at, entry_source,
			received_bytes, storage_key, prefix, next_counter, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Status, u.Filename, u.ContentType, u.SizeBytes, nullString(u.SHA256),
		nullString(u.Title), nullTS(u.RecordedAt), nullString(u.ClientKey), nullString(u.EntryID),
		nullString(u.ResultAttachmentID), boolInt(u.LocalTranscribe),
		nullTS(u.EntryCreatedAt), nullString(u.EntrySource),
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
	var sha, title, recordedAt, clientKey, entryID, resultAttachmentID sql.NullString
	var entryCreatedAt, entrySource sql.NullString
	var localTranscribe int
	err := s.db.QueryRowContext(ctx, `
		SELECT id, status, filename, content_type, size_bytes, sha256,
			title, recorded_at, client_key, entry_id, result_attachment_id, local_transcribe,
			entry_created_at, entry_source,
			received_bytes, storage_key, prefix, next_counter, created_at, expires_at
		FROM uploads `+where, arg).Scan(
		&u.ID, &u.Status, &u.Filename, &u.ContentType, &u.SizeBytes, &sha,
		&title, &recordedAt, &clientKey, &entryID, &resultAttachmentID, &localTranscribe,
		&entryCreatedAt, &entrySource,
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
	u.EntryID = entryID.String
	u.ResultAttachmentID = resultAttachmentID.String
	u.LocalTranscribe = localTranscribe != 0
	if entryCreatedAt.Valid {
		t := parseTS(entryCreatedAt.String)
		u.EntryCreatedAt = &t
	}
	u.EntrySource = entrySource.String
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

// SetUploadCompleted marks an upload as completed and records the audio
// attachment produced, so repeating Complete returns the same result.
func (s *Store) SetUploadCompleted(ctx context.Context, id, attachmentID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE uploads SET status = ?, result_attachment_id = ? WHERE id = ?`,
		"completed", nullString(attachmentID), id)
	if err != nil {
		return fmt.Errorf("store: complete upload: %w", err)
	}
	return nil
}

// CreateEntry inserts a new entry. The editable fields start with a version so
// the very first write is already protected: without it the client reads an
// empty version and the server cannot tell a first write from a stale one.
func (s *Store) CreateEntry(ctx context.Context, e Entry) error {
	stamp := ts(e.UpdatedAt)
	notebookID := strings.TrimSpace(e.NotebookID)
	if notebookID == "" {
		notebookID = DefaultNotebookID
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO entries (id, title, status, source, parent_id, notebook_id, original_filename, content_type,
			size_bytes, duration_seconds, sha256, recorded_at, created_at, updated_at, deleted_at,
			title_updated_at, recorded_at_updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.Title, e.Status, e.Source, nullString(e.ParentID), notebookID, e.OriginalFilename, e.ContentType,
		e.SizeBytes, e.DurationSeconds, e.SHA256, nullTS(e.RecordedAt), ts(e.CreatedAt), ts(e.UpdatedAt),
		nullTS(e.DeletedAt), stamp, stamp)
	if err != nil {
		return fmt.Errorf("store: create entry: %w", err)
	}
	return nil
}

// GetEntry returns an entry by id.
func (s *Store) GetEntry(ctx context.Context, id string) (Entry, error) {
	var e Entry
	var recordedAt, deletedAt, titleVersion, recordedVersion, bodyVersion sql.NullString
	var archived int
	var createdAt, updatedAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, COALESCE(title,''), status, source, COALESCE(parent_id,''), COALESCE(notebook_id,''),
			COALESCE(original_filename,''), COALESCE(content_type,''), size_bytes, duration_seconds, COALESCE(sha256,''),
			recorded_at, created_at, updated_at, deleted_at, archived,
			title_updated_at, recorded_at_updated_at,
			COALESCE((SELECT body_updated_at FROM notes n WHERE n.entry_id = entries.id ORDER BY n.created_at DESC LIMIT 1), '')
		FROM entries WHERE id = ? AND deleted_at IS NULL`, id).Scan(
		&e.ID, &e.Title, &e.Status, &e.Source, &e.ParentID, &e.NotebookID, &e.OriginalFilename, &e.ContentType,
		&e.SizeBytes, &e.DurationSeconds, &e.SHA256, &recordedAt, &createdAt, &updatedAt, &deletedAt, &archived,
		&titleVersion, &recordedVersion, &bodyVersion)
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
	e.Archived = archived != 0
	setVersions(&e, titleVersion, recordedVersion, bodyVersion)
	e.CreatedAt = parseTS(createdAt)
	e.UpdatedAt = parseTS(updatedAt)
	return e, nil
}

// EntryIsDeleted reports whether an entry is soft-deleted. It returns
// ErrNotFound when the entry does not exist. Used by the cleanup worker to
// avoid purging an entry that is still live.
func (s *Store) EntryIsDeleted(ctx context.Context, id string) (bool, error) {
	var deletedAt sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT deleted_at FROM entries WHERE id = ?`, id).Scan(&deletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, fmt.Errorf("store: entry is deleted: %w", err)
	}
	return deletedAt.Valid, nil
}

// PurgeEntry hard-deletes an entry and, by cascade, its attachments,
// transcripts, analysis, notes and links. Links that point to the entry are
// removed explicitly, because the foreign key would only null the target. The
// encrypted objects must be removed from disk separately, before calling this.
// It only purges entries still marked as deleted, which closes the window with a
// restore that arrives while the cleanup job is running. It is idempotent:
// purging an entry that no longer exists succeeds.
func (s *Store) PurgeEntry(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: purge entry: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM links WHERE from_entry_id = ? OR to_entry_id = ?`, id, id); err != nil {
		return fmt.Errorf("store: purge entry links: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entries WHERE id = ? AND deleted_at IS NOT NULL`, id); err != nil {
		return fmt.Errorf("store: purge entry: %w", err)
	}
	return tx.Commit()
}

// ListEntries returns recent entries, newest first.
func (s *Store) ListEntries(ctx context.Context, limit int) ([]Entry, error) {
	return s.ListEntriesFiltered(ctx, limit, "", "", "", nil)
}

// ListEntriesFiltered returns recent entries, newest first, optionally limited
// to entries that mention the given person, place and/or theme (case
// insensitive). Empty arguments mean no filter.
func (s *Store) ListEntriesFiltered(ctx context.Context, limit int, person, place, theme string, archived *bool) ([]Entry, error) {
	return s.ListEntriesFilteredNotebook(ctx, limit, person, place, theme, archived, "")
}

// ListEntriesFilteredNotebook is ListEntriesFiltered with an optional notebook
// filter. An empty notebookID means every notebook.
func (s *Store) ListEntriesFilteredNotebook(ctx context.Context, limit int, person, place, theme string, archived *bool, notebookID string) ([]Entry, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT e.id, COALESCE(e.title,''), e.status, e.source, COALESCE(e.parent_id,''), COALESCE(e.notebook_id,''),
			COALESCE(e.original_filename,''), COALESCE(e.content_type,''), e.size_bytes, e.duration_seconds, COALESCE(e.sha256,''),
			e.recorded_at, e.created_at, e.updated_at, e.archived,
			e.title_updated_at, e.recorded_at_updated_at,
			COALESCE((SELECT body_updated_at FROM notes n WHERE n.entry_id = e.id ORDER BY n.created_at DESC LIMIT 1), '')
		FROM entries e WHERE e.deleted_at IS NULL`
	var args []any
	if notebookID = strings.TrimSpace(notebookID); notebookID != "" {
		query += ` AND e.notebook_id = ?`
		args = append(args, notebookID)
	}
	if archived != nil {
		query += ` AND e.archived = ?`
		args = append(args, boolInt(*archived))
	}
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
		var recordedAt, titleVersion, recordedVersion, bodyVersion sql.NullString
		var archived int
		var createdAt, updatedAt string
		if err := rows.Scan(&e.ID, &e.Title, &e.Status, &e.Source, &e.ParentID, &e.NotebookID, &e.OriginalFilename,
			&e.ContentType, &e.SizeBytes, &e.DurationSeconds, &e.SHA256, &recordedAt, &createdAt, &updatedAt,
			&archived, &titleVersion, &recordedVersion, &bodyVersion); err != nil {
			return nil, fmt.Errorf("store: scan entry: %w", err)
		}
		if recordedAt.Valid {
			t := parseTS(recordedAt.String)
			e.RecordedAt = &t
		}
		e.Archived = archived != 0
		setVersions(&e, titleVersion, recordedVersion, bodyVersion)
		e.CreatedAt = parseTS(createdAt)
		e.UpdatedAt = parseTS(updatedAt)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListDeletedEntries returns soft-deleted entries, most recently deleted first.
// They are the "tombstones" the app uses to reconcile: a local note is only
// removed when the server confirms the deletion (never because the entry is
// merely absent, which would wipe the phone on a fresh or reset server).
func (s *Store) ListDeletedEntries(ctx context.Context, limit int) ([]Entry, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, COALESCE(title,''), created_at, updated_at, deleted_at
		FROM entries WHERE deleted_at IS NOT NULL
		ORDER BY deleted_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list deleted entries: %w", err)
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		var e Entry
		var createdAt, updatedAt, deletedAt string
		if err := rows.Scan(&e.ID, &e.Title, &createdAt, &updatedAt, &deletedAt); err != nil {
			return nil, fmt.Errorf("store: scan deleted entry: %w", err)
		}
		e.Status = EntryDeleted
		e.CreatedAt = parseTS(createdAt)
		e.UpdatedAt = parseTS(updatedAt)
		if t := parseTS(deletedAt); !t.IsZero() {
			e.DeletedAt = &t
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// SetEntryPrimaryAudio fills the entry's content_type and original_filename
// when it had no audio yet (for example, a written note that just received its
// first audio).
func (s *Store) SetEntryPrimaryAudio(ctx context.Context, id, contentType, filename string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE entries SET content_type = ?, original_filename = ?, updated_at = ?
		WHERE id = ? AND (content_type IS NULL OR content_type = '')`,
		contentType, filename, ts(time.Now()), id)
	if err != nil {
		return fmt.Errorf("store: set primary audio: %w", err)
	}
	return nil
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
