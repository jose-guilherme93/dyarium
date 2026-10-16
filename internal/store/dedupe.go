package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// DedupeReport summarizes a deduplication run.
type DedupeReport struct {
	Merged         int      // entradas duplicadas mescladas e removidas
	RemovedObjects []string // storage keys cujo ciphertext pode ser apagado
}

// DeduplicateEntries merges entries that are duplicates of the same audio: same
// single audio content (same sha256), at the root of the tree. The most complete
// entry (transcript, then note, then analysis, then oldest) is kept; notes, sub
// notes, tags, entities, links and the analysis of the others are moved to it,
// and their redundant audio objects are returned for deletion.
//
// Destructive: intended for the `diary dedupe` maintenance command. With
// dryRun=true the work runs in a transaction that is rolled back at the end.
func (s *Store) DeduplicateEntries(ctx context.Context, dryRun bool) (DedupeReport, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DedupeReport{}, fmt.Errorf("store: dedupe: begin: %w", err)
	}
	defer tx.Rollback()

	// Entradas com exatamente um audio original, agrupadas pelo conteudo dele.
	rows, err := tx.QueryContext(ctx, `
		SELECT a.sha256, e.id
		FROM entries e
		JOIN attachments a ON a.entry_id = e.id AND a.kind = ?
		WHERE e.deleted_at IS NULL AND a.sha256 IS NOT NULL AND a.sha256 != ''
			AND (SELECT COUNT(*) FROM attachments a2 WHERE a2.entry_id = e.id AND a2.kind = ?) = 1
		ORDER BY a.sha256 ASC, e.created_at ASC, e.id ASC`, AttachmentOriginal, AttachmentOriginal)
	if err != nil {
		return DedupeReport{}, fmt.Errorf("store: dedupe: list: %w", err)
	}
	groups := map[string][]string{}
	var order []string
	for rows.Next() {
		var sha, id string
		if err := rows.Scan(&sha, &id); err != nil {
			rows.Close()
			return DedupeReport{}, fmt.Errorf("store: dedupe: scan: %w", err)
		}
		if _, ok := groups[sha]; !ok {
			order = append(order, sha)
		}
		groups[sha] = append(groups[sha], id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return DedupeReport{}, fmt.Errorf("store: dedupe: rows: %w", err)
	}

	var report DedupeReport
	for _, sha := range order {
		ids := groups[sha]
		if len(ids) < 2 {
			continue
		}
		keeper, err := pickKeeper(ctx, tx, ids)
		if err != nil {
			return DedupeReport{}, err
		}
		for _, id := range ids {
			if id == keeper {
				continue
			}
			keys, err := mergeEntry(ctx, tx, keeper, id)
			if err != nil {
				return DedupeReport{}, err
			}
			report.Merged++
			report.RemovedObjects = append(report.RemovedObjects, keys...)
		}
	}

	if dryRun {
		return report, nil
	}
	if err := tx.Commit(); err != nil {
		return DedupeReport{}, fmt.Errorf("store: dedupe: commit: %w", err)
	}
	return report, nil
}

// pickKeeper chooses the entry that holds the most data, so a merge does not
// lose it: prefers one with a transcript, then a note, then an analysis, then
// the oldest (ids are ordered by created_at).
func pickKeeper(ctx context.Context, tx *sql.Tx, ids []string) (string, error) {
	for _, query := range []string{
		`SELECT 1 FROM transcripts t JOIN attachments a ON a.id = t.attachment_id WHERE a.entry_id = ? LIMIT 1`,
		`SELECT 1 FROM notes WHERE entry_id = ? LIMIT 1`,
		`SELECT 1 FROM analyses WHERE entry_id = ? LIMIT 1`,
	} {
		for _, id := range ids {
			ok, err := existsFor(ctx, tx, query, id)
			if err != nil {
				return "", err
			}
			if ok {
				return id, nil
			}
		}
	}
	return ids[0], nil
}

// mergeEntry reassigns the related data of the doomed entry to the keeper,
// removes its redundant audio attachments and soft-deletes it. Returns the
// storage keys of the removed objects.
func mergeEntry(ctx context.Context, tx *sql.Tx, keeper, doomed string) ([]string, error) {
	// Reaproveita a transcricao da duplicada quando o keeper ainda nao tem uma
	// para o mesmo audio; caso contrario ela cai junto com o anexo.
	audios, err := tx.QueryContext(ctx,
		`SELECT id, COALESCE(sha256,'') FROM attachments WHERE entry_id = ? AND kind = ?`,
		doomed, AttachmentOriginal)
	if err != nil {
		return nil, fmt.Errorf("store: dedupe: audios: %w", err)
	}
	type audioRef struct{ id, sha string }
	var doomedAudios []audioRef
	for audios.Next() {
		var a audioRef
		if err := audios.Scan(&a.id, &a.sha); err != nil {
			audios.Close()
			return nil, fmt.Errorf("store: dedupe: scan audio: %w", err)
		}
		doomedAudios = append(doomedAudios, a)
	}
	audios.Close()
	if err := audios.Err(); err != nil {
		return nil, fmt.Errorf("store: dedupe: audio rows: %w", err)
	}
	for _, a := range doomedAudios {
		if a.sha == "" || !hasTranscript(ctx, tx, a.id) {
			continue
		}
		var keeperAudio string
		err := tx.QueryRowContext(ctx, `
			SELECT id FROM attachments WHERE entry_id = ? AND kind = ? AND sha256 = ?
			ORDER BY created_at ASC LIMIT 1`, keeper, AttachmentOriginal, a.sha).Scan(&keeperAudio)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("store: dedupe: keeper audio: %w", err)
		}
		if !hasTranscript(ctx, tx, keeperAudio) {
			if _, err := tx.ExecContext(ctx,
				`UPDATE transcripts SET attachment_id = ?, entry_id = ? WHERE attachment_id = ?`,
				keeperAudio, keeper, a.id); err != nil {
				return nil, fmt.Errorf("store: dedupe: move transcript: %w", err)
			}
		}
	}

	var keys []string
	rows, err := tx.QueryContext(ctx, `SELECT storage_key FROM attachments WHERE entry_id = ?`, doomed)
	if err != nil {
		return nil, fmt.Errorf("store: dedupe: attachments: %w", err)
	}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: dedupe: scan attachment: %w", err)
		}
		if key != "" {
			keys = append(keys, key)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: dedupe: attachment rows: %w", err)
	}

	// A duplicada nao precisa dos proprios audios (o keeper ja tem o conteudo).
	if _, err := tx.ExecContext(ctx, `DELETE FROM attachments WHERE entry_id = ?`, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: clear attachments: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM transcripts WHERE entry_id = ?`, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: clear transcripts: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE notes SET entry_id = ? WHERE entry_id = ?`, keeper, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: move notes: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE entries SET parent_id = ? WHERE parent_id = ?`, keeper, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: reparent: %w", err)
	}
	if err := moveOnce(ctx, tx, "analyses", keeper, doomed); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id, created_at)
		 SELECT ?, tag_id, created_at FROM entry_tags WHERE entry_id = ?`, keeper, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: move tags: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entry_tags WHERE entry_id = ?`, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: clear tags: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
		 SELECT ?, entity_id, count, relation, sentiment, created_at FROM entry_entities WHERE entry_id = ?`, keeper, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: move entities: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entry_entities WHERE entry_id = ?`, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: clear entities: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE links SET from_entry_id = ? WHERE from_entry_id = ?`, keeper, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: move links from: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE links SET to_entry_id = ? WHERE to_entry_id = ?`, keeper, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: move links to: %w", err)
	}

	now := ts(time.Now())
	if _, err := tx.ExecContext(ctx,
		`UPDATE entries SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		now, EntryDeleted, now, doomed); err != nil {
		return nil, fmt.Errorf("store: dedupe: soft delete: %w", err)
	}
	return keys, nil
}

// moveOnce moves a one-per-entry table's rows to the keeper when it has none;
// otherwise it discards the doomed rows.
func moveOnce(ctx context.Context, tx *sql.Tx, table, keeper, doomed string) error {
	has, err := existsFor(ctx, tx, `SELECT 1 FROM `+table+` WHERE entry_id = ? LIMIT 1`, keeper)
	if err != nil {
		return err
	}
	query := `DELETE FROM ` + table + ` WHERE entry_id = ?`
	args := []any{doomed}
	if !has {
		query = `UPDATE ` + table + ` SET entry_id = ? WHERE entry_id = ?`
		args = []any{keeper, doomed}
	}
	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("store: dedupe: move %s: %w", table, err)
	}
	return nil
}

func hasTranscript(ctx context.Context, tx *sql.Tx, attachmentID string) bool {
	var one int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM transcripts WHERE attachment_id = ? LIMIT 1`, attachmentID).Scan(&one)
	return err == nil
}

func existsFor(ctx context.Context, tx *sql.Tx, query, arg string) (bool, error) {
	var one int
	err := tx.QueryRowContext(ctx, query, arg).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("store: dedupe: exists: %w", err)
	}
	return true, nil
}
