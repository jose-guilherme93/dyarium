package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// backfillDecisionEntities adds decision nodes to analyses saved before
// decisions became entities. It reads the latest analysis of each entry (the
// JSON contract already had `decisions`), replaces the entry's decision links
// and runs once, guarded by a settings key. New analyses are handled by
// analysisbuild; this only catches the existing library.
func (s *Store) backfillDecisionEntities(ctx context.Context) error {
	if value, ok, err := s.GetSetting(ctx, "decisions_backfilled"); err != nil {
		return err
	} else if ok && value == "true" {
		return nil
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT a.entry_id, COALESCE(a.data, ''), a.created_at
		FROM analyses a
		JOIN entries e ON e.id = a.entry_id AND e.deleted_at IS NULL
		WHERE a.rowid = (
			SELECT a2.rowid FROM analyses a2
			WHERE a2.entry_id = a.entry_id
			ORDER BY a2.created_at DESC, a2.rowid DESC LIMIT 1
		)
		AND a.data LIKE '%"decisions"%'`)
	if err != nil {
		return fmt.Errorf("store: backfill decisions: %w", err)
	}
	type entryDecisions struct {
		entryID string
		names   []string
		when    time.Time
	}
	var pending []entryDecisions
	for rows.Next() {
		var entryID, data, createdAt string
		if err := rows.Scan(&entryID, &data, &createdAt); err != nil {
			rows.Close()
			return fmt.Errorf("store: scan decision backfill: %w", err)
		}
		var payload struct {
			Decisions []string `json:"decisions"`
		}
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			continue
		}
		var names []string
		seen := map[string]bool{}
		for _, raw := range payload.Decisions {
			name := strings.TrimSpace(raw)
			key := strings.ToLower(name)
			if name == "" || seen[key] {
				continue
			}
			seen[key] = true
			names = append(names, name)
		}
		pending = append(pending, entryDecisions{entryID: entryID, names: names, when: parseTS(createdAt)})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: backfill decisions tx: %w", err)
	}
	defer tx.Rollback()
	for _, entry := range pending {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM entry_entities
			WHERE entry_id = ?
				AND entity_id IN (SELECT id FROM entities WHERE kind = ?)`,
			entry.entryID, EntityDecision); err != nil {
			return fmt.Errorf("store: clear old decisions: %w", err)
		}
		for _, name := range entry.names {
			entityID, err := upsertEntity(ctx, tx, EntityDecision, name, entry.when)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
				VALUES (?, ?, 1, NULL, NULL, ?)
				ON CONFLICT (entry_id, entity_id) DO NOTHING`,
				entry.entryID, entityID, ts(entry.when)); err != nil {
				return fmt.Errorf("store: link decision: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: backfill decisions commit: %w", err)
	}
	return s.SetSetting(ctx, "decisions_backfilled", "true")
}
