package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Tombstone kinds. The id alone is not enough: an entry and a notebook may share
// the same identifier space in theory, and the app needs to know what to remove.
const (
	TombstoneEntry    = "entry"
	TombstoneNotebook = "notebook"
)

// Tombstone is the permanent proof that an object was deleted. It survives the
// purge of the content: only a restore removes it. Environments that were
// offline longer than the retention window use it to avoid resurrecting data.
type Tombstone struct {
	ID        string
	Kind      string
	DeletedAt string
	Origin    string
}

// PutTombstone records a deletion. It is idempotent and keeps the newest
// deletion when the same object is deleted twice: an older retry never moves the
// timestamp backwards.
func (s *Store) PutTombstone(ctx context.Context, id, kind, deletedAt, origin string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("store: tombstone sem id")
	}
	if kind != TombstoneEntry && kind != TombstoneNotebook {
		return fmt.Errorf("store: tipo de tombstone invalido: %q", kind)
	}
	if origin == "" {
		origin = "server"
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO tombstones (id, kind, deleted_at, origin)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (id, kind) DO UPDATE SET
			deleted_at = excluded.deleted_at,
			origin = excluded.origin
		WHERE excluded.deleted_at >= tombstones.deleted_at`, id, kind, deletedAt, origin)
	if err != nil {
		return fmt.Errorf("store: gravar tombstone: %w", err)
	}
	return nil
}

// DeleteTombstone removes a tombstone when the object is restored.
func (s *Store) DeleteTombstone(ctx context.Context, id, kind string) error {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM tombstones WHERE id = ? AND kind = ?`, id, kind); err != nil {
		return fmt.Errorf("store: remover tombstone: %w", err)
	}
	return nil
}

// ListTombstones returns the permanent deletions of a kind, newest first.
func (s *Store) ListTombstones(ctx context.Context, kind string, limit, offset int) ([]Tombstone, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, kind, deleted_at, origin
		FROM tombstones WHERE kind = ?
		ORDER BY deleted_at DESC, id DESC LIMIT ? OFFSET ?`, kind, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("store: listar tombstones: %w", err)
	}
	defer rows.Close()
	var out []Tombstone
	for rows.Next() {
		var t Tombstone
		if err := rows.Scan(&t.ID, &t.Kind, &t.DeletedAt, &t.Origin); err != nil {
			return nil, fmt.Errorf("store: ler tombstone: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetTombstone returns a single tombstone, if it exists.
func (s *Store) GetTombstone(ctx context.Context, id, kind string) (Tombstone, error) {
	var t Tombstone
	err := s.db.QueryRowContext(ctx,
		`SELECT id, kind, deleted_at, origin FROM tombstones WHERE id = ? AND kind = ?`,
		id, kind).Scan(&t.ID, &t.Kind, &t.DeletedAt, &t.Origin)
	if errors.Is(err, sql.ErrNoRows) {
		return Tombstone{}, ErrNotFound
	}
	if err != nil {
		return Tombstone{}, fmt.Errorf("store: ler tombstone: %w", err)
	}
	return t, nil
}
