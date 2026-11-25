package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// maxProjectList bounds the projects endpoint. The MCP notebook is a work list,
// not an archive: 500 entries cover years of use and keep one response small.
const maxProjectList = 500

// ProjectInfo is one project of the MCP notebook as the settings screen reads
// it. The path is already formatted for display, following mcp_store_full_path.
type ProjectInfo struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Path          string `json:"path"`
	Sessions      int    `json:"sessions"`
	LastSessionAt string `json:"last_session_at"`
	State         string `json:"state"`
	SummaryDetail string `json:"summary_detail"`
	Archived      bool   `json:"archived"`
}

// Projects lists the entries of the MCP notebook with the session facts the
// settings screen needs. The session fence is parsed here, so the format lives in
// this package only; the handler just serializes the result.
func Projects(ctx context.Context, st *store.Store) ([]ProjectInfo, error) {
	if st == nil {
		return nil, errors.New("diario indisponivel")
	}
	settings := SettingsFrom(ctx, st)
	notebook, err := st.EnsureMCPNotebook(ctx)
	if err != nil {
		return nil, fmt.Errorf("abrir caderno de projetos: %w", err)
	}
	entries, err := st.ListEntriesFilteredNotebook(ctx, maxProjectList, 0, "", "", "", nil, notebook.ID)
	if err != nil {
		return nil, fmt.Errorf("listar projetos: %w", err)
	}

	now := time.Now().UTC()
	out := make([]ProjectInfo, 0, len(entries))
	for _, entry := range entries {
		info, err := projectInfo(ctx, st, entry, settings, now)
		if err != nil {
			return nil, err
		}
		out = append(out, info)
	}
	return out, nil
}

func projectInfo(ctx context.Context, st *store.Store, entry store.Entry, settings Settings, now time.Time) (ProjectInfo, error) {
	info := ProjectInfo{
		ID:            entry.ID,
		Title:         entry.Title,
		Path:          displayPath(entry.Title, settings),
		SummaryDetail: entry.SummaryDetail,
		Archived:      entry.Archived,
	}
	notes, err := st.ListNotes(ctx, entry.ID)
	if err != nil {
		return ProjectInfo{}, fmt.Errorf("ler sessoes do projeto: %w", err)
	}

	var latestNote store.Note
	var latestPayload sessionPayload
	found := false
	for _, note := range notes {
		payload, ok := parseSessionFence(noteBody(note))
		if !ok {
			continue
		}
		info.Sessions++
		// A nota mais recente e a de maior created_at; duas sessoes no mesmo
		// segundo desempatam por id para a resposta ser estavel.
		if !found || note.CreatedAt.After(latestNote.CreatedAt) ||
			(note.CreatedAt.Equal(latestNote.CreatedAt) && note.ID > latestNote.ID) {
			found = true
			latestNote = note
			latestPayload = payload
		}
	}
	if !found {
		return info, nil
	}

	info.LastSessionAt = latestNote.CreatedAt.UTC().Format(time.RFC3339)
	info.State = sessionState(latestPayload, latestNote, now, settings.IdleLimit())
	path := strings.TrimSpace(latestPayload.Path)
	if path == "" {
		path = entry.Title
	}
	info.Path = displayPath(path, settings)
	return info, nil
}
