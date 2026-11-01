package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/hlc"
)

// Campo editavel da nota, usado para dizer qual lado brigou num conflito.
const (
	FieldTitle      = "title"
	FieldRecordedAt = "recorded_at"
	FieldBody       = "body"
)

// versionNow is the current version stamp of a field, issued by the hybrid
// logical clock: strictly increasing, so two writes in the same millisecond are
// still ordered.
func (s *Store) versionNow() string {
	return s.clock.Now().String()
}

// versionAfter reports whether `stored` is newer than the version the client last
// read. An empty client version means "I never read it", which never conflicts
// (legacy clients keep working with plain last-write-wins).
func versionAfter(stored, clientRead string) bool {
	clientRead = strings.TrimSpace(clientRead)
	if clientRead == "" || strings.TrimSpace(stored) == "" {
		return false
	}
	return hlc.After(stored, clientRead)
}

// EntryFieldVersions returns the current versions of an entry's editable fields.
func (s *Store) EntryFieldVersions(ctx context.Context, id string) (title, recordedAt string, err error) {
	var t, r sql.NullString
	err = s.db.QueryRowContext(ctx,
		`SELECT title_updated_at, recorded_at_updated_at FROM entries WHERE id = ?`, id).Scan(&t, &r)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("store: entry field versions: %w", err)
	}
	return t.String, r.String, nil
}

// UpdateEntryFields writes the editable fields of an entry, each with its own
// version. It returns the versions after the write and the names of the fields
// that had already changed since the client read them: those are NOT applied, so
// the caller can ask the user whose version wins instead of silently losing one.
func (s *Store) UpdateEntryFields(ctx context.Context, id string, title *string, recordedAt *time.Time, notebookID *string, archived *bool, author *string, chapterKind *string, readTitle, readRecorded string) (map[string]string, []string, error) {
	var storedTitle, storedRecorded, storedNotebook, storedAuthor, storedChapterKind string
	var storedRecordedRaw sql.NullString
	var storedChapterPosition sql.NullFloat64
	var storedArchived int
	var storedTitleVersion, storedRecordedVersion sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(title,''), recorded_at, COALESCE(notebook_id,''), archived, COALESCE(author,''),
			title_updated_at, recorded_at_updated_at, COALESCE(chapter_kind,''), chapter_position
		FROM entries WHERE id = ?`, id).Scan(
		&storedTitle, &storedRecordedRaw, &storedNotebook, &storedArchived, &storedAuthor,
		&storedTitleVersion, &storedRecordedVersion, &storedChapterKind, &storedChapterPosition)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("store: entry field versions: %w", err)
	}
	storedRecorded = storedRecordedRaw.String
	nextNotebook := storedNotebook
	if notebookID != nil {
		nextNotebook = strings.TrimSpace(*notebookID)
		if err := s.NotebookExists(ctx, nextNotebook); err != nil {
			return nil, nil, err
		}
	}
	targetBook, err := s.NotebookIsBook(ctx, nextNotebook)
	if err != nil {
		return nil, nil, err
	}
	sourceBook, err := s.NotebookIsBook(ctx, storedNotebook)
	if err != nil {
		return nil, nil, err
	}
	// O livro usa o status do capitulo, nao a lixeira de trabalho do diario.
	if targetBook && archived != nil && *archived != (storedArchived != 0) {
		return nil, nil, ErrNotABookEntry
	}
	var nextChapterKind string
	if chapterKind != nil {
		if !targetBook {
			return nil, nil, ErrNotABook
		}
		nextChapterKind = strings.TrimSpace(*chapterKind)
		if !ValidChapterKind(nextChapterKind) {
			return nil, nil, ErrInvalidChapter
		}
	} else if storedChapterKind != "" {
		nextChapterKind = storedChapterKind
	}
	var nextAuthor string
	if author != nil {
		nextAuthor = strings.TrimSpace(*author)
		if !ValidAuthor(nextAuthor) {
			return nil, nil, ErrInvalidAuthor
		}
	}
	var conflict []string
	versions := map[string]string{FieldTitle: storedTitleVersion.String, FieldRecordedAt: storedRecordedVersion.String}

	if title != nil && versionAfter(storedTitleVersion.String, readTitle) {
		conflict = append(conflict, FieldTitle)
	}
	if recordedAt != nil && versionAfter(storedRecordedVersion.String, readRecorded) {
		conflict = append(conflict, FieldRecordedAt)
	}
	if len(conflict) > 0 {
		return versions, conflict, nil
	}

	// Nao regrave um campo com o mesmo valor: cada gravacao subiria a versao e
	// faria outro cliente levar 409 sem que nada tivesse mudado.
	writeTitle := title != nil && *title != storedTitle
	writeRecorded := recordedAt != nil && ts(*recordedAt) != storedRecorded
	writeNotebook := notebookID != nil && strings.TrimSpace(*notebookID) != storedNotebook
	writeChapterKind := chapterKind != nil && nextChapterKind != storedChapterKind
	// Um capitulo nunca fica arquivado no livro: mover para la limpa o
	// arquivamento, e o status do capitulo e o que organiza o trabalho.
	writeArchived := archived != nil && boolInt(*archived) != storedArchived
	if targetBook && storedArchived != 0 {
		writeArchived = true
	}
	writeAuthor := author != nil && nextAuthor != storedAuthor
	if !writeTitle && !writeRecorded && !writeNotebook && !writeArchived &&
		!writeAuthor && !writeChapterKind {
		return versions, nil, nil
	}

	var nextPosition float64
	if writeNotebook && targetBook && !sourceBook {
		// Mover uma nota comum para um livro: a entrada passa a ser o ultimo
		// capitulo, como o app faz ao criar.
		nextPosition, err = s.NextChapterPosition(ctx, nextNotebook)
		if err != nil {
			return nil, nil, err
		}
	}
	stamp := s.versionNow()
	updatedAt := ts(time.Now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("store: update entry fields: %w", err)
	}
	defer tx.Rollback()

	if writeTitle {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET title = ?, title_updated_at = ?, updated_at = ? WHERE id = ?`,
			*title, stamp, updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update title: %w", err)
		}
		versions[FieldTitle] = stamp
	}
	if writeRecorded {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET recorded_at = ?, recorded_at_updated_at = ?, updated_at = ? WHERE id = ?`,
			ts(*recordedAt), stamp, updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update recorded_at: %w", err)
		}
		versions[FieldRecordedAt] = stamp
	}
	// Caderno e um ponteiro, nao texto: nao tem versao nem conflito. Mover a
	// nota no celular e no desktop ao mesmo tempo e raro; a ultima gravacao vence.
	if writeNotebook {
		switch {
		case targetBook && !sourceBook:
			kind := nextChapterKind
			if kind == "" {
				kind = ChapterKindChapter
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE entries SET notebook_id = ?, archived = 0, chapter_kind = ?,
					chapter_position = ?, chapter_status = ?, updated_at = ?
				WHERE id = ?`,
				nextNotebook, kind, nextPosition, ChapterDraft, updatedAt, id); err != nil {
				return nil, nil, fmt.Errorf("store: update notebook: %w", err)
			}
		case targetBook && sourceBook:
			if _, err := tx.ExecContext(ctx,
				`UPDATE entries SET notebook_id = ?, archived = 0, updated_at = ? WHERE id = ?`,
				nextNotebook, updatedAt, id); err != nil {
				return nil, nil, fmt.Errorf("store: update notebook: %w", err)
			}
		default:
			if _, err := tx.ExecContext(ctx, `
				UPDATE entries SET notebook_id = ?, chapter_kind = '',
					chapter_position = NULL, chapter_status = '', chapter_goal_words = 0,
					chapter_synopsis = '', updated_at = ?
				WHERE id = ?`, nextNotebook, updatedAt, id); err != nil {
				return nil, nil, fmt.Errorf("store: update notebook: %w", err)
			}
		}
	}
	if writeChapterKind {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET chapter_kind = ?, updated_at = ? WHERE id = ?`,
			nextChapterKind, updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update chapter kind: %w", err)
		}
	}
	// Arquivar e um interruptor, nao texto: nao tem versao nem conflito. Quem
	// arrived depois manda, e o estado e o mesmo nos dois lugares.
	if writeArchived {
		value := 0
		if archived != nil && *archived {
			value = 1
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET archived = ?, updated_at = ? WHERE id = ?`,
			value, updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update archived: %w", err)
		}
	}
	// Autor e um papel, nao texto livre: a ultima escolha vence. A nota pode
	// voltar ao padrao mandando author vazio.
	if writeAuthor {
		if _, err := tx.ExecContext(ctx,
			`UPDATE entries SET author = ?, updated_at = ? WHERE id = ?`,
			nextAuthor, updatedAt, id); err != nil {
			return nil, nil, fmt.Errorf("store: update author: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, fmt.Errorf("store: update entry fields: %w", err)
	}
	return versions, nil, nil
}

// NoteFieldVersion returns the current version of a note body.
func (s *Store) NoteFieldVersion(ctx context.Context, id string) (string, error) {
	var version sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT body_updated_at FROM notes WHERE id = ?`, id).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("store: note field version: %w", err)
	}
	return version.String, nil
}
