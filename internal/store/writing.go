package store

import (
	"context"

	"fmt"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/preview"
)

// WritingDay is the net words written in a book on one day. Days without
// writing are filled with zero so the rhythm strip always has its window.
type WritingDay struct {
	Day   string
	Words int
}

// wordCount counts prose words the same way the book home does: markdown is
// reduced to plain text first, so syntax characters never count as words.
func wordCount(markdown string) int {
	return len(strings.Fields(preview.Plain(markdown)))
}

// recordWritingDelta adds the net words of one edit to the book day. Deletions
// subtract, so "hoje" shows what the session actually added, not what the text
// happens to contain. The day is the server date.
func recordWritingDelta(ctx context.Context, q execer, notebookID string, delta int) error {
	if delta == 0 || notebookID == "" {
		return nil
	}
	day := time.Now().Format("2006-01-02")
	if _, err := q.ExecContext(ctx, `
		INSERT INTO writing_days (notebook_id, day, words) VALUES (?, ?, ?)
		ON CONFLICT (notebook_id, day) DO UPDATE SET words = words + excluded.words`,
		notebookID, day, delta); err != nil {
		return fmt.Errorf("store: record writing delta: %w", err)
	}
	return nil
}

// AddWritingDelta records a manual delta in today's row. The body writes use
// recordWritingDelta inside their own transaction; this one exists for callers
// without a transaction (tests and future importers).
func (s *Store) AddWritingDelta(ctx context.Context, notebookID string, delta int) error {
	return recordWritingDelta(ctx, s.db, notebookID, delta)
}

// WritingDays returns the net words of the last days, oldest first, including
// days with no writing. Negative days (a session that only deleted) are
// clamped to zero for display.
func (s *Store) WritingDays(ctx context.Context, notebookID string, days int) ([]WritingDay, error) {
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}
	now := time.Now()
	start := now.AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	rows, err := s.db.QueryContext(ctx, `
		SELECT day, words FROM writing_days
		WHERE notebook_id = ? AND day >= ?
		ORDER BY day`, notebookID, start)
	if err != nil {
		return nil, fmt.Errorf("store: writing days: %w", err)
	}
	defer rows.Close()
	counted := map[string]int{}
	for rows.Next() {
		var day string
		var words int
		if err := rows.Scan(&day, &words); err != nil {
			return nil, fmt.Errorf("store: scan writing day: %w", err)
		}
		counted[day] = words
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]WritingDay, 0, days)
	for i := days - 1; i >= 0; i-- {
		day := now.AddDate(0, 0, -i).Format("2006-01-02")
		words := counted[day]
		if words < 0 {
			words = 0
		}
		out = append(out, WritingDay{Day: day, Words: words})
	}
	return out, nil
}

// bookOfEntry resolves the notebook of an entry and whether it is a book. An
// entry without a notebook is a regular note.
func bookOfEntry(ctx context.Context, q execer, entryID string) (notebookID string, isBook bool, err error) {
	var kind string
	err = q.QueryRowContext(ctx, `
		SELECT COALESCE(e.notebook_id, ''), COALESCE(n.kind, 'notes')
		FROM entries e LEFT JOIN notebooks n ON n.id = e.notebook_id
		WHERE e.id = ?`, entryID).Scan(&notebookID, &kind)
	if err != nil {
		return "", false, err
	}
	return notebookID, kind == NotebookKindBook, nil
}

// BookEntityCount is one entity found in the live chapters of a book. The
// writer panel shows "Aparece em" without starting an analysis.
type BookEntityCount struct {
	Kind     string
	Name     string
	Mentions int
	Chapters int
}

// BookEntities lists the people, places and themes already found in the book
// chapters, most mentioned first.
func (s *Store) BookEntities(ctx context.Context, notebookID string, limit int) ([]BookEntityCount, error) {
	if limit <= 0 || limit > 60 {
		limit = 30
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT en.kind, en.name, SUM(ee.count), COUNT(DISTINCT ee.entry_id)
		FROM entry_entities ee
		JOIN entities en ON en.id = ee.entity_id
		JOIN entries e ON e.id = ee.entry_id
		WHERE e.notebook_id = ? AND e.deleted_at IS NULL
		GROUP BY en.id, en.kind, en.name
		ORDER BY SUM(ee.count) DESC, en.name ASC
		LIMIT ?`, notebookID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: book entities: %w", err)
	}
	defer rows.Close()
	var out []BookEntityCount
	for rows.Next() {
		var item BookEntityCount
		if err := rows.Scan(&item.Kind, &item.Name, &item.Mentions, &item.Chapters); err != nil {
			return nil, fmt.Errorf("store: scan book entity: %w", err)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
