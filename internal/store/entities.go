package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

// DefaultOwnerName is the center label when the diarist has not chosen a name.
const DefaultOwnerName = "Você"

// ownerDisplayName reads the name the diarist chose in settings. The map
// center, the analysis prose and the "sou eu" merge all use this one value.
func ownerDisplayName(ctx context.Context, ex execer) (string, error) {
	var name string
	err := ex.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = 'owner_name'`).Scan(&name)
	if err == sql.ErrNoRows {
		return DefaultOwnerName, nil
	}
	if err != nil {
		return "", fmt.Errorf("store: owner name: %w", err)
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return DefaultOwnerName, nil
	}
	return name, nil
}

// ListEntities returns the aggregated entities of a kind (person, place or
// theme), ordered by number of mentions. An empty kind lists all kinds.
func (s *Store) ListEntities(ctx context.Context, kind string) ([]EntitySummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT en.id, en.kind, en.name, COALESCE(en.icon, ''),
			COUNT(DISTINCT ee.entry_id),
			COALESCE(SUM(ee.count), 0),
			COALESCE(AVG(ee.sentiment), 0),
			COALESCE(MAX(COALESCE(e.recorded_at, e.created_at)), '')
		FROM entities en
		JOIN entry_entities ee ON ee.entity_id = en.id
		JOIN entries e ON e.id = ee.entry_id AND e.deleted_at IS NULL
		WHERE (? = '' OR en.kind = ?)
		GROUP BY en.id, en.kind, en.name
		ORDER BY SUM(ee.count) DESC, en.name`, kind, kind)
	if err != nil {
		return nil, fmt.Errorf("store: list entities: %w", err)
	}
	defer rows.Close()
	var out []EntitySummary
	for rows.Next() {
		var summary EntitySummary
		var lastSeen string
		if err := rows.Scan(&summary.ID, &summary.Kind, &summary.Name, &summary.Icon, &summary.Entries,
			&summary.Mentions, &summary.Sentiment, &lastSeen); err != nil {
			return nil, fmt.Errorf("store: scan entity: %w", err)
		}
		summary.LastSeen = parseTS(lastSeen)
		out = append(out, summary)
	}
	return out, rows.Err()
}

// entityIDByName resolves a canonical name or an old alias to one entity id.
func entityIDByName(ctx context.Context, ex execer, kind, name string) (string, bool, error) {
	var id string
	err := ex.QueryRowContext(ctx,
		`SELECT id FROM entities WHERE kind = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1`,
		kind, name).Scan(&id)
	if err == nil {
		return id, true, nil
	}
	if err != sql.ErrNoRows {
		return "", false, fmt.Errorf("store: find entity: %w", err)
	}
	err = ex.QueryRowContext(ctx,
		`SELECT entity_id FROM entity_aliases WHERE kind = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1`,
		kind, name).Scan(&id)
	if err == nil {
		return id, true, nil
	}
	if err != sql.ErrNoRows {
		return "", false, fmt.Errorf("store: find entity alias: %w", err)
	}
	return "", false, nil
}

// GetEntity returns one aggregated entity and the entries that mention it.
// ok is false when the entity does not exist. An old name that was renamed is
// resolved through entity_aliases, so callers do not need to know the new one.
func (s *Store) GetEntity(ctx context.Context, kind, name string) (EntitySummary, []EntityEntry, bool, error) {
	id, found, err := entityIDByName(ctx, s.db, kind, name)
	if err != nil {
		return EntitySummary{}, nil, false, err
	}
	if !found {
		return EntitySummary{}, nil, false, nil
	}
	var summary EntitySummary
	var lastSeen string
	err = s.db.QueryRowContext(ctx, `
		SELECT en.id, en.kind, en.name, COALESCE(en.icon, ''),
			COUNT(DISTINCT ee.entry_id),
			COALESCE(SUM(ee.count), 0),
			COALESCE(AVG(ee.sentiment), 0),
			COALESCE(MAX(COALESCE(e.recorded_at, e.created_at)), '')
		FROM entities en
		JOIN entry_entities ee ON ee.entity_id = en.id
		JOIN entries e ON e.id = ee.entry_id AND e.deleted_at IS NULL
		WHERE en.id = ?
		GROUP BY en.id`, id).Scan(
		&summary.ID, &summary.Kind, &summary.Name, &summary.Icon, &summary.Entries, &summary.Mentions, &summary.Sentiment, &lastSeen)
	if err == sql.ErrNoRows {
		return EntitySummary{}, nil, false, nil
	}
	if err != nil {
		return EntitySummary{}, nil, false, fmt.Errorf("store: get entity: %w", err)
	}
	summary.LastSeen = parseTS(lastSeen)

	rows, err := s.db.QueryContext(ctx, `
		SELECT e.id, COALESCE(e.title,''), COALESCE(e.recorded_at, e.created_at), ee.count
		FROM entry_entities ee
		JOIN entries e ON e.id = ee.entry_id AND e.deleted_at IS NULL
		WHERE ee.entity_id = ?
		ORDER BY e.created_at DESC`, id)
	if err != nil {
		return EntitySummary{}, nil, false, fmt.Errorf("store: list entity entries: %w", err)
	}
	defer rows.Close()
	var entries []EntityEntry
	for rows.Next() {
		var entry EntityEntry
		var date string
		if err := rows.Scan(&entry.EntryID, &entry.Title, &date, &entry.Count); err != nil {
			return EntitySummary{}, nil, false, fmt.Errorf("store: scan entity entry: %w", err)
		}
		entry.Date = parseTS(date)
		entries = append(entries, entry)
	}
	return summary, entries, true, rows.Err()
}

// EntityAliases returns the old spellings registered for an entity after a
// rename or merge. The current name is not included; callers already have it.
func (s *Store) EntityAliases(ctx context.Context, entityID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT name FROM entity_aliases WHERE entity_id = ? ORDER BY created_at`, entityID)
	if err != nil {
		return nil, fmt.Errorf("store: entity aliases: %w", err)
	}
	defer rows.Close()
	var aliases []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("store: scan entity alias: %w", err)
		}
		if name != "" {
			aliases = append(aliases, name)
		}
	}
	return aliases, rows.Err()
}

// MoodSeries returns the daily average sentiment, optionally bounded by from
// and to (zero values mean unbounded).
func (s *Store) MoodSeries(ctx context.Context, from, to time.Time) ([]MoodPoint, error) {
	query := `
		SELECT substr(COALESCE(e.recorded_at, e.created_at), 1, 10) AS day,
			COALESCE(AVG(a.sentiment), 0), COUNT(DISTINCT a.entry_id)
		FROM analyses a
		JOIN entries e ON e.id = a.entry_id AND e.deleted_at IS NULL
		WHERE 1 = 1`
	var args []any
	if !from.IsZero() {
		query += ` AND COALESCE(e.recorded_at, e.created_at) >= ?`
		args = append(args, ts(from))
	}
	if !to.IsZero() {
		query += ` AND COALESCE(e.recorded_at, e.created_at) <= ?`
		args = append(args, ts(to))
	}
	query += ` GROUP BY day ORDER BY day`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: mood series: %w", err)
	}
	defer rows.Close()
	var out []MoodPoint
	for rows.Next() {
		var point MoodPoint
		if err := rows.Scan(&point.Date, &point.Sentiment, &point.Entries); err != nil {
			return nil, fmt.Errorf("store: scan mood point: %w", err)
		}
		out = append(out, point)
	}
	return out, rows.Err()
}

// EntityNameKey is the lookup key used by EntityNameMap.
func EntityNameKey(kind, name string) string {
	return kind + "\x00" + strings.ToLower(strings.TrimSpace(name))
}

// CanonicalEntityName resolves a name through the entity table and its alias
// index. Without a match it returns the original name, which is what a new
// extraction should keep until the user names it.
func CanonicalEntityName(names map[string]string, kind, name string) string {
	if resolved, ok := names[EntityNameKey(kind, name)]; ok {
		return resolved
	}
	return name
}

// EntityNameMap maps every canonical name and old alias to the current display
// name. It is the read-side resolver that makes a rename appear in all notes
// without duplicating people in a second table.
func (s *Store) EntityNameMap(ctx context.Context) (map[string]string, error) {
	out := map[string]string{}
	rows, err := s.db.QueryContext(ctx, `SELECT kind, name FROM entities`)
	if err != nil {
		return nil, fmt.Errorf("store: entity name map: %w", err)
	}
	for rows.Next() {
		var kind, name string
		if err := rows.Scan(&kind, &name); err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: scan entity name: %w", err)
		}
		out[EntityNameKey(kind, name)] = name
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	aliasRows, err := s.db.QueryContext(ctx,
		`SELECT a.kind, a.name, e.name FROM entity_aliases a JOIN entities e ON e.id = a.entity_id`)
	if err != nil {
		return nil, fmt.Errorf("store: entity alias map: %w", err)
	}
	for aliasRows.Next() {
		var kind, alias, canonical string
		if err := aliasRows.Scan(&kind, &alias, &canonical); err != nil {
			return nil, fmt.Errorf("store: scan entity alias: %w", err)
		}
		key := EntityNameKey(kind, alias)
		// O nome canonico vence se a mesma grafia existir nos dois lados.
		if _, exists := out[key]; !exists {
			out[key] = canonical
		}
	}
	if err := aliasRows.Err(); err != nil {
		return nil, err
	}
	if err := aliasRows.Close(); err != nil {
		return nil, err
	}

	// Grafias que o dono marcou como "sou eu" apontam para o nome atual das
	// configuracoes, mesmo que uma analise futura volte a extrair a pessoa com
	// o nome antigo.
	owner, err := ownerDisplayName(ctx, s.db)
	if err != nil {
		return nil, err
	}
	out[EntityNameKey(EntityPerson, owner)] = owner
	ownerRows, err := s.db.QueryContext(ctx, `SELECT name FROM owner_aliases`)
	if err != nil {
		return nil, fmt.Errorf("store: owner aliases: %w", err)
	}
	defer ownerRows.Close()
	for ownerRows.Next() {
		var alias string
		if err := ownerRows.Scan(&alias); err != nil {
			return nil, fmt.Errorf("store: scan owner alias: %w", err)
		}
		out[EntityNameKey(EntityPerson, alias)] = owner
	}
	return out, ownerRows.Err()
}

// EntityNamePair is one old spelling and its canonical display name.
type EntityNamePair struct {
	Old string
	New string
}

// EntityAliasPairs lists the renames used to resolve names in free text (the
// analysis summary/reading). Structured names use EntityNameMap; this is only
// for prose that mentions a person/place/theme/decision by its old spelling.
func (s *Store) EntityAliasPairs(ctx context.Context) ([]EntityNamePair, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.name, e.name
		FROM entity_aliases a
		JOIN entities e ON e.id = a.entity_id
		ORDER BY length(a.name) DESC`)
	if err != nil {
		return nil, fmt.Errorf("store: entity alias pairs: %w", err)
	}
	var out []EntityNamePair
	for rows.Next() {
		var pair EntityNamePair
		if err := rows.Scan(&pair.Old, &pair.New); err != nil {
			return nil, fmt.Errorf("store: scan entity alias pair: %w", err)
		}
		out = append(out, pair)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	owner, err := ownerDisplayName(ctx, s.db)
	if err != nil {
		return nil, err
	}
	ownerRows, err := s.db.QueryContext(ctx, `SELECT name FROM owner_aliases`)
	if err != nil {
		return nil, fmt.Errorf("store: owner alias pairs: %w", err)
	}
	defer ownerRows.Close()
	for ownerRows.Next() {
		var alias string
		if err := ownerRows.Scan(&alias); err != nil {
			return nil, fmt.Errorf("store: scan owner alias pair: %w", err)
		}
		out = append(out, EntityNamePair{Old: alias, New: owner})
	}
	if err := ownerRows.Err(); err != nil {
		return nil, err
	}
	// Grafias maiores primeiro: "Jose Guilherme" precisa vencer "Jose" no texto.
	sort.SliceStable(out, func(i, j int) bool {
		return len([]rune(out[i].Old)) > len([]rune(out[j].Old))
	})
	return out, nil
}
