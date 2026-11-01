package store

import (
	"context"
	"fmt"
	"strings"
)

// ListAttachmentIDsForEntries returns the attachment ids of each entry, grouped
// by entry. The sync manifest uses it to tell a peer which bytes it is missing
// without making one request per note. Entries without attachments are absent
// from the map.
func (s *Store) ListAttachmentIDsForEntries(ctx context.Context, entryIDs []string) (map[string][]string, error) {
	out := map[string][]string{}
	if len(entryIDs) == 0 {
		return out, nil
	}
	// SQLite has a limit on bound variables; keep each query well below it.
	const chunk = 400
	for start := 0; start < len(entryIDs); start += chunk {
		end := start + chunk
		if end > len(entryIDs) {
			end = len(entryIDs)
		}
		ids := entryIDs[start:end]
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id
		}
		rows, err := s.db.QueryContext(ctx,
			`SELECT entry_id, id FROM attachments
			 WHERE entry_id IN (`+placeholders+`) AND kind IN (?, ?)
			 ORDER BY entry_id, created_at ASC, id ASC`, append(args, AttachmentOriginal, AttachmentImage)...)
		if err != nil {
			return nil, fmt.Errorf("store: listar anexos das entradas: %w", err)
		}
		for rows.Next() {
			var entryID, attachmentID string
			if err := rows.Scan(&entryID, &attachmentID); err != nil {
				rows.Close()
				return nil, fmt.Errorf("store: ler anexo da entrada: %w", err)
			}
			out[entryID] = append(out[entryID], attachmentID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: listar anexos das entradas: %w", err)
		}
		rows.Close()
	}
	return out, nil
}
