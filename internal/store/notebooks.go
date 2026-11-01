package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/preview"
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
	// ErrNotebookNotEmpty is returned when a notebook with live entries is
	// turned into a book.
	ErrNotebookNotEmpty = errors.New("store: caderno com notas")
	// ErrBookHasChapters is returned when a book with chapters is turned back
	// into a regular notebook without confirmation.
	ErrBookHasChapters = errors.New("store: livro com capitulos")
	// ErrConfirmRequired is returned when a destructive book action is missing
	// the title confirmation.
	ErrConfirmRequired = errors.New("store: confirmacao obrigatoria")
	// ErrNotABook is returned when a chapter operation is used outside a book.
	ErrNotABook = errors.New("store: caderno nao e um livro")
	// ErrInvalidChapter is returned for a chapter kind or position outside the
	// contract.
	ErrInvalidChapter = errors.New("store: capitulo invalido")
	// ErrChapterNotInBook is returned when a reorder list has an id that does
	// not belong to the book.
	ErrChapterNotInBook = errors.New("store: capitulo nao pertence ao livro")
	// ErrNotABookEntry is returned when a book chapter is archived: a book uses
	// the chapter status, not the diary archive.
	ErrNotABookEntry = errors.New("store: capitulo nao pode ser arquivado")
)

// NotebookCountError carries how many entries blocked an activation or
// conversion. The caller reports the count to the client.
type NotebookCountError struct {
	Err   error
	Count int
}

func (e *NotebookCountError) Error() string {
	return fmt.Sprintf("%s (%d)", e.Err.Error(), e.Count)
}

func (e *NotebookCountError) Unwrap() error { return e.Err }

const notebookSelect = `
	SELECT n.id, n.name, COALESCE(n.color, ''), n.is_default,
		COALESCE(n.kind, 'notes'), COALESCE(n.subtitle, ''), COALESCE(n.author, ''),
		COALESCE(n.synopsis, ''), COALESCE(n.language, ''), COALESCE(n.goal_words, 0),
		COALESCE(n.book_status, 'drafting'), n.created_at, n.updated_at,
		(SELECT COUNT(*) FROM entries e
		 WHERE e.notebook_id = n.id AND e.deleted_at IS NULL
		   AND (e.archived = 0 OR n.kind = 'book')),
		(SELECT MAX(COALESCE(e.recorded_at, e.created_at)) FROM entries e
		 WHERE e.notebook_id = n.id AND e.deleted_at IS NULL
		   AND (e.archived = 0 OR n.kind = 'book'))
	FROM notebooks n`

func (s *Store) scanNotebook(scanner interface{ Scan(...any) error }) (Notebook, error) {
	var n Notebook
	var isDefault int
	var createdAt, updatedAt string
	var lastEntryAt sql.NullString
	if err := scanner.Scan(&n.ID, &n.Name, &n.Color, &isDefault, &n.Kind,
		&n.Subtitle, &n.Author, &n.Synopsis, &n.Language, &n.GoalWords, &n.BookStatus,
		&createdAt, &updatedAt, &n.EntryCount, &lastEntryAt); err != nil {
		return Notebook{}, err
	}
	n.IsDefault = isDefault != 0
	n.CreatedAt = parseTS(createdAt)
	n.UpdatedAt = parseTS(updatedAt)
	if lastEntryAt.Valid {
		t := parseTS(lastEntryAt.String)
		n.LastEntryAt = &t
	}
	if n.IsBook() {
		n.ChapterCount = n.EntryCount
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

// CreateNotebook inserts a user-created notebook. A book is born empty, so the
// activation rule (no live entries) is satisfied by construction.
func (s *Store) CreateNotebook(ctx context.Context, n Notebook) error {
	name := strings.TrimSpace(n.Name)
	if name == "" {
		return fmt.Errorf("store: create notebook: nome vazio")
	}
	kind := strings.TrimSpace(n.Kind)
	if kind == "" {
		kind = NotebookKindNotes
	}
	if !ValidNotebookKind(kind) {
		return fmt.Errorf("store: create notebook: kind invalido %q", kind)
	}
	if kind == NotebookKindBook && n.ID == DefaultNotebookID {
		return ErrProtected
	}
	status := strings.TrimSpace(n.BookStatus)
	if status == "" {
		status = BookDrafting
	}
	if kind == NotebookKindNotes {
		status = BookDrafting
	}
	if !ValidBookStatus(status) {
		return fmt.Errorf("store: create notebook: status invalido %q", status)
	}
	if n.GoalWords < 0 {
		return fmt.Errorf("store: create notebook: meta negativa")
	}
	if err := s.notebookNameTaken(ctx, name, ""); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO notebooks (id, name, color, is_default, kind, subtitle, author,
			synopsis, language, goal_words, book_status, created_at, updated_at)
		VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		n.ID, name, strings.TrimSpace(n.Color), kind, strings.TrimSpace(n.Subtitle),
		strings.TrimSpace(n.Author), strings.TrimSpace(n.Synopsis), strings.TrimSpace(n.Language),
		n.GoalWords, status, ts(n.CreatedAt), ts(n.UpdatedAt))
	if err != nil {
		return fmt.Errorf("store: create notebook: %w", err)
	}
	return nil
}

// CreateBook is CreateNotebook fixed to the book kind.
func (s *Store) CreateBook(ctx context.Context, n Notebook) error {
	n.Kind = NotebookKindBook
	return s.CreateNotebook(ctx, n)
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

// BookMeta is the writable metadata of a book.
type BookMeta struct {
	Subtitle   string
	Author     string
	Synopsis   string
	Language   string
	GoalWords  int
	BookStatus string
}

// UpdateBookMeta writes the book metadata. Only a book accepts it.
func (s *Store) UpdateBookMeta(ctx context.Context, id string, meta BookMeta) (Notebook, error) {
	current, err := s.GetNotebook(ctx, id)
	if err != nil {
		return Notebook{}, err
	}
	if !current.IsBook() {
		return Notebook{}, ErrNotABook
	}
	if meta.GoalWords < 0 {
		return Notebook{}, fmt.Errorf("store: update book: meta negativa")
	}
	status := strings.TrimSpace(meta.BookStatus)
	if status == "" {
		status = current.BookStatus
	}
	if !ValidBookStatus(status) {
		return Notebook{}, fmt.Errorf("store: update book: status invalido %q", status)
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE notebooks SET subtitle = ?, author = ?, synopsis = ?, language = ?,
			goal_words = ?, book_status = ?, updated_at = ?
		WHERE id = ?`,
		strings.TrimSpace(meta.Subtitle), strings.TrimSpace(meta.Author),
		strings.TrimSpace(meta.Synopsis), strings.TrimSpace(meta.Language),
		meta.GoalWords, status, ts(time.Now().UTC()), id)
	if err != nil {
		return Notebook{}, fmt.Errorf("store: update book: %w", err)
	}
	return s.GetNotebook(ctx, id)
}

// SetNotebookKind turns a notebook into a book and back. Activating requires an
// empty notebook: a page already used for notes keeps its notes and is not
// silently converted. Deactivating requires an empty book unless the caller
// confirms the conversion, which keeps the chapter texts as regular notes and
// drops only the book structure.
func (s *Store) SetNotebookKind(ctx context.Context, id, kind string, confirmConvert bool) (Notebook, error) {
	kind = strings.TrimSpace(kind)
	if !ValidNotebookKind(kind) {
		return Notebook{}, fmt.Errorf("store: set notebook kind: kind invalido %q", kind)
	}
	current, err := s.GetNotebook(ctx, id)
	if err != nil {
		return Notebook{}, err
	}
	if current.Kind == kind {
		return current, nil
	}
	if current.IsDefault {
		return Notebook{}, ErrProtected
	}
	now := ts(time.Now().UTC())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Notebook{}, fmt.Errorf("store: set notebook kind: %w", err)
	}
	defer tx.Rollback()

	if kind == NotebookKindBook {
		var live int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM entries WHERE notebook_id = ? AND deleted_at IS NULL`,
			id).Scan(&live); err != nil {
			return Notebook{}, fmt.Errorf("store: set notebook kind: %w", err)
		}
		if live > 0 {
			return Notebook{}, &NotebookCountError{Err: ErrNotebookNotEmpty, Count: live}
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE notebooks SET kind = ?, updated_at = ? WHERE id = ?`,
			NotebookKindBook, now, id); err != nil {
			return Notebook{}, fmt.Errorf("store: set notebook kind: %w", err)
		}
	} else {
		var chapters int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM entries WHERE notebook_id = ? AND deleted_at IS NULL`,
			id).Scan(&chapters); err != nil {
			return Notebook{}, fmt.Errorf("store: set notebook kind: %w", err)
		}
		if chapters > 0 && !confirmConvert {
			return Notebook{}, &NotebookCountError{Err: ErrBookHasChapters, Count: chapters}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE entries SET chapter_kind = '', chapter_position = NULL,
				chapter_status = '', chapter_goal_words = 0, chapter_synopsis = '',
				updated_at = ?
			WHERE notebook_id = ?`, now, id); err != nil {
			return Notebook{}, fmt.Errorf("store: convert book: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE notebooks SET kind = ?, subtitle = '', author = '', synopsis = '',
				language = '', goal_words = 0, book_status = ?, updated_at = ?
			WHERE id = ?`, NotebookKindNotes, BookDrafting, now, id); err != nil {
			return Notebook{}, fmt.Errorf("store: convert book: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Notebook{}, fmt.Errorf("store: set notebook kind: %w", err)
	}
	return s.GetNotebook(ctx, id)
}

// BookWordCounts sums the prose word count of the live chapters of every book.
// It is computed from markdown with the same conversion the preview uses, so
// the book home and the analysis agree on what a word is.
func (s *Store) BookWordCounts(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT e.notebook_id,
			COALESCE((SELECT n.content_markdown FROM notes n WHERE n.entry_id = e.id
				ORDER BY n.created_at DESC LIMIT 1), '')
		FROM entries e
		JOIN notebooks b ON b.id = e.notebook_id AND b.kind = 'book'
		WHERE e.deleted_at IS NULL
		ORDER BY e.notebook_id, e.chapter_position, e.id`)
	if err != nil {
		return nil, fmt.Errorf("store: book word counts: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var notebookID, markdown string
		if err := rows.Scan(&notebookID, &markdown); err != nil {
			return nil, fmt.Errorf("store: scan book word: %w", err)
		}
		out[notebookID] += len(strings.Fields(preview.Plain(markdown)))
	}
	return out, rows.Err()
}

// DeleteBook deletes a book after the caller confirms its title. Live chapters
// go to the trash with their tombstones in the same transaction; nothing is
// dumped into the default notebook. The notebook tombstone is written too.
func (s *Store) DeleteBook(ctx context.Context, id, confirmName string) error {
	current, err := s.GetNotebook(ctx, id)
	if err != nil {
		return err
	}
	if current.IsDefault {
		return ErrProtected
	}
	if !current.IsBook() {
		return ErrNotABook
	}
	if strings.TrimSpace(confirmName) != current.Name {
		return ErrConfirmRequired
	}
	stamp := ts(time.Now().UTC())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: delete book: %w", err)
	}
	defer tx.Rollback()

	// Capitulos que ja estavam na lixeira tambem apontam para o caderno; a FK
	// restritiva impede remover o livro enquanto sobrar qualquer referencia.
	if _, err := tx.ExecContext(ctx, `
		UPDATE entries SET notebook_id = ?, chapter_kind = '', chapter_position = NULL,
			chapter_status = '', chapter_goal_words = 0, chapter_synopsis = ''
		WHERE notebook_id = ? AND deleted_at IS NOT NULL`, DefaultNotebookID, id); err != nil {
		return fmt.Errorf("store: delete book: %w", err)
	}
	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM entries WHERE notebook_id = ? AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("store: delete book: %w", err)
	}
	var entryIDs []string
	for rows.Next() {
		var entryID string
		if err := rows.Scan(&entryID); err != nil {
			rows.Close()
			return fmt.Errorf("store: delete book: %w", err)
		}
		entryIDs = append(entryIDs, entryID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("store: delete book: %w", err)
	}
	for _, entryID := range entryIDs {
		// A lixeira nao pode guardar uma referencia para um caderno que deixa de
		// existir (a FK e restritiva). A nota vai para o caderno padrao e perde
		// a estrutura do livro; restaure devolve uma nota comum, nunca um
		// capitulo orfao.
		if _, err := tx.ExecContext(ctx, `
			UPDATE entries SET deleted_at = ?, status = ?, notebook_id = ?,
				chapter_kind = '', chapter_position = NULL, chapter_status = '',
				chapter_goal_words = 0, chapter_synopsis = '', updated_at = ?
			WHERE id = ? AND deleted_at IS NULL`,
			stamp, EntryDeleted, DefaultNotebookID, stamp, entryID); err != nil {
			return fmt.Errorf("store: trash book chapter: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tombstones (id, kind, deleted_at, origin)
			VALUES (?, ?, ?, 'server')
			ON CONFLICT (id, kind) DO UPDATE SET
				deleted_at = excluded.deleted_at,
				origin = excluded.origin
			WHERE excluded.deleted_at >= tombstones.deleted_at`,
			entryID, TombstoneEntry, stamp); err != nil {
			return fmt.Errorf("store: gravar tombstone do capitulo: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM notebooks WHERE id = ?`, id); err != nil {
		return fmt.Errorf("store: delete book: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO tombstones (id, kind, deleted_at, origin)
		VALUES (?, ?, ?, 'server')
		ON CONFLICT (id, kind) DO UPDATE SET
			deleted_at = excluded.deleted_at,
			origin = excluded.origin
		WHERE excluded.deleted_at >= tombstones.deleted_at`,
		id, TombstoneNotebook, stamp); err != nil {
		return fmt.Errorf("store: delete book: %w", err)
	}
	return tx.Commit()
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
	// O caderno sai da tabela, mas a exclusao fica provada para sempre: um
	// ambiente offline ha mais tempo que a retencao ainda precisa saber que ele
	// deixou de existir.
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO tombstones (id, kind, deleted_at, origin)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (id, kind) DO UPDATE SET
			deleted_at = excluded.deleted_at,
			origin = excluded.origin
		WHERE excluded.deleted_at >= tombstones.deleted_at`,
		id, TombstoneNotebook, ts(time.Now().UTC()), "server"); err != nil {
		return fmt.Errorf("store: delete notebook: %w", err)
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
