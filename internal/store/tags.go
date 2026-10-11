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

// execer is implemented by *sql.DB and *sql.Tx, so statements can run inside or
// outside a transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// insertAnalysis writes one analysis row.
func insertAnalysis(ctx context.Context, ex execer, a Analysis) error {
	_, err := ex.ExecContext(ctx, `
		INSERT INTO analyses (id, entry_id, model, sentiment, sentiment_label, emotions, people, places, summary, raw, data, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.EntryID, a.Model, a.Sentiment, a.SentimentLabel, a.Emotions, a.People, a.Places,
		a.Summary, a.Raw, a.Data, ts(a.CreatedAt))
	if err != nil {
		return fmt.Errorf("store: save analysis: %w", err)
	}
	return nil
}

// SaveAnalysis stores the analysis of an entry.
func (s *Store) SaveAnalysis(ctx context.Context, a Analysis) error {
	return insertAnalysis(ctx, s.db, a)
}

// SaveRichAnalysis stores the analysis and its entities in a single
// transaction, replacing the entry's previous entity links.
func (s *Store) SaveRichAnalysis(ctx context.Context, a Analysis, links []EntityLink) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin analysis tx: %w", err)
	}
	defer tx.Rollback()

	if err := insertAnalysis(ctx, tx, a); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entry_entities WHERE entry_id = ?`, a.EntryID); err != nil {
		return fmt.Errorf("store: clear entry entities: %w", err)
	}
	for _, link := range links {
		entityID, err := upsertEntity(ctx, tx, link.Kind, link.Name, a.CreatedAt)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (entry_id, entity_id) DO UPDATE SET
				count = excluded.count, relation = excluded.relation, sentiment = excluded.sentiment`,
			a.EntryID, entityID, link.Count, nullText(link.Relation), nullFloat(link.Sentiment), ts(a.CreatedAt)); err != nil {
			return fmt.Errorf("store: link entity: %w", err)
		}
	}
	return tx.Commit()
}

func upsertEntity(ctx context.Context, ex execer, kind, name string, now time.Time) (string, error) {
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO entities (id, kind, name, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (kind, name) DO UPDATE SET name = excluded.name`,
		newID(), kind, name, ts(now)); err != nil {
		return "", fmt.Errorf("store: upsert entity: %w", err)
	}
	var id string
	if err := ex.QueryRowContext(ctx,
		`SELECT id FROM entities WHERE kind = ? AND name = ?`, kind, name).Scan(&id); err != nil {
		return "", fmt.Errorf("store: find entity: %w", err)
	}
	return id, nil
}

func nullText(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func nullFloat(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

// GetAnalysis returns the most recent analysis of an entry.
func (s *Store) GetAnalysis(ctx context.Context, entryID string) (Analysis, bool, error) {
	var a Analysis
	var createdAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, entry_id, model, sentiment, COALESCE(sentiment_label,''), COALESCE(emotions,''),
			COALESCE(people,''), COALESCE(places,''), COALESCE(summary,''), COALESCE(raw,''),
			COALESCE(data,''), created_at
		FROM analyses WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`, entryID).Scan(
		&a.ID, &a.EntryID, &a.Model, &a.Sentiment, &a.SentimentLabel, &a.Emotions, &a.People,
		&a.Places, &a.Summary, &a.Raw, &a.Data, &createdAt)
	if err == sql.ErrNoRows {
		return Analysis{}, false, nil
	}
	if err != nil {
		return Analysis{}, false, fmt.Errorf("store: get analysis: %w", err)
	}
	a.CreatedAt = parseTS(createdAt)
	return a, true, nil
}
