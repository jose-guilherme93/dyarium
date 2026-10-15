package store

import (
	"context"
	"fmt"
)

// CreateLink inserts a link from an entry to another entry or to a URL.
func (s *Store) CreateLink(ctx context.Context, l Link) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO links (id, from_entry_id, to_entry_id, url, label, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		l.ID, l.FromEntryID, nullString(l.ToEntryID), nullString(l.URL), nullString(l.Label), ts(l.CreatedAt))
	if err != nil {
		return fmt.Errorf("store: create link: %w", err)
	}
	return nil
}

// ListLinks returns the links from an entry, oldest first. Internal links carry
// the resolved title of the target entry. Links left without a target (a purge
// of the target entry, or a URL-less, target-less row) are skipped.
func (s *Store) ListLinks(ctx context.Context, fromEntryID string) ([]Link, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT l.id, l.from_entry_id, COALESCE(l.to_entry_id,''), COALESCE(l.url,''),
			COALESCE(l.label,''), l.created_at, COALESCE(e.title,'')
		FROM links l
		LEFT JOIN entries e ON e.id = l.to_entry_id AND e.deleted_at IS NULL
		WHERE l.from_entry_id = ?
		  AND (l.url IS NOT NULL OR l.to_entry_id IS NOT NULL)
		ORDER BY l.created_at ASC`, fromEntryID)
	if err != nil {
		return nil, fmt.Errorf("store: list links: %w", err)
	}
	defer rows.Close()
	var out []Link
	for rows.Next() {
		var l Link
		var createdAt string
		if err := rows.Scan(&l.ID, &l.FromEntryID, &l.ToEntryID, &l.URL,
			&l.Label, &createdAt, &l.Title); err != nil {
			return nil, fmt.Errorf("store: scan link: %w", err)
		}
		l.CreatedAt = parseTS(createdAt)
		out = append(out, l)
	}
	return out, rows.Err()
}

// GetLink returns a link by id.
func (s *Store) GetLink(ctx context.Context, id string) (Link, error) {
	var l Link
	var createdAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, from_entry_id, COALESCE(to_entry_id,''), COALESCE(url,''),
			COALESCE(label,''), created_at
		FROM links WHERE id = ?`, id).Scan(
		&l.ID, &l.FromEntryID, &l.ToEntryID, &l.URL, &l.Label, &createdAt)
	if err != nil {
		return Link{}, err
	}
	l.CreatedAt = parseTS(createdAt)
	return l, nil
}

// DeleteLink removes a link.
func (s *Store) DeleteLink(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM links WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("store: delete link: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
