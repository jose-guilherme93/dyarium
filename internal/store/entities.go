package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ListEntities returns the aggregated entities of a kind (person, place or
// theme), ordered by number of mentions. An empty kind lists all kinds.
func (s *Store) ListEntities(ctx context.Context, kind string) ([]EntitySummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT en.kind, en.name,
			COUNT(DISTINCT ee.entry_id),
			COALESCE(SUM(ee.count), 0),
			COALESCE(AVG(ee.sentiment), 0),
			COALESCE(MAX(COALESCE(e.recorded_at, e.created_at)), '')
		FROM entities en
		JOIN entry_entities ee ON ee.entity_id = en.id
		JOIN entries e ON e.id = ee.entry_id AND e.deleted_at IS NULL
		WHERE (? = '' OR en.kind = ?)
		GROUP BY en.id, en.kind, en.name
		ORDER BY SUM(ee.count) DESC, en.name`, kind, kind)
	if err != nil {
		return nil, fmt.Errorf("store: list entities: %w", err)
	}
	defer rows.Close()
	var out []EntitySummary
	for rows.Next() {
		var summary EntitySummary
		var lastSeen string
		if err := rows.Scan(&summary.Kind, &summary.Name, &summary.Entries,
			&summary.Mentions, &summary.Sentiment, &lastSeen); err != nil {
			return nil, fmt.Errorf("store: scan entity: %w", err)
		}
		summary.LastSeen = parseTS(lastSeen)
		out = append(out, summary)
	}
	return out, rows.Err()
}

// GetEntity returns one aggregated entity and the entries that mention it.
// ok is false when the entity does not exist.
func (s *Store) GetEntity(ctx context.Context, kind, name string) (EntitySummary, []EntityEntry, bool, error) {
	var summary EntitySummary
	var lastSeen string
	err := s.db.QueryRowContext(ctx, `
		SELECT en.kind, en.name,
			COUNT(DISTINCT ee.entry_id),
			COALESCE(SUM(ee.count), 0),
			COALESCE(AVG(ee.sentiment), 0),
			COALESCE(MAX(COALESCE(e.recorded_at, e.created_at)), '')
		FROM entities en
		JOIN entry_entities ee ON ee.entity_id = en.id
		JOIN entries e ON e.id = ee.entry_id AND e.deleted_at IS NULL
		WHERE en.kind = ? AND lower(en.name) = lower(?)
		GROUP BY en.id, en.kind, en.name`, kind, name).Scan(
		&summary.Kind, &summary.Name, &summary.Entries, &summary.Mentions, &summary.Sentiment, &lastSeen)
	if err == sql.ErrNoRows {
		return EntitySummary{}, nil, false, nil
	}
	if err != nil {
		return EntitySummary{}, nil, false, fmt.Errorf("store: get entity: %w", err)
	}
	summary.LastSeen = parseTS(lastSeen)

	rows, err := s.db.QueryContext(ctx, `
		SELECT e.id, COALESCE(e.title,''), COALESCE(e.recorded_at, e.created_at), ee.count
		FROM entry_entities ee
		JOIN entries e ON e.id = ee.entry_id AND e.deleted_at IS NULL
		JOIN entities en ON en.id = ee.entity_id
		WHERE en.kind = ? AND lower(en.name) = lower(?)
		ORDER BY e.created_at DESC`, kind, name)
	if err != nil {
		return EntitySummary{}, nil, false, fmt.Errorf("store: list entity entries: %w", err)
	}
	defer rows.Close()
	var entries []EntityEntry
	for rows.Next() {
		var entry EntityEntry
		var date string
		if err := rows.Scan(&entry.EntryID, &entry.Title, &date, &entry.Count); err != nil {
			return EntitySummary{}, nil, false, fmt.Errorf("store: scan entity entry: %w", err)
		}
		entry.Date = parseTS(date)
		entries = append(entries, entry)
	}
	return summary, entries, true, rows.Err()
}

// MoodSeries returns the daily average sentiment, optionally bounded by from
// and to (zero values mean unbounded).
func (s *Store) MoodSeries(ctx context.Context, from, to time.Time) ([]MoodPoint, error) {
	query := `
		SELECT substr(COALESCE(e.recorded_at, e.created_at), 1, 10) AS day,
			COALESCE(AVG(a.sentiment), 0), COUNT(DISTINCT a.entry_id)
		FROM analyses a
		JOIN entries e ON e.id = a.entry_id AND e.deleted_at IS NULL
		WHERE 1 = 1`
	var args []any
	if !from.IsZero() {
		query += ` AND COALESCE(e.recorded_at, e.created_at) >= ?`
		args = append(args, ts(from))
	}
	if !to.IsZero() {
		query += ` AND COALESCE(e.recorded_at, e.created_at) <= ?`
		args = append(args, ts(to))
	}
	query += ` GROUP BY day ORDER BY day`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: mood series: %w", err)
	}
	defer rows.Close()
	var out []MoodPoint
	for rows.Next() {
		var point MoodPoint
		if err := rows.Scan(&point.Date, &point.Sentiment, &point.Entries); err != nil {
			return nil, fmt.Errorf("store: scan mood point: %w", err)
		}
		out = append(out, point)
	}
	return out, rows.Err()
}
