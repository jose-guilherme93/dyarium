package store

import (
	"context"
	"database/sql"
	"fmt"
)

// CreateAttachment inserts an encrypted object linked to an entry.
func (s *Store) CreateAttachment(ctx context.Context, a Attachment) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO attachments (id, entry_id, kind, storage_key, content_type, size_bytes,
			sha256, cipher, cache_key, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.EntryID, a.Kind, a.StorageKey, a.ContentType, a.SizeBytes,
		a.SHA256, a.Cipher, a.CacheKey, ts(a.CreatedAt))
	if err != nil {
		return fmt.Errorf("store: create attachment: %w", err)
	}
	return nil
}

// GetAttachmentByKind returns the most recent attachment of the given kind.
func (s *Store) GetAttachmentByKind(ctx context.Context, entryID, kind string) (Attachment, error) {
	return s.scanAttachment(s.db.QueryRowContext(ctx, `
		SELECT id, entry_id, kind, storage_key, COALESCE(content_type,''), size_bytes,
			COALESCE(sha256,''), cipher, COALESCE(cache_key,''), created_at
		FROM attachments WHERE entry_id = ? AND kind = ?
		ORDER BY created_at DESC LIMIT 1`, entryID, kind))
}

// GetAttachmentByCacheKey returns a cached derived attachment when present.
func (s *Store) GetAttachmentByCacheKey(ctx context.Context, entryID, cacheKey string) (Attachment, bool, error) {
	a, err := s.scanAttachment(s.db.QueryRowContext(ctx, `
		SELECT id, entry_id, kind, storage_key, COALESCE(content_type,''), size_bytes,
			COALESCE(sha256,''), cipher, COALESCE(cache_key,''), created_at
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
		&a.SizeBytes, &a.SHA256, &a.Cipher, &a.CacheKey, &createdAt); err != nil {
		return Attachment{}, err
	}
	a.CreatedAt = parseTS(createdAt)
	return a, nil
}

// UpsertMetrics stores or replaces the audio metrics for an entry.
func (s *Store) UpsertMetrics(ctx context.Context, m AudioMetrics) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO audio_metrics (entry_id, duration_ms, loudness_lufs, true_peak,
			silence_count, silence_total_ms, sample_rate, channels, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (entry_id) DO UPDATE SET
			duration_ms = excluded.duration_ms,
			loudness_lufs = excluded.loudness_lufs,
			true_peak = excluded.true_peak,
			silence_count = excluded.silence_count,
			silence_total_ms = excluded.silence_total_ms,
			sample_rate = excluded.sample_rate,
			channels = excluded.channels`,
		m.EntryID, m.DurationMS, m.LoudnessLUFS, m.TruePeak,
		m.SilenceCount, m.SilenceTotalMS, m.SampleRate, m.Channels, ts(nowUTC()))
	if err != nil {
		return fmt.Errorf("store: upsert metrics: %w", err)
	}
	return nil
}
