package store

import (
	"context"
	"database/sql"
	"fmt"
)

// SaveTranscript replaces any existing transcript for the given audio and
// stores the new transcript with its segments, all in a single transaction.
func (s *Store) SaveTranscript(ctx context.Context, t Transcript, segs []Segment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin transcript tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM transcripts WHERE entry_id = ? AND attachment_id IS ?`, t.EntryID, nullString(t.AttachmentID)); err != nil {
		return fmt.Errorf("store: clear transcripts: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO transcripts (id, entry_id, attachment_id, model, language, text, trim_silence, duration_seconds, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.EntryID, nullString(t.AttachmentID), t.Model, t.Language, t.Text, boolInt(t.TrimSilence), t.DurationSeconds, ts(t.CreatedAt)); err != nil {
		return fmt.Errorf("store: insert transcript: %w", err)
	}
	for i, seg := range segs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO segments (id, transcript_id, idx, start_ms, end_ms, text, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			seg.ID, t.ID, i, seg.StartMS, seg.EndMS, seg.Text, ts(t.CreatedAt)); err != nil {
			return fmt.Errorf("store: insert segment: %w", err)
		}
	}
	return tx.Commit()
}

const transcriptColumns = `id, entry_id, COALESCE(attachment_id,''), model, COALESCE(language,''),
	text, trim_silence, duration_seconds, created_at`

func scanTranscript(row interface {
	Scan(dest ...any) error
}) (Transcript, error) {
	var t Transcript
	var createdAt string
	var trim int
	if err := row.Scan(&t.ID, &t.EntryID, &t.AttachmentID, &t.Model, &t.Language,
		&t.Text, &trim, &t.DurationSeconds, &createdAt); err != nil {
		return Transcript{}, err
	}
	t.TrimSilence = trim == 1
	t.CreatedAt = parseTS(createdAt)
	return t, nil
}

// GetTranscript returns the most recent transcript of an entry (the first audio
// when the entry has several). Kept for callers that still work per entry.
func (s *Store) GetTranscript(ctx context.Context, entryID string) (Transcript, []Segment, error) {
	t, err := scanTranscript(s.db.QueryRowContext(ctx, `
		SELECT `+transcriptColumns+`
		FROM transcripts WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`, entryID))
	if err != nil {
		return Transcript{}, nil, err
	}
	segs, err := s.ListSegments(ctx, t.ID)
	if err != nil {
		return Transcript{}, nil, err
	}
	return t, segs, nil
}

// GetTranscriptByAttachment returns the transcript and segments of one audio.
func (s *Store) GetTranscriptByAttachment(ctx context.Context, attachmentID string) (Transcript, []Segment, error) {
	t, err := scanTranscript(s.db.QueryRowContext(ctx, `
		SELECT `+transcriptColumns+`
		FROM transcripts WHERE attachment_id = ? ORDER BY created_at DESC LIMIT 1`, attachmentID))
	if err != nil {
		return Transcript{}, nil, err
	}
	segs, err := s.ListSegments(ctx, t.ID)
	if err != nil {
		return Transcript{}, nil, err
	}
	return t, segs, nil
}

// ListTranscripts returns the transcripts of an entry, oldest first.
func (s *Store) ListTranscripts(ctx context.Context, entryID string) ([]Transcript, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+transcriptColumns+`
		FROM transcripts WHERE entry_id = ? ORDER BY created_at ASC`, entryID)
	if err != nil {
		return nil, fmt.Errorf("store: list transcripts: %w", err)
	}
	defer rows.Close()
	var out []Transcript
	for rows.Next() {
		t, err := scanTranscript(rows)
		if err != nil {
			return nil, fmt.Errorf("store: scan transcript: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListSegments returns the segments of a transcript ordered by index.
func (s *Store) ListSegments(ctx context.Context, transcriptID string) ([]Segment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, transcript_id, idx, start_ms, end_ms, text, created_at
		FROM segments WHERE transcript_id = ? ORDER BY idx`, transcriptID)
	if err != nil {
		return nil, fmt.Errorf("store: list segments: %w", err)
	}
	defer rows.Close()
	var out []Segment
	for rows.Next() {
		var seg Segment
		var createdAt string
		var speaker sql.NullString
		if err := rows.Scan(&seg.ID, &seg.TranscriptID, &seg.Idx, &seg.StartMS, &seg.EndMS, &seg.Text, &createdAt); err != nil {
			return nil, fmt.Errorf("store: scan segment: %w", err)
		}
		seg.CreatedAt = parseTS(createdAt)
		_ = speaker
		out = append(out, seg)
	}
	return out, rows.Err()
}

// GetMetrics returns the audio metrics for an entry; ok is false when absent.
func (s *Store) GetMetrics(ctx context.Context, entryID string) (AudioMetrics, bool, error) {
	var m AudioMetrics
	err := s.db.QueryRowContext(ctx, `
		SELECT entry_id, duration_ms, COALESCE(loudness_lufs,0), COALESCE(true_peak,0),
			silence_count, silence_total_ms, COALESCE(sample_rate,0), COALESCE(channels,0),
			whisper_peak_rss_mb
		FROM audio_metrics WHERE entry_id = ?`, entryID).Scan(
		&m.EntryID, &m.DurationMS, &m.LoudnessLUFS, &m.TruePeak,
		&m.SilenceCount, &m.SilenceTotalMS, &m.SampleRate, &m.Channels, &m.WhisperPeakRSSMB)
	if err == sql.ErrNoRows {
		return AudioMetrics{}, false, nil
	}
	if err != nil {
		return AudioMetrics{}, false, fmt.Errorf("store: get metrics: %w", err)
	}
	return m, true, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
