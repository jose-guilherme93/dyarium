package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// keptRevision is a revision read before a transcript is replaced. It is
// reattached to the new segment when the text at the same index did not change,
// so editing one segment or re-uploading the transcript from the app does not
// throw away the revisions of every other segment.
type keptRevision struct {
	original string
	text     string
	model    string
	version  int
	literal  bool
	created  time.Time
}

// SaveTranscript replaces any existing transcript for the given audio and
// stores the new transcript with its segments, all in a single transaction.
// Revisions survive when the segment text is unchanged.
func (s *Store) SaveTranscript(ctx context.Context, t Transcript, segs []Segment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin transcript tx: %w", err)
	}
	defer tx.Rollback()

	kept, err := revisionsByIndex(ctx, tx, t.EntryID, t.AttachmentID)
	if err != nil {
		return err
	}
	// O app reenvia a transcricao ao abrir a nota. Quando o texto e o mesmo, a
	// passada de revisao continua valendo por inteiro: as linhas por trecho ja
	// sao preservadas abaixo, e a compreensao/recusados/estado da passada
	// tambem precisam sobreviver. Sem isso uma nota revisada virava
	// "sem revisao" e a analise perdia a estimativa medida.
	previous, err := previousTranscriptState(ctx, tx, t.EntryID, t.AttachmentID)
	if err != nil {
		return err
	}
	carry := previous != nil && sameOrEditedSegments(previous.texts, segs)
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM transcripts WHERE entry_id = ? AND attachment_id IS ?`, t.EntryID, nullString(t.AttachmentID)); err != nil {
		return fmt.Errorf("store: clear transcripts: %w", err)
	}
	comprehension, rejected, through, finished := -1, 0, 0, 0
	revisedModel, revisedVersion, revisedLiteral := "", 0, 0
	if carry {
		comprehension = previous.comprehension
		rejected = previous.rejected
		through = previous.through
		finished = boolInt(previous.finished)
		revisedModel = previous.model
		revisedVersion = previous.version
		revisedLiteral = boolInt(previous.literal)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO transcripts (id, entry_id, attachment_id, model, language, text, trim_silence,
			duration_seconds, revised_comprehension, revised_rejected, revised_through,
			revised_finished, revised_model, revised_prompt_version, revised_literal, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.EntryID, nullString(t.AttachmentID), t.Model, t.Language, t.Text, boolInt(t.TrimSilence),
		t.DurationSeconds, comprehension, rejected, through, finished, revisedModel,
		revisedVersion, revisedLiteral, ts(t.CreatedAt)); err != nil {
		return fmt.Errorf("store: insert transcript: %w", err)
	}
	for i, seg := range segs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO segments (id, transcript_id, idx, start_ms, end_ms, text, user_edited, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			seg.ID, t.ID, i, seg.StartMS, seg.EndMS, seg.Text, boolInt(seg.UserEdited), ts(t.CreatedAt)); err != nil {
			return fmt.Errorf("store: insert segment: %w", err)
		}
		if prev, ok := kept[i]; ok && !seg.UserEdited && prev.original == seg.Text && prev.text != "" {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO transcript_revisions (segment_id, transcript_id, text, model, prompt_version, literal, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
				seg.ID, t.ID, prev.text, prev.model, prev.version, boolInt(prev.literal), ts(prev.created)); err != nil {
				return fmt.Errorf("store: keep revision: %w", err)
			}
		}
	}
	if err := refreshRevisedText(ctx, tx, t.ID); err != nil {
		return err
	}
	return tx.Commit()
}

// previousTranscript is the revision metadata of the transcript about to be
// replaced. texts keeps the original segment text so a resync with the same
// content can tell "same transcript" from "retranscribed".
type previousTranscript struct {
	comprehension int
	rejected      int
	through       int
	finished      bool
	model         string
	version       int
	literal       bool
	texts         []string
}

// previousTranscriptState reads the metadata and the segment texts of the
// transcript that SaveTranscript is about to replace. A nil result means the
// entry has no transcript for this audio yet.
func previousTranscriptState(ctx context.Context, tx *sql.Tx, entryID, attachmentID string) (*previousTranscript, error) {
	var state previousTranscript
	var finished, literal int
	err := tx.QueryRowContext(ctx, `
		SELECT revised_comprehension, revised_rejected, revised_through, revised_finished,
			COALESCE(revised_model,''), revised_prompt_version, revised_literal
		FROM transcripts WHERE entry_id = ? AND attachment_id IS ?
		ORDER BY created_at DESC LIMIT 1`,
		entryID, nullString(attachmentID)).Scan(
		&state.comprehension, &state.rejected, &state.through, &finished,
		&state.model, &state.version, &literal)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: read previous transcript: %w", err)
	}
	state.finished = finished == 1
	state.literal = literal == 1
	rows, err := tx.QueryContext(ctx, `
		SELECT s.text FROM segments s
		JOIN transcripts t ON t.id = s.transcript_id
		WHERE t.entry_id = ? AND t.attachment_id IS ?
		ORDER BY s.idx`,
		entryID, nullString(attachmentID))
	if err != nil {
		return nil, fmt.Errorf("store: read previous transcript texts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			return nil, fmt.Errorf("store: scan previous transcript text: %w", err)
		}
		state.texts = append(state.texts, text)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &state, nil
}

// sameOrEditedSegments reports whether the new transcript is the old one with
// possible hand edits. A retranscription (different text, not edited) starts a
// new revision; a sync with an edited segment keeps the pass metadata, because
// the audio and the measured comprehension did not change.
func sameOrEditedSegments(previous []string, segs []Segment) bool {
	if len(previous) != len(segs) {
		return false
	}
	for i, seg := range segs {
		if previous[i] == seg.Text {
			continue
		}
		if !seg.UserEdited {
			return false
		}
	}
	return true
}

// revisionsByIndex reads the revisions of the transcript that is about to be
// replaced, keyed by segment index.
func revisionsByIndex(ctx context.Context, tx *sql.Tx, entryID, attachmentID string) (map[int]keptRevision, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT s.idx, s.text, r.text, r.model, r.prompt_version, r.literal, r.created_at
		FROM segments s
		JOIN transcript_revisions r ON r.segment_id = s.id
		JOIN transcripts t ON t.id = s.transcript_id
		WHERE t.entry_id = ? AND t.attachment_id IS ?
			AND t.id = (SELECT id FROM transcripts WHERE entry_id = ? AND attachment_id IS ?
				ORDER BY created_at DESC LIMIT 1)`,
		entryID, nullString(attachmentID), entryID, nullString(attachmentID))
	if err != nil {
		return nil, fmt.Errorf("store: read kept revisions: %w", err)
	}
	defer rows.Close()
	out := map[int]keptRevision{}
	for rows.Next() {
		var idx int
		var k keptRevision
		var created string
		var literal int
		if err := rows.Scan(&idx, &k.original, &k.text, &k.model, &k.version, &literal, &created); err != nil {
			return nil, fmt.Errorf("store: scan kept revision: %w", err)
		}
		k.literal = literal == 1
		k.created = parseTS(created)
		out[idx] = k
	}
	return out, rows.Err()
}

// refreshRevisedText rebuilds the joined revision stored on the transcript row
// (used by the list preview) from the per-segment revisions.
func refreshRevisedText(ctx context.Context, tx *sql.Tx, transcriptID string) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT COALESCE(r.text, s.text), COALESCE(r.model, ''), COALESCE(r.prompt_version, 0),
			COALESCE(r.literal, 0), CASE WHEN r.text IS NULL THEN 0 ELSE 1 END
		FROM segments s
		LEFT JOIN transcript_revisions r ON r.segment_id = s.id
		WHERE s.transcript_id = ?
		ORDER BY s.idx`, transcriptID)
	if err != nil {
		return fmt.Errorf("store: read revisions: %w", err)
	}
	defer rows.Close()
	var parts []string
	model := ""
	version := 0
	literal := 0
	revisedCount := 0
	for rows.Next() {
		var text string
		var segModel string
		var segVersion, segLiteral int
		var revised int
		if err := rows.Scan(&text, &segModel, &segVersion, &segLiteral, &revised); err != nil {
			return fmt.Errorf("store: scan revision: %w", err)
		}
		parts = append(parts, text)
		revisedCount += revised
		if revised == 1 && model == "" {
			model = segModel
			version = segVersion
			literal = segLiteral
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	// Sem nenhuma revisao o derivado nao existe: revised_text fica vazio para a
	// leitura cair no texto cru (e a lista nao duplicar a mesma string). O
	// modelo/versao/modo tambem ficam como estao: num resync eles vieram da
	// linha anterior, e uma passada zerada por BeginRevision ja os limpou.
	if revisedCount == 0 {
		if _, err := tx.ExecContext(ctx,
			`UPDATE transcripts SET revised_text = '' WHERE id = ?`, transcriptID); err != nil {
			return fmt.Errorf("store: clear revised text: %w", err)
		}
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE transcripts SET revised_text = ?, revised_model = ?, revised_prompt_version = ?,
			revised_literal = ?
		WHERE id = ?`, strings.Join(parts, "\n"), model, version, literal, transcriptID); err != nil {
		return fmt.Errorf("store: update revised text: %w", err)
	}
	return nil
}

// LinkLooseTranscripts attaches a transcript stored without an audio (the app
// sent it before the upload existed, or an old build left it loose) to the
// entry's only original audio. With several audios the link is ambiguous, so
// nothing changes. Idempotent; runs at boot.
func (s *Store) LinkLooseTranscripts(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE transcripts SET attachment_id = (
			SELECT a.id FROM attachments a
			WHERE a.entry_id = transcripts.entry_id AND a.kind = ?
		)
		WHERE attachment_id IS NULL
			AND (SELECT COUNT(*) FROM attachments a
				WHERE a.entry_id = transcripts.entry_id AND a.kind = ?) = 1`,
		AttachmentOriginal, AttachmentOriginal)
	if err != nil {
		return 0, fmt.Errorf("store: link loose transcripts: %w", err)
	}
	return res.RowsAffected()
}

// SaveRevisions replaces the revisions of a transcript with the given set. A
// transcript whose revisions are all rejected (or cleared) keeps the raw text
// as the visible one: revised_text becomes empty.
func (s *Store) SaveRevisions(ctx context.Context, transcriptID string, revs []TranscriptRevision, comprehension, rejected, through int, model string, version int, literal bool) error {
	if err := s.BeginRevision(ctx, transcriptID); err != nil {
		return err
	}
	if err := s.SaveRevisionWindow(ctx, transcriptID, revs, rejected, through); err != nil {
		return err
	}
	return s.FinishRevision(ctx, transcriptID, comprehension, rejected, through, model, version, literal)
}

// BeginRevision clears the previous revision before a new pass. It runs before
// the first window on purpose: the pass only restarts when the stored revision
// is stale (another model, prompt, mode or text), so the old one is not worth
// keeping. A pass that dies before the first accepted window leaves the
// transcript honestly marked as "not revised" instead of mixing two passes.
func (s *Store) BeginRevision(ctx context.Context, transcriptID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin revision tx: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM transcript_revisions WHERE transcript_id = ?`, transcriptID); err != nil {
		return fmt.Errorf("store: clear revisions: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE transcripts SET revised_text = '', revised_model = '', revised_prompt_version = 0,
			revised_literal = 0, revised_comprehension = -1, revised_rejected = 0,
			revised_through = 0, revised_finished = 0
		WHERE id = ?`, transcriptID); err != nil {
		return fmt.Errorf("store: reset revision: %w", err)
	}
	return tx.Commit()
}

// SaveRevisionWindow stores the revision of one window and rebuilds the joined
// text, so the reader sees the revision grow while the model still works on the
// rest. revs carries every reviewed segment of the window, including the ones
// that came back unchanged: a row means "reviewed", a missing row means "not
// reviewed yet". rejected is cumulative across the pass.
func (s *Store) SaveRevisionWindow(ctx context.Context, transcriptID string, revs []TranscriptRevision, rejected, through int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin revision window tx: %w", err)
	}
	defer tx.Rollback()
	for _, rev := range revs {
		if strings.TrimSpace(rev.Text) == "" || rev.SegmentID == "" {
			continue
		}
		created := rev.CreatedAt
		if created.IsZero() {
			created = time.Now().UTC()
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO transcript_revisions (segment_id, transcript_id, text, model, prompt_version, literal, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (segment_id) DO UPDATE SET
				text = excluded.text, model = excluded.model,
				prompt_version = excluded.prompt_version, literal = excluded.literal,
				created_at = excluded.created_at`,
			rev.SegmentID, transcriptID, rev.Text, rev.Model, rev.PromptVersion, boolInt(rev.Literal), ts(created)); err != nil {
			return fmt.Errorf("store: insert revision: %w", err)
		}
	}
	if err := refreshRevisedText(ctx, tx, transcriptID); err != nil {
		return err
	}
	if through < 0 {
		through = 0
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE transcripts SET revised_rejected = ?, revised_through = MAX(revised_through, ?)
		WHERE id = ?`, rejected, through, transcriptID); err != nil {
		return fmt.Errorf("store: update revised progress: %w", err)
	}
	return tx.Commit()
}

// FinishRevision closes the pass with the comprehension estimate, the final
// rejected count and how far it reached. finished is derived from the segment
// count: a pass that reaches the end is finished even when it rejected some
// segments along the way. That distinction is what keeps "sem revisão" from
// looking like "ainda revisando".
func (s *Store) FinishRevision(ctx context.Context, transcriptID string, comprehension, rejected, through int, model string, version int, literal bool) error {
	if through < 0 {
		through = 0
	}
	// A passada grava o modelo/versao/modo mesmo quando todas as janelas foram
	// recusadas e nao sobrou nenhuma linha de revisao. Sem isso o painel nao
	// tinha como mostrar "0 alterados, N sem revisao": parecia nunca revisado.
	if _, err := s.db.ExecContext(ctx, `
		UPDATE transcripts SET revised_comprehension = ?, revised_rejected = ?,
			revised_through = MAX(revised_through, ?),
			revised_finished = CASE WHEN ? >= (SELECT COUNT(*) FROM segments WHERE transcript_id = ?)
				THEN 1 ELSE 0 END,
			revised_model = CASE WHEN ? <> '' THEN ? ELSE revised_model END,
			revised_prompt_version = CASE WHEN ? > 0 THEN ? ELSE revised_prompt_version END,
			revised_literal = ?
		WHERE id = ?`,
		comprehension, rejected, through, through, transcriptID,
		model, model, version, version, boolInt(literal), transcriptID); err != nil {
		return fmt.Errorf("store: finish revision: %w", err)
	}
	return nil
}

const transcriptColumns = `id, entry_id, COALESCE(attachment_id,''), model, COALESCE(language,''),
	text, trim_silence, duration_seconds, COALESCE(revised_text,''), COALESCE(revised_model,''),
	revised_prompt_version, revised_literal, revised_comprehension, revised_rejected,
	revised_through, revised_finished,
	(SELECT COUNT(*) FROM segments s WHERE s.transcript_id = transcripts.id),
	(SELECT COUNT(*) FROM segments s JOIN transcript_revisions r ON r.segment_id = s.id
		WHERE s.transcript_id = transcripts.id AND s.user_edited = 0 AND r.text <> s.text),
	(SELECT COUNT(*) FROM segments s WHERE s.transcript_id = transcripts.id
		AND s.user_edited = 0 AND s.idx >= transcripts.revised_through),
	created_at`

func scanTranscript(row interface {
	Scan(dest ...any) error
}) (Transcript, error) {
	var t Transcript
	var createdAt string
	var trim int
	var literal int
	var finished int
	if err := row.Scan(&t.ID, &t.EntryID, &t.AttachmentID, &t.Model, &t.Language,
		&t.Text, &trim, &t.DurationSeconds, &t.RevisedText, &t.RevisedModel,
		&t.RevisedPromptVersion, &literal, &t.RevisedComprehension, &t.RevisedRejected,
		&t.RevisedThrough, &finished, &t.SegmentCount, &t.RevisedChanged, &t.RevisedPending,
		&createdAt); err != nil {
		return Transcript{}, err
	}
	t.TrimSilence = trim == 1
	t.RevisedLiteral = literal == 1
	t.RevisedFinished = finished == 1
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

// LatestTranscript returns the most recent transcript of an entry without its
// segments. Handlers that only need metadata should not pay to load them.
func (s *Store) LatestTranscript(ctx context.Context, entryID string) (Transcript, error) {
	return scanTranscript(s.db.QueryRowContext(ctx, `
		SELECT `+transcriptColumns+`
		FROM transcripts WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`, entryID))
}

// TranscriptByAttachment returns the transcript of one audio without segments.
func (s *Store) TranscriptByAttachment(ctx context.Context, attachmentID string) (Transcript, error) {
	return scanTranscript(s.db.QueryRowContext(ctx, `
		SELECT `+transcriptColumns+`
		FROM transcripts WHERE attachment_id = ? ORDER BY created_at DESC LIMIT 1`, attachmentID))
}

// ListSegmentsPage returns one page of segments ordered by index. It reads one
// extra row to tell the caller whether another page exists.
func (s *Store) ListSegmentsPage(ctx context.Context, transcriptID string, offset, limit int) ([]Segment, bool, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.transcript_id, s.idx, s.start_ms, s.end_ms, s.text,
			COALESCE(r.text,''), s.user_edited, s.created_at
		FROM segments s
		LEFT JOIN transcript_revisions r ON r.segment_id = s.id
		WHERE s.transcript_id = ? ORDER BY s.idx LIMIT ? OFFSET ?`,
		transcriptID, limit+1, offset)
	if err != nil {
		return nil, false, fmt.Errorf("store: list segment page: %w", err)
	}
	defer rows.Close()
	var out []Segment
	for rows.Next() {
		var seg Segment
		var createdAt string
		var edited int
		if err := rows.Scan(&seg.ID, &seg.TranscriptID, &seg.Idx, &seg.StartMS, &seg.EndMS, &seg.Text,
			&seg.Revised, &edited, &createdAt); err != nil {
			return nil, false, err
		}
		seg.UserEdited = edited == 1
		seg.CreatedAt = parseTS(createdAt)
		out = append(out, seg)
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

// ListSegments returns the segments of a transcript ordered by index.
func (s *Store) ListSegments(ctx context.Context, transcriptID string) ([]Segment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.transcript_id, s.idx, s.start_ms, s.end_ms, s.text,
			COALESCE(r.text,''), s.user_edited, s.created_at
		FROM segments s
		LEFT JOIN transcript_revisions r ON r.segment_id = s.id
		WHERE s.transcript_id = ? ORDER BY s.idx`, transcriptID)
	if err != nil {
		return nil, fmt.Errorf("store: list segments: %w", err)
	}
	defer rows.Close()
	var out []Segment
	for rows.Next() {
		var seg Segment
		var createdAt string
		var edited int
		if err := rows.Scan(&seg.ID, &seg.TranscriptID, &seg.Idx, &seg.StartMS, &seg.EndMS, &seg.Text,
			&seg.Revised, &edited, &createdAt); err != nil {
			return nil, fmt.Errorf("store: scan segment: %w", err)
		}
		seg.UserEdited = edited == 1
		seg.CreatedAt = parseTS(createdAt)
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
