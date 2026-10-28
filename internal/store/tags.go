package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// TagPalette is the pastel bank shared by the app and the dashboard. It lives
// here because the server stores the chosen color, so every surface shows the
// same one. Keep it in sync with mobile/src/core/tags.ts and web/src/lib/tags.ts.
var TagPalette = []string{
	"#F2C4C4", // rosa
	"#F4D6B8", // pessego
	"#EFE3A8", // amarelo
	"#C9E4C5", // verde
	"#BFE1DF", // verde-agua
	"#C7D8F2", // azul
	"#D8CCEF", // lavanda
	"#EEC7DE", // lilas
}

// TagColor returns a stable pastel for a tag name. The hash is FNV-1a over the
// lowercased runes; the app and the dashboard repeat the same algorithm so an
// offline tag already appears with the color the server will persist.
func TagColor(name string) string {
	h := uint32(2166136261)
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		h ^= uint32(r)
		h *= 16777619
	}
	return TagPalette[int(h%uint32(len(TagPalette)))]
}

// CreateTag inserts a tag. An empty color gets the stable palette color.
func (s *Store) CreateTag(ctx context.Context, t Tag) error {
	color := strings.TrimSpace(t.Color)
	if color == "" {
		color = TagColor(t.Name)
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
		t.ID, t.Name, color, ts(t.CreatedAt))
	if err != nil {
		return fmt.Errorf("store: create tag: %w", err)
	}
	return nil
}

// GetTag returns one tag with its entry count.
func (s *Store) GetTag(ctx context.Context, id string) (Tag, error) {
	var t Tag
	err := s.db.QueryRowContext(ctx, `
		SELECT t.id, t.name, COALESCE(t.color, ''),
			(SELECT COUNT(*) FROM entry_tags et
			 JOIN entries e ON e.id = et.entry_id
			 WHERE et.tag_id = t.id AND e.deleted_at IS NULL)
		FROM tags t WHERE t.id = ?`, id).Scan(&t.ID, &t.Name, &t.Color, &t.EntryCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Tag{}, ErrNotFound
	}
	if err != nil {
		return Tag{}, fmt.Errorf("store: get tag: %w", err)
	}
	return t, nil
}

// UpdateTag renames and/or recolors a tag. Renaming to a name that already
// exists merges the two tags: the notes move to the existing tag and the old
// one disappears. The boolean reports whether a merge happened.
func (s *Store) UpdateTag(ctx context.Context, id string, name, color *string) (Tag, bool, error) {
	current, err := s.GetTag(ctx, id)
	if err != nil {
		return Tag{}, false, err
	}
	finalName := current.Name
	if name != nil {
		finalName = strings.TrimSpace(*name)
		if finalName == "" {
			return Tag{}, false, fmt.Errorf("store: update tag: nome vazio")
		}
		if !strings.EqualFold(finalName, current.Name) {
			var otherID string
			err := s.db.QueryRowContext(ctx,
				`SELECT id FROM tags WHERE lower(name) = lower(?) AND id <> ? LIMIT 1`,
				finalName, id).Scan(&otherID)
			switch {
			case err == nil:
				if err := s.mergeTags(ctx, id, otherID, color); err != nil {
					return Tag{}, false, err
				}
				merged, err := s.GetTag(ctx, otherID)
				return merged, true, err
			case errors.Is(err, sql.ErrNoRows):
				// nome livre
			default:
				return Tag{}, false, fmt.Errorf("store: find tag to merge: %w", err)
			}
		}
	}
	finalColor := current.Color
	if color != nil {
		finalColor = strings.TrimSpace(*color)
		if finalColor == "" {
			finalColor = TagColor(finalName)
		}
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE tags SET name = ?, color = ? WHERE id = ?`,
		finalName, finalColor, id); err != nil {
		return Tag{}, false, fmt.Errorf("store: update tag: %w", err)
	}
	updated, err := s.GetTag(ctx, id)
	return updated, false, err
}

func (s *Store) mergeTags(ctx context.Context, sourceID, targetID string, color *string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: merge tags: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO entry_tags (entry_id, tag_id, created_at)
		SELECT entry_id, ?, created_at FROM entry_tags WHERE tag_id = ?`,
		targetID, sourceID); err != nil {
		return fmt.Errorf("store: move tag entries: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entry_tags WHERE tag_id = ?`, sourceID); err != nil {
		return fmt.Errorf("store: clear merged tag: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM tags WHERE id = ?`, sourceID); err != nil {
		return fmt.Errorf("store: delete merged tag: %w", err)
	}
	if color != nil {
		if _, err := tx.ExecContext(ctx, `UPDATE tags SET color = ? WHERE id = ?`,
			strings.TrimSpace(*color), targetID); err != nil {
			return fmt.Errorf("store: recolor merged tag: %w", err)
		}
	}
	return tx.Commit()
}

// backfillTagColors fills colors for tags created before the palette existed.
// It runs after migrations and is idempotent.
func (s *Store) backfillTagColors(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name FROM tags WHERE color IS NULL OR color = ''`)
	if err != nil {
		return fmt.Errorf("store: list tags without color: %w", err)
	}
	type pending struct{ id, name string }
	var items []pending
	for rows.Next() {
		var item pending
		if err := rows.Scan(&item.id, &item.name); err != nil {
			rows.Close()
			return fmt.Errorf("store: scan tag without color: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("store: list tags without color: %w", err)
	}
	rows.Close()
	if len(items) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: backfill tag colors: %w", err)
	}
	defer tx.Rollback()
	for _, item := range items {
		if _, err := tx.ExecContext(ctx,
			`UPDATE tags SET color = ? WHERE id = ?`, TagColor(item.name), item.id); err != nil {
			return fmt.Errorf("store: backfill tag color: %w", err)
		}
	}
	return tx.Commit()
}

// ListTags returns tags with their entry counts.
func (s *Store) ListTags(ctx context.Context) ([]Tag, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.name, COALESCE(t.color,''),
			(SELECT COUNT(*) FROM entry_tags et
			 JOIN entries e ON e.id = et.entry_id
			 WHERE et.tag_id = t.id AND e.deleted_at IS NULL) AS entry_count
		FROM tags t ORDER BY t.name`)
	if err != nil {
		return nil, fmt.Errorf("store: list tags: %w", err)
	}
	defer rows.Close()
	var out []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.EntryCount); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteTag removes a tag and its associations.
func (s *Store) DeleteTag(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM tags WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("store: delete tag: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AttachTag associates a tag with an entry.
func (s *Store) AttachTag(ctx context.Context, entryID, tagID string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id, created_at) VALUES (?, ?, ?)`,
		entryID, tagID, ts(time.Now()))
	if err != nil {
		return fmt.Errorf("store: attach tag: %w", err)
	}
	return nil
}

// ListEntryTags returns the tags attached to an entry, ordered by name.
func (s *Store) ListEntryTags(ctx context.Context, entryID string) ([]Tag, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.name, COALESCE(t.color,'')
		FROM tags t JOIN entry_tags et ON et.tag_id = t.id
		WHERE et.entry_id = ? ORDER BY t.name`, entryID)
	if err != nil {
		return nil, fmt.Errorf("store: list entry tags: %w", err)
	}
	defer rows.Close()
	var out []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListEntryTagNames returns the tag names of many entries in one query, keyed
// by entry id. The dashboard lists up to hundreds of entries and used to issue
// one query per entry (N+1) on the single SQLite connection.
func (s *Store) ListEntryTagNames(ctx context.Context, entryIDs []string) (map[string][]string, error) {
	out := make(map[string][]string, len(entryIDs))
	const chunk = 400
	for start := 0; start < len(entryIDs); start += chunk {
		end := start + chunk
		if end > len(entryIDs) {
			end = len(entryIDs)
		}
		ids := entryIDs[start:end]
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
		args := make([]any, 0, len(ids))
		for _, id := range ids {
			args = append(args, id)
		}
		rows, err := s.db.QueryContext(ctx, `
			SELECT et.entry_id, t.name
			FROM entry_tags et JOIN tags t ON t.id = et.tag_id
			WHERE et.entry_id IN (`+placeholders+`)
			ORDER BY et.entry_id, t.name`, args...)
		if err != nil {
			return nil, fmt.Errorf("store: list entry tag names: %w", err)
		}
		for rows.Next() {
			var entryID, name string
			if err := rows.Scan(&entryID, &name); err != nil {
				rows.Close()
				return nil, err
			}
			out[entryID] = append(out[entryID], name)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}

// SetEntryTags replaces the tags of an entry, creating tags as needed.
func (s *Store) SetEntryTags(ctx context.Context, entryID string, names []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin tags tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM entry_tags WHERE entry_id = ?`, entryID); err != nil {
		return fmt.Errorf("store: clear entry tags: %w", err)
	}
	seen := map[string]bool{}
	for _, raw := range names {
		name := strings.TrimSpace(raw)
		if name == "" || seen[strings.ToLower(name)] {
			continue
		}
		seen[strings.ToLower(name)] = true
		// Busca sem caixa antes de criar: "Viagem" e "viagem" sao a mesma tag.
		var tagID string
		err := tx.QueryRowContext(ctx,
			`SELECT id FROM tags WHERE lower(name) = lower(?) ORDER BY name LIMIT 1`, name).Scan(&tagID)
		if errors.Is(err, sql.ErrNoRows) {
			tagID = newID()
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
				tagID, name, TagColor(name), ts(time.Now())); err != nil {
				return fmt.Errorf("store: create tag: %w", err)
			}
		} else if err != nil {
			return fmt.Errorf("store: find tag: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE tags SET color = ? WHERE id = ? AND (color IS NULL OR color = '')`,
			TagColor(name), tagID); err != nil {
			return fmt.Errorf("store: fill tag color: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id, created_at) VALUES (?, ?, ?)`,
			entryID, tagID, ts(time.Now())); err != nil {
			return fmt.Errorf("store: attach tag: %w", err)
		}
	}
	// Tags sao atividade da nota: o pull usa updated_at para a faixa de recentes
	// e para saber que a nota mudou em outro aparelho.
	if _, err := tx.ExecContext(ctx,
		`UPDATE entries SET updated_at = ? WHERE id = ?`, ts(time.Now()), entryID); err != nil {
		return fmt.Errorf("store: touch entry tags: %w", err)
	}
	return tx.Commit()
}

// execer is implemented by *sql.DB and *sql.Tx, so statements can run inside or
// outside a transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// insertAnalysis writes one analysis row.
// originOrDefault keeps old callers (and rows written before the column) on the
// historical meaning: the server produced it.
func originOrDefault(origin string) string {
	if origin == "" {
		return "server"
	}
	return origin
}

func insertAnalysis(ctx context.Context, ex execer, a Analysis) error {
	// Uma analise sem a medida da revisao nao tem compreensao: -1 e "nao
	// medida", 0 seria lido como "incompreensivel".
	if a.Comprehension == 0 && a.ComprehensionSource == "" {
		a.Comprehension = -1
	}
	_, err := ex.ExecContext(ctx, `
		INSERT INTO analyses (id, entry_id, model, sentiment, sentiment_label, emotions, people, places,
			summary, raw, data, comprehension, comprehension_source, stutter_rate, hesitation_rate,
			revised_segments, origin, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.EntryID, a.Model, a.Sentiment, a.SentimentLabel, a.Emotions, a.People, a.Places,
		a.Summary, a.Raw, a.Data, a.Comprehension, a.ComprehensionSource, a.StutterRate,
		a.HesitationRate, a.RevisedSegments, originOrDefault(a.Origin), ts(a.CreatedAt))
	if err != nil {
		return fmt.Errorf("store: save analysis: %w", err)
	}
	return nil
}

// SaveAnalysis stores the analysis of an entry.
func (s *Store) SaveAnalysis(ctx context.Context, a Analysis) error {
	return insertAnalysis(ctx, s.db, a)
}

// SaveRichAnalysis stores the analysis and its entities in a single
// transaction, replacing the entry's previous entity links.
func (s *Store) SaveRichAnalysis(ctx context.Context, a Analysis, links []EntityLink) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin analysis tx: %w", err)
	}
	defer tx.Rollback()

	if err := insertAnalysis(ctx, tx, a); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entry_entities WHERE entry_id = ?`, a.EntryID); err != nil {
		return fmt.Errorf("store: clear entry entities: %w", err)
	}
	// O dono nao vira no de pessoa: "sou eu" e o centro do mapa. Grafias ja
	// marcadas como o dono sao descartadas aqui para uma analise futura nao
	// recriar a pessoa duplicada.
	ownerKeys, err := ownerPersonKeys(ctx, tx)
	if err != nil {
		return err
	}
	for _, link := range links {
		if link.Kind == EntityPerson && ownerKeys[strings.ToLower(strings.TrimSpace(link.Name))] {
			continue
		}
		entityID, err := upsertEntity(ctx, tx, link.Kind, link.Name, a.CreatedAt)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (entry_id, entity_id) DO UPDATE SET
				count = excluded.count, relation = excluded.relation, sentiment = excluded.sentiment`,
			a.EntryID, entityID, link.Count, nullText(link.Relation), nullFloat(link.Sentiment), ts(a.CreatedAt)); err != nil {
			return fmt.Errorf("store: link entity: %w", err)
		}
	}
	return tx.Commit()
}

// ownerPersonKeys lists the owner display name and every "sou eu" alias,
// normalized for a case-insensitive comparison.
func ownerPersonKeys(ctx context.Context, tx *sql.Tx) (map[string]bool, error) {
	owner, err := ownerDisplayName(ctx, tx)
	if err != nil {
		return nil, err
	}
	keys := map[string]bool{strings.ToLower(owner): true}
	rows, err := tx.QueryContext(ctx, `SELECT name FROM owner_aliases`)
	if err != nil {
		return nil, fmt.Errorf("store: owner person keys: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var alias string
		if err := rows.Scan(&alias); err != nil {
			return nil, fmt.Errorf("store: scan owner person key: %w", err)
		}
		keys[strings.ToLower(strings.TrimSpace(alias))] = true
	}
	return keys, rows.Err()
}

// upsertEntity resolves a name to the canonical entity of that kind. The lookup
// is case-insensitive and follows renames through entity_aliases, so an analysis
// that says "Mariana" after the user renamed her to "Marianna" lands on the same
// entity instead of creating a duplicate.
func upsertEntity(ctx context.Context, ex execer, kind, name string, now time.Time) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", ErrInvalidEntity
	}
	var id string
	err := ex.QueryRowContext(ctx,
		`SELECT id FROM entities WHERE kind = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1`,
		kind, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("store: find entity: %w", err)
	}
	err = ex.QueryRowContext(ctx,
		`SELECT entity_id FROM entity_aliases WHERE kind = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1`,
		kind, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("store: find entity alias: %w", err)
	}
	id = newID()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO entities (id, kind, name, created_at) VALUES (?, ?, ?, ?)`,
		id, kind, name, ts(now)); err != nil {
		return "", fmt.Errorf("store: create entity: %w", err)
	}
	return id, nil
}

func nullText(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func nullFloat(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

// DeleteAnalyses removes every analysis of an entry. An analysis describes the
// text it read; when that text stops existing (the audio with its transcript
// was deleted), keeping the numbers would show a measurement of another
// version of the note.
func (s *Store) DeleteAnalyses(ctx context.Context, entryID string) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM analyses WHERE entry_id = ?`, entryID)
	if err != nil {
		return 0, fmt.Errorf("store: delete analyses: %w", err)
	}
	return res.RowsAffected()
}

// GetAnalysis returns the most recent analysis of an entry.
func (s *Store) GetAnalysis(ctx context.Context, entryID string) (Analysis, bool, error) {
	var a Analysis
	var createdAt string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, entry_id, model, sentiment, COALESCE(sentiment_label,''), COALESCE(emotions,''),
			COALESCE(people,''), COALESCE(places,''), COALESCE(summary,''), COALESCE(raw,''),
			COALESCE(data,''), comprehension, COALESCE(comprehension_source,''), stutter_rate,
			hesitation_rate, revised_segments, COALESCE(origin,'server'), created_at
		FROM analyses WHERE entry_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, entryID).Scan(
		&a.ID, &a.EntryID, &a.Model, &a.Sentiment, &a.SentimentLabel, &a.Emotions, &a.People,
		&a.Places, &a.Summary, &a.Raw, &a.Data, &a.Comprehension, &a.ComprehensionSource,
		&a.StutterRate, &a.HesitationRate, &a.RevisedSegments, &a.Origin, &createdAt)
	if err == sql.ErrNoRows {
		return Analysis{}, false, nil
	}
	if err != nil {
		return Analysis{}, false, fmt.Errorf("store: get analysis: %w", err)
	}
	a.CreatedAt = parseTS(createdAt)
	return a, true, nil
}
