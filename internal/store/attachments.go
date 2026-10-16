package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// CreateAttachment inserts an encrypted object linked to an entry.
func (s *Store) CreateAttachment(ctx context.Context, a Attachment) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO attachments (id, entry_id, kind, storage_key, content_type, size_bytes,
			sha256, cipher, cache_key, duration_seconds, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.EntryID, a.Kind, a.StorageKey, a.ContentType, a.SizeBytes,
		a.SHA256, a.Cipher, a.CacheKey, a.DurationSeconds, ts(a.CreatedAt))
	if err != nil {
		return fmt.Errorf("store: create attachment: %w", err)
	}
	return nil
}

// attachmentColumns is the shared column list for scanning attachments.
const attachmentColumns = `id, entry_id, kind, storage_key, COALESCE(content_type,''), size_bytes,
	COALESCE(sha256,''), cipher, COALESCE(cache_key,''), duration_seconds, created_at`

// prefixedAttachmentColumns is attachmentColumns qualified for a JOIN on entries.
const prefixedAttachmentColumns = `a.id, a.entry_id, a.kind, a.storage_key, COALESCE(a.content_type,''),
	a.size_bytes, COALESCE(a.sha256,''), a.cipher, COALESCE(a.cache_key,''), a.duration_seconds, a.created_at`

// FindOriginalAudio returns the oldest original audio attachment with the given
// content hash, ignoring audios of deleted entries. The boolean is false when
// none exists. It gives the audio its identity: the same content never becomes
// two audios of the same note.
func (s *Store) FindOriginalAudio(ctx context.Context, sha256 string) (Attachment, bool, error) {
	if sha256 == "" {
		return Attachment{}, false, nil
	}
	a, err := s.scanAttachment(s.db.QueryRowContext(ctx, `
		SELECT `+prefixedAttachmentColumns+`
		FROM attachments a JOIN entries e ON e.id = a.entry_id
		WHERE a.kind = ? AND a.sha256 = ? AND e.deleted_at IS NULL
		ORDER BY a.created_at ASC LIMIT 1`, AttachmentOriginal, sha256))
	if err == sql.ErrNoRows {
		return Attachment{}, false, nil
	}
	if err != nil {
		return Attachment{}, false, err
	}
	return a, true, nil
}

// ListAudios returns the audio attachments of an entry, oldest first.
func (s *Store) ListAudios(ctx context.Context, entryID string) ([]Attachment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+attachmentColumns+`
		FROM attachments WHERE entry_id = ? AND kind = ?
		ORDER BY created_at ASC`, entryID, AttachmentOriginal)
	if err != nil {
		return nil, fmt.Errorf("store: list audios: %w", err)
	}
	defer rows.Close()
	var out []Attachment
	for rows.Next() {
		var a Attachment
		var createdAt string
		if err := rows.Scan(&a.ID, &a.EntryID, &a.Kind, &a.StorageKey, &a.ContentType,
			&a.SizeBytes, &a.SHA256, &a.Cipher, &a.CacheKey, &a.DurationSeconds, &createdAt); err != nil {
			return nil, fmt.Errorf("store: scan audio: %w", err)
		}
		a.CreatedAt = parseTS(createdAt)
		out = append(out, a)
	}
	return out, rows.Err()
}

// SyncEntryDuration updates the entry duration with the sum of its audios.
func (s *Store) SyncEntryDuration(ctx context.Context, entryID string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE entries SET duration_seconds = (
			SELECT COALESCE(SUM(duration_seconds), 0) FROM attachments
			WHERE entry_id = ? AND kind = ?
		), updated_at = ? WHERE id = ?`,
		entryID, AttachmentOriginal, ts(time.Now()), entryID)
	if err != nil {
		return fmt.Errorf("store: sync entry duration: %w", err)
	}
	return nil
}

// GetAttachmentByKind returns the most recent attachment of the given kind.
func (s *Store) GetAttachmentByKind(ctx context.Context, entryID, kind string) (Attachment, error) {
	return s.scanAttachment(s.db.QueryRowContext(ctx, `
		SELECT `+attachmentColumns+`
		FROM attachments WHERE entry_id = ? AND kind = ?
		ORDER BY created_at DESC LIMIT 1`, entryID, kind))
}

// GetAttachmentByCacheKey returns a cached derived attachment when present.
func (s *Store) GetAttachmentByCacheKey(ctx context.Context, entryID, cacheKey string) (Attachment, bool, error) {
	a, err := s.scanAttachment(s.db.QueryRowContext(ctx, `
		SELECT `+attachmentColumns+`
		FROM attachments WHERE entry_id = ? AND cache_key = ?
		ORDER BY created_at DESC LIMIT 1`, entryID, cacheKey))
	if err == sql.ErrNoRows {
		return Attachment{}, false, nil
	}
	if err != nil {
		return Attachment{}, false, err
	}
	return a, true, nil
}

func (s *Store) scanAttachment(row interface {
	Scan(dest ...any) error
}) (Attachment, error) {
	var a Attachment
	var createdAt string
	if err := row.Scan(&a.ID, &a.EntryID, &a.Kind, &a.StorageKey, &a.ContentType,
		&a.SizeBytes, &a.SHA256, &a.Cipher, &a.CacheKey, &a.DurationSeconds, &createdAt); err != nil {
		return Attachment{}, err
	}
	a.CreatedAt = parseTS(createdAt)
	return a, nil
}

// ListAttachments returns the attachments of an entry, newest first.
func (s *Store) ListAttachments(ctx context.Context, entryID string) ([]Attachment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+attachmentColumns+`
		FROM attachments WHERE entry_id = ? ORDER BY created_at DESC`, entryID)
	if err != nil {
		return nil, fmt.Errorf("store: list attachments: %w", err)
	}
	defer rows.Close()
	var out []Attachment
	for rows.Next() {
		var a Attachment
		var createdAt string
		if err := rows.Scan(&a.ID, &a.EntryID, &a.Kind, &a.StorageKey, &a.ContentType,
			&a.SizeBytes, &a.SHA256, &a.Cipher, &a.CacheKey, &a.DurationSeconds, &createdAt); err != nil {
			return nil, fmt.Errorf("store: scan attachment: %w", err)
		}
		a.CreatedAt = parseTS(createdAt)
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetAttachment returns one attachment by id.
func (s *Store) GetAttachment(ctx context.Context, id string) (Attachment, error) {
	return s.scanAttachment(s.db.QueryRowContext(ctx, `
		SELECT `+attachmentColumns+`
		FROM attachments WHERE id = ?`, id))
}

// DeleteAttachment removes an attachment row.
func (s *Store) DeleteAttachment(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM attachments WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("store: delete attachment: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UpsertMetrics stores or replaces the audio metrics for an entry.
func (s *Store) UpsertMetrics(ctx context.Context, m AudioMetrics) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO audio_metrics (entry_id, duration_ms, loudness_lufs, true_peak,
			silence_count, silence_total_ms, sample_rate, channels, whisper_peak_rss_mb, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (entry_id) DO UPDATE SET
			duration_ms = excluded.duration_ms,
			loudness_lufs = excluded.loudness_lufs,
			true_peak = excluded.true_peak,
			silence_count = excluded.silence_count,
			silence_total_ms = excluded.silence_total_ms,
			sample_rate = excluded.sample_rate,
			channels = excluded.channels,
			whisper_peak_rss_mb = excluded.whisper_peak_rss_mb`,
		m.EntryID, m.DurationMS, m.LoudnessLUFS, m.TruePeak,
		m.SilenceCount, m.SilenceTotalMS, m.SampleRate, m.Channels, m.WhisperPeakRSSMB, ts(nowUTC()))
	if err != nil {
		return fmt.Errorf("store: upsert metrics: %w", err)
	}
	return nil
}

// SetWhisperPeakRSS records the peak RSS (MB) of the whisper subprocess.
func (s *Store) SetWhisperPeakRSS(ctx context.Context, entryID string, mb int64) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO audio_metrics (entry_id, whisper_peak_rss_mb, created_at)
		VALUES (?, ?, ?)
		ON CONFLICT (entry_id) DO UPDATE SET whisper_peak_rss_mb = excluded.whisper_peak_rss_mb`,
		entryID, mb, ts(nowUTC()))
	if err != nil {
		return fmt.Errorf("store: set whisper peak rss: %w", err)
	}
	return nil
}
