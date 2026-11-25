package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// O trabalho de um agente numa pasta vira uma entry por (maquina, caminho) no
// caderno do MCP e uma nota por sessao. A entry e o projeto; nada aqui cria
// tabela nova: o estado da sessao mora no proprio corpo da nota.

// projectEntrySelect le so os campos que o servidor MCP usa para reconhecer um
// projeto. A leitura completa de uma entry nao e necessaria e carrega preview e
// versoes que nao interessam aqui.
const projectEntrySelect = `
	SELECT e.id, COALESCE(e.title,''), e.status, e.source, COALESCE(e.notebook_id,''),
		COALESCE(e.origin_instance,''), COALESCE(e.origin_kind,''),
		COALESCE(e.summary_detail,'concise'), e.recorded_at,
		e.created_at, e.updated_at
	FROM entries e`

func scanProjectEntry(row rowScanner) (Entry, error) {
	var e Entry
	var recordedAt sql.NullString
	var createdAt, updatedAt string
	if err := row.Scan(&e.ID, &e.Title, &e.Status, &e.Source, &e.NotebookID,
		&e.OriginInstance, &e.OriginKind, &e.SummaryDetail, &recordedAt,
		&createdAt, &updatedAt); err != nil {
		return Entry{}, err
	}
	if recordedAt.Valid {
		t := parseTS(recordedAt.String)
		e.RecordedAt = &t
	}
	e.CreatedAt = parseTS(createdAt)
	e.UpdatedAt = parseTS(updatedAt)
	return e, nil
}

// FindProjectEntry returns the project entry of one (machine, path) pair in a
// notebook. The path is the entry title and is compared case-insensitively
// because the same folder can arrive with different capitalization; the machine
// is compared exactly, because two computers with the same path are two
// projects. The boolean reports whether one was found.
func (s *Store) FindProjectEntry(ctx context.Context, notebookID, path, machine string) (Entry, bool, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return Entry{}, false, fmt.Errorf("store: projeto sem caminho")
	}
	entry, err := scanProjectEntry(s.db.QueryRowContext(ctx, projectEntrySelect+`
		WHERE e.notebook_id = ? AND e.title = ? COLLATE NOCASE
			AND COALESCE(e.origin_instance, '') = ? AND e.deleted_at IS NULL
		ORDER BY e.created_at DESC, e.id DESC LIMIT 1`,
		notebookID, path, strings.TrimSpace(machine)))
	if errors.Is(err, sql.ErrNoRows) {
		return Entry{}, false, nil
	}
	if err != nil {
		return Entry{}, false, fmt.Errorf("store: procurar projeto por caminho: %w", err)
	}
	return entry, true, nil
}

// EnsureProjectEntry returns the project entry of one (machine, path) pair,
// creating it when it does not exist. The entry is provenance only: the origin
// instance is the machine and the kind is "mcp".
func (s *Store) EnsureProjectEntry(ctx context.Context, notebookID, path, machine string) (Entry, error) {
	path = strings.TrimSpace(path)
	machine = strings.TrimSpace(machine)
	if entry, ok, err := s.FindProjectEntry(ctx, notebookID, path, machine); err != nil {
		return Entry{}, err
	} else if ok {
		return entry, nil
	}
	now := time.Now().UTC()
	entry := Entry{
		ID:             newID(),
		Title:          path,
		Status:         EntryReady,
		Source:         "text",
		NotebookID:     notebookID,
		OriginInstance: machine,
		OriginKind:     OriginKindMCP,
		SummaryDetail:  SummaryDetailConcise,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.CreateEntry(ctx, entry); err != nil {
		// Uma chamada concorrente pode ter criado o projeto primeiro. Reler
		// antes de falhar evita transformar a corrida em erro para o agente.
		if found, ok, findErr := s.FindProjectEntry(ctx, notebookID, path, machine); findErr == nil && ok {
			return found, nil
		}
		return Entry{}, fmt.Errorf("store: criar projeto por caminho: %w", err)
	}
	return entry, nil
}

// FindSessionNote returns the note that carries the marker of one session. The
// marker is compared literally with instr(), not with LIKE: "_" is common in a
// session id and LIKE would treat it as a wildcard. The search is scoped to the
// notes of the MCP notebook; the body is never parsed here.
func (s *Store) FindSessionNote(ctx context.Context, notebookID, sessionID string) (Note, bool, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		// Sem id nao existe marcador; um instr() vazio casaria com toda nota.
		return Note{}, false, nil
	}
	marker := "<!-- mcp:s:" + sessionID + " -->"
	note, err := scanNote(s.db.QueryRowContext(ctx, `
		SELECT n.id, n.entry_id, COALESCE(n.title,''), n.document, COALESCE(n.content_markdown,''),
			n.body_updated_at, n.created_at, n.updated_at
		FROM notes n
		JOIN entries e ON e.id = n.entry_id
		WHERE e.notebook_id = ? AND e.deleted_at IS NULL
			AND instr(COALESCE(n.content_markdown, n.document), ?) > 0
		ORDER BY n.updated_at DESC, n.id DESC LIMIT 1`, notebookID, marker))
	if errors.Is(err, sql.ErrNoRows) {
		return Note{}, false, nil
	}
	if err != nil {
		return Note{}, false, fmt.Errorf("store: procurar sessao: %w", err)
	}
	return note, true, nil
}
