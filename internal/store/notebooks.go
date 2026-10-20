package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// DefaultNotebookID is the fixed id of the catch-all notebook. It is created by
// migration 0017 and cannot be renamed or deleted.
const DefaultNotebookID = "notas-ao-acaso"

// DefaultNotebookName is the visible name of the catch-all notebook.
const DefaultNotebookName = "Notas ao acaso"

var (
	// ErrProtected is returned when someone tries to change the default notebook.
	ErrProtected = errors.New("store: registro protegido")
	// ErrNotebookExists is returned when a notebook name is already in use.
	ErrNotebookExists = errors.New("store: caderno ja existe")
	// ErrNotebookNotFound is returned when a note points at an unknown notebook.
	ErrNotebookNotFound = errors.New("store: caderno inexistente")
)

const notebookSelect = `
	SELECT n.id, n.name, COALESCE(n.color, ''), n.is_default, n.created_at, n.updated_at,
		(SELECT COUNT(*) FROM entries e
		 WHERE e.notebook_id = n.id AND e.deleted_at IS NULL AND e.archived = 0),
		(SELECT MAX(COALESCE(e.recorded_at, e.created_at)) FROM entries e
		 WHERE e.notebook_id = n.id AND e.deleted_at IS NULL AND e.archived = 0)
	FROM notebooks n`

func (s *Store) scanNotebook(scanner interface{ Scan(...any) error }) (Notebook, error) {
	var n Notebook
	var isDefault int
	var createdAt, updatedAt string
	var lastEntryAt sql.NullString
	if err := scanner.Scan(&n.ID, &n.Name, &n.Color, &isDefault, &createdAt, &updatedAt,
		&n.EntryCount, &lastEntryAt); err != nil {
		return Notebook{}, err
	}
	n.IsDefault = isDefault != 0
	n.CreatedAt = parseTS(createdAt)
	n.UpdatedAt = parseTS(updatedAt)
	if lastEntryAt.Valid {
		t := parseTS(lastEntryAt.String)
		n.LastEntryAt = &t
	}
	return n, nil
}

// ListNotebooks returns notebooks in creation order, with the default notebook
// last. Counts and last dates only consider active notes.
func (s *Store) ListNotebooks(ctx context.Context) ([]Notebook, error) {
	rows, err := s.db.QueryContext(ctx, notebookSelect+`
		ORDER BY n.is_default ASC, n.created_at ASC, n.id ASC`)
	if err != nil {
		return nil, fmt.Errorf("store: list notebooks: %w", err)
	}
	defer rows.Close()
	var out []Notebook
	for rows.Next() {
		n, err := s.scanNotebook(rows)
		if err != nil {
			return nil, fmt.Errorf("store: scan notebook: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// GetNotebook returns one notebook.
func (s *Store) GetNotebook(ctx context.Context, id string) (Notebook, error) {
	n, err := s.scanNotebook(s.db.QueryRowContext(ctx, notebookSelect+` WHERE n.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Notebook{}, ErrNotFound
	}
	if err != nil {
		return Notebook{}, fmt.Errorf("store: get notebook: %w", err)
	}
	return n, nil
}

// CreateNotebook inserts a user-created notebook.
func (s *Store) CreateNotebook(ctx context.Context, n Notebook) error {
	name := strings.TrimSpace(n.Name)
	if name == "" {
		return fmt.Errorf("store: create notebook: nome vazio")
	}
	if err := s.notebookNameTaken(ctx, name, ""); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO notebooks (id, name, color, is_default, created_at, updated_at)
		VALUES (?, ?, ?, 0, ?, ?)`,
		n.ID, name, strings.TrimSpace(n.Color), ts(n.CreatedAt), ts(n.UpdatedAt))
	if err != nil {
		return fmt.Errorf("store: create notebook: %w", err)
	}
	return nil
}

// UpdateNotebook renames and/or recolors a notebook. The default notebook is
// protected.
func (s *Store) UpdateNotebook(ctx context.Context, id string, name, color *string) (Notebook, error) {
	current, err := s.GetNotebook(ctx, id)
	if err != nil {
		return Notebook{}, err
	}
	if current.IsDefault {
		return Notebook{}, ErrProtected
	}
	newName := current.Name
	if name != nil {
		newName = strings.TrimSpace(*name)
		if newName == "" {
			return Notebook{}, fmt.Errorf("store: update notebook: nome vazio")
		}
		if err := s.notebookNameTaken(ctx, newName, id); err != nil {
			return Notebook{}, err
		}
	}
	newColor := current.Color
	if color != nil {
		newColor = strings.TrimSpace(*color)
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE notebooks SET name = ?, color = ?, updated_at = ? WHERE id = ?`,
		newName, newColor, ts(time.Now().UTC()), id)
	if err != nil {
		return Notebook{}, fmt.Errorf("store: update notebook: %w", err)
	}
	return s.GetNotebook(ctx, id)
}

// DeleteNotebook removes a notebook and moves its notes to the default
// notebook. The default notebook cannot be deleted.
func (s *Store) DeleteNotebook(ctx context.Context, id string) error {
	current, err := s.GetNotebook(ctx, id)
	if err != nil {
		return err
	}
	if current.IsDefault {
		return ErrProtected
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: delete notebook: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`UPDATE entries SET notebook_id = ?, updated_at = ? WHERE notebook_id = ?`,
		DefaultNotebookID, ts(time.Now().UTC()), id); err != nil {
		return fmt.Errorf("store: move notebook notes: %w", err)
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM notebooks WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("store: delete notebook: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// NotebookExists reports whether a notebook id is valid.
func (s *Store) NotebookExists(ctx context.Context, id string) error {
	var one int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM notebooks WHERE id = ?`, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotebookNotFound
	}
	if err != nil {
		return fmt.Errorf("store: notebook exists: %w", err)
	}
	return nil
}

func (s *Store) notebookNameTaken(ctx context.Context, name, exceptID string) error {
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM notebooks WHERE lower(name) = lower(?) AND id <> ? LIMIT 1`,
		name, exceptID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("store: notebook name: %w", err)
	}
	return ErrNotebookExists
}
