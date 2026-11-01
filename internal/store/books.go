package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// ChapterOrder is one row of an atomic chapter reorder. The client sends the
// whole live list, because dragging a chapter changes the position of many.
type ChapterOrder struct {
	EntryID       string
	ChapterKind   string
	ChapterStatus string
	Position      float64
}

// NextChapterPosition returns the position a chapter appended to the end of the
// book gets. Positions are spaced by 1024 so a later drag can insert between
// two chapters without renumbering everything.
func (s *Store) NextChapterPosition(ctx context.Context, notebookID string) (float64, error) {
	var max sql.NullFloat64
	err := s.db.QueryRowContext(ctx, `
		SELECT MAX(chapter_position) FROM entries
		WHERE notebook_id = ? AND deleted_at IS NULL AND chapter_kind <> ''`,
		notebookID).Scan(&max)
	if err != nil {
		return 0, fmt.Errorf("store: next chapter position: %w", err)
	}
	if !max.Valid {
		return 1024, nil
	}
	return max.Float64 + 1024, nil
}

// ReorderChapters rewrites the order and kind of every live chapter of a book.
// The submitted list must contain exactly the live chapters: a partial list
// would leave chapters without a position, and an id from another book would
// move a note across notebooks.
func (s *Store) ReorderChapters(ctx context.Context, notebookID string, chapters []ChapterOrder) error {
	book, err := s.GetNotebook(ctx, notebookID)
	if err != nil {
		return err
	}
	if !book.IsBook() {
		return ErrNotABook
	}
	live, err := s.liveChapterIDs(ctx, notebookID)
	if err != nil {
		return err
	}
	if len(chapters) != len(live) {
		return ErrChapterNotInBook
	}
	seen := make(map[string]bool, len(chapters))
	for _, chapter := range chapters {
		id := strings.TrimSpace(chapter.EntryID)
		if !live[id] || seen[id] {
			return ErrChapterNotInBook
		}
		if !ValidChapterKind(chapter.ChapterKind) {
			return ErrInvalidChapter
		}
		if !ValidChapterStatus(chapter.ChapterStatus) {
			return ErrInvalidChapter
		}
		if math.IsNaN(chapter.Position) || math.IsInf(chapter.Position, 0) {
			return ErrInvalidChapter
		}
		seen[id] = true
	}

	now := ts(time.Now().UTC())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: reorder chapters: %w", err)
	}
	defer tx.Rollback()
	for _, chapter := range chapters {
		kind := strings.TrimSpace(chapter.ChapterKind)
		status := strings.TrimSpace(chapter.ChapterStatus)
		if status == "" {
			status = ChapterDraft
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE entries SET chapter_kind = ?, chapter_position = ?,
				chapter_status = ?, updated_at = ?
			WHERE id = ? AND notebook_id = ? AND deleted_at IS NULL`,
			kind, chapter.Position, status, now, strings.TrimSpace(chapter.EntryID), notebookID)
		if err != nil {
			return fmt.Errorf("store: reorder chapters: %w", err)
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrChapterNotInBook
		}
	}
	return tx.Commit()
}

func (s *Store) liveChapterIDs(ctx context.Context, notebookID string) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id FROM entries
		WHERE notebook_id = ? AND deleted_at IS NULL AND chapter_kind <> ''`,
		notebookID)
	if err != nil {
		return nil, fmt.Errorf("store: live chapters: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("store: scan chapter: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// SetEntryChapterKind changes the structural kind of one chapter. Position and
// order stay untouched; the list reorder owns those.
func (s *Store) SetEntryChapterKind(ctx context.Context, entryID, kind string) error {
	kind = strings.TrimSpace(kind)
	if !ValidChapterKind(kind) {
		return ErrInvalidChapter
	}
	entry, err := s.GetEntry(ctx, entryID)
	if err != nil {
		return err
	}
	book, err := s.GetNotebook(ctx, entry.NotebookID)
	if err != nil {
		return err
	}
	if !book.IsBook() {
		return ErrNotABook
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE entries SET chapter_kind = ?, updated_at = ? WHERE id = ?`,
		kind, ts(time.Now().UTC()), entryID)
	if err != nil {
		return fmt.Errorf("store: set chapter kind: %w", err)
	}
	return nil
}

// UpdateChapterMeta writes the optional chapter fields shown in the panel.
func (s *Store) UpdateChapterMeta(ctx context.Context, entryID string, status *string, goalWords *int, synopsis *string) error {
	entry, err := s.GetEntry(ctx, entryID)
	if err != nil {
		return err
	}
	book, err := s.GetNotebook(ctx, entry.NotebookID)
	if err != nil {
		return err
	}
	if !book.IsBook() {
		return ErrNotABook
	}
	nextStatus := entry.ChapterStatus
	if status != nil {
		nextStatus = strings.TrimSpace(*status)
		if nextStatus == "" {
			nextStatus = ChapterDraft
		}
	}
	if !ValidChapterStatus(nextStatus) {
		return ErrInvalidChapter
	}
	nextGoal := entry.ChapterGoalWords
	if goalWords != nil {
		if *goalWords < 0 {
			return ErrInvalidChapter
		}
		nextGoal = *goalWords
	}
	nextSynopsis := entry.ChapterSynopsis
	if synopsis != nil {
		nextSynopsis = strings.TrimSpace(*synopsis)
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE entries SET chapter_status = ?, chapter_goal_words = ?,
			chapter_synopsis = ?, updated_at = ?
		WHERE id = ?`,
		nextStatus, nextGoal, nextSynopsis, ts(time.Now().UTC()), entryID)
	if err != nil {
		return fmt.Errorf("store: update chapter meta: %w", err)
	}
	return nil
}

// NormalizeEntryNotebook moves an entry between a book and a notes notebook,
// keeping the chapter fields consistent with the destination. A chapter moved
// to a book goes to the end and is never archived; a chapter moved to a notes
// notebook loses its structure.
func (s *Store) NormalizeEntryNotebook(ctx context.Context, entryID, targetNotebookID string) error {
	target, err := s.GetNotebook(ctx, strings.TrimSpace(targetNotebookID))
	if err != nil {
		return err
	}
	if !target.IsBook() {
		_, err := s.db.ExecContext(ctx, `
			UPDATE entries SET notebook_id = ?, chapter_kind = '', chapter_position = NULL,
				chapter_status = '', chapter_goal_words = 0, chapter_synopsis = '',
				updated_at = ?
			WHERE id = ?`, target.ID, ts(time.Now().UTC()), entryID)
		if err != nil {
			return fmt.Errorf("store: move entry to notes: %w", err)
		}
		return nil
	}
	position, err := s.NextChapterPosition(ctx, target.ID)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE entries SET notebook_id = ?, archived = 0, chapter_kind = ?,
			chapter_position = ?, chapter_status = ?, updated_at = ?
		WHERE id = ?`, target.ID, ChapterKindChapter, position, ChapterDraft,
		ts(time.Now().UTC()), entryID)
	if err != nil {
		return fmt.Errorf("store: move entry to book: %w", err)
	}
	return nil
}

// NotebookIsBook reports whether the notebook is a book. ErrNotebookNotFound is
// returned when it does not exist.
func (s *Store) NotebookIsBook(ctx context.Context, id string) (bool, error) {
	var kind string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(kind, 'notes') FROM notebooks WHERE id = ?`, id).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotebookNotFound
	}
	if err != nil {
		return false, fmt.Errorf("store: notebook kind: %w", err)
	}
	return kind == NotebookKindBook, nil
}
