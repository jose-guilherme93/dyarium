package store

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Activity is a process that finished for a note: a transcription or an
// analysis. The web notifications menu reads this list, newest first, and each
// item opens the note it belongs to.
type Activity struct {
	ID         string    `json:"id"`
	EntryID    string    `json:"entry_id"`
	Kind       string    `json:"kind"`
	Title      string    `json:"title"`
	FinishedAt time.Time `json:"finished_at"`
}

// ListActivities returns the most recent completed transcriptions and analyses,
// newest first. Failed runs and deleted entries stay out: the menu is a history
// of what was delivered, not of what was attempted.
func (s *Store) ListActivities(ctx context.Context, limit int) ([]Activity, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.kind, a.entry_id,
		       COALESCE(NULLIF(e.title, ''), NULLIF(e.original_filename, ''), ''),
		       a.finished_at
		FROM (
			SELECT t.id AS id, 'transcription' AS kind, t.entry_id AS entry_id,
			       t.created_at AS finished_at
			FROM transcripts t
			UNION ALL
			SELECT r.id AS id, 'analysis' AS kind, r.entry_id AS entry_id,
			       r.finished_at AS finished_at
			FROM analysis_runs r
			WHERE r.outcome = 'ok'
		) a
		JOIN entries e ON e.id = a.entry_id
		WHERE e.deleted_at IS NULL
		ORDER BY a.finished_at DESC, a.id DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list activities: %w", err)
	}
	defer rows.Close()
	var out []Activity
	for rows.Next() {
		var activity Activity
		var finished string
		if err := rows.Scan(&activity.ID, &activity.Kind, &activity.EntryID, &activity.Title, &finished); err != nil {
			return nil, fmt.Errorf("store: scan activity: %w", err)
		}
		activity.Title = strings.TrimSpace(activity.Title)
		if activity.Title == "" {
			activity.Title = "Nota"
		}
		activity.FinishedAt = parseTS(finished)
		out = append(out, activity)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []Activity{}
	}
	return out, nil
}
