package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// SetBookCover replaces the cover image of a book. A book has at most one
// cover; re-uploading replaces the bytes and the version used to break caches.
func (s *Store) SetBookCover(ctx context.Context, cover BookCover) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO book_covers (notebook_id, content_type, image, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (notebook_id) DO UPDATE SET
			content_type = excluded.content_type,
			image = excluded.image,
			updated_at = excluded.updated_at`,
		cover.NotebookID, cover.ContentType, cover.Image, ts(cover.UpdatedAt))
	if err != nil {
		return fmt.Errorf("store: set book cover: %w", err)
	}
	return nil
}

// GetBookCover returns the cover of a book.
func (s *Store) GetBookCover(ctx context.Context, notebookID string) (BookCover, error) {
	var cover BookCover
	var updated string
	err := s.db.QueryRowContext(ctx, `
		SELECT notebook_id, content_type, image, updated_at
		FROM book_covers WHERE notebook_id = ?`, notebookID).
		Scan(&cover.NotebookID, &cover.ContentType, &cover.Image, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return BookCover{}, ErrNotFound
	}
	if err != nil {
		return BookCover{}, fmt.Errorf("store: get book cover: %w", err)
	}
	cover.UpdatedAt = parseTS(updated)
	return cover, nil
}

// DeleteBookCover removes the cover of a book. Deleting a missing cover is a
// no-op so the endpoint is idempotent.
func (s *Store) DeleteBookCover(ctx context.Context, notebookID string) error {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM book_covers WHERE notebook_id = ?`, notebookID); err != nil {
		return fmt.Errorf("store: delete book cover: %w", err)
	}
	return nil
}
