package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// CreateTag inserts a tag.
func (s *Store) CreateTag(ctx context.Context, t Tag) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
		t.ID, t.Name, t.Color, ts(t.CreatedAt))
	if err != nil {
		return fmt.Errorf("store: create tag: %w", err)
	}
	return nil
}

// ListTags returns tags with their entry counts.
func (s *Store) ListTags(ctx context.Context) ([]Tag, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.name, COALESCE(t.color,''),
			(SELECT COUNT(*) FROM entry_tags et WHERE et.tag_id = t.id) AS entry_count
		FROM tags t ORDER BY t.name`)
	if err != nil {
		return nil, fmt.Errorf("store: list tags: %w", err)
	}
	defer rows.Close()
	var out []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.EntryCount); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteTag removes a tag and its associations.
func (s *Store) DeleteTag(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM tags WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("store: delete tag: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AttachTag associates a tag with an entry.
func (s *Store) AttachTag(ctx context.Context, entryID, tagID string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id, created_at) VALUES (?, ?, ?)`,
		entryID, tagID, ts(time.Now()))
	if err != nil {
		return fmt.Errorf("store: attach tag: %w", err)
	}
	return nil
}

// SaveAnalysis upserts the analysis of an entry.
func (s *Store) SaveAnalysis(ctx context.Context, a Analysis) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO analyses (id, entry_id, model, sentiment, emotions, people, places, summary, raw, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.EntryID, a.Model, a.Sentiment, a.Emotions, a.People, a.Places, a.Summary, a.Raw, ts(a.CreatedAt))
	if err != nil {
		return fmt.Errorf("store: save analysis: %w", err)
	}
	return nil
}

// GetAnalysis returns the most recent analysis of an entry.
func (s *Store) GetAnalysis(ctx context.Context, entryID string) (Analysis, bool, error) {
	var a Analysis
	var createdAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, entry_id, model, sentiment, COALESCE(emotions,''), COALESCE(people,''),
			COALESCE(places,''), COALESCE(summary,''), COALESCE(raw,''), created_at
		FROM analyses WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`, entryID).Scan(
		&a.ID, &a.EntryID, &a.Model, &a.Sentiment, &a.Emotions, &a.People, &a.Places, &a.Summary, &a.Raw, &createdAt)
	if err == sql.ErrNoRows {
		return Analysis{}, false, nil
	}
	if err != nil {
		return Analysis{}, false, fmt.Errorf("store: get analysis: %w", err)
	}
	a.CreatedAt = parseTS(createdAt)
	return a, true, nil
}
