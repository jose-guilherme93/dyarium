package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrInvalidEntity is returned when a rename has an empty or unsupported name.
var ErrInvalidEntity = errors.New("store: entidade invalida")

// RenameEntity changes the display name of one entity. If the new name already
// belongs to another entity of the same kind, the two are merged: links are
// summed and the old name becomes an alias of the survivor. The old name is
// also kept as an alias when there is no merge, so future analyses that mention
// "Mariana" resolve to "Marianna" without touching the transcript.
func (s *Store) RenameEntity(ctx context.Context, kind, oldName, newName string) (EntitySummary, error) {
	kind = strings.TrimSpace(kind)
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if !ValidEntityKind(kind) || oldName == "" || newName == "" {
		return EntitySummary{}, ErrInvalidEntity
	}
	if len([]rune(newName)) > 200 {
		return EntitySummary{}, ErrInvalidEntity
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return EntitySummary{}, fmt.Errorf("store: rename entity: %w", err)
	}
	defer tx.Rollback()

	sourceID, found, err := entityIDByName(ctx, tx, kind, oldName)
	if err != nil {
		return EntitySummary{}, err
	}
	if !found {
		return EntitySummary{}, ErrNotFound
	}

	targetID, found, err := entityIDByName(ctx, tx, kind, newName)
	if err != nil {
		return EntitySummary{}, err
	}
	switch {
	case !found || targetID == sourceID:
		if _, err := tx.ExecContext(ctx, `UPDATE entities SET name = ?, updated_at = ? WHERE id = ?`, newName, ts(now), sourceID); err != nil {
			return EntitySummary{}, fmt.Errorf("store: rename entity name: %w", err)
		}
		if !strings.EqualFold(oldName, newName) {
			if err := addEntityAlias(ctx, tx, kind, oldName, sourceID, now); err != nil {
				return EntitySummary{}, err
			}
		}
		targetID = sourceID
	default:
		if err := mergeEntity(ctx, tx, sourceID, targetID, now); err != nil {
			return EntitySummary{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE entities SET updated_at = ? WHERE id = ?`, ts(now), targetID); err != nil {
			return EntitySummary{}, fmt.Errorf("store: touch merged entity: %w", err)
		}
		if err := addEntityAlias(ctx, tx, kind, oldName, targetID, now); err != nil {
			return EntitySummary{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return EntitySummary{}, fmt.Errorf("store: rename entity: %w", err)
	}
	summary, _, ok, err := s.GetEntity(ctx, kind, newName)
	if err != nil {
		return EntitySummary{}, err
	}
	if !ok {
		return EntitySummary{}, ErrNotFound
	}
	return summary, nil
}

// mergeEntity moves every link and alias from source to target, sums the counts
// and removes the empty source entity.
func mergeEntity(ctx context.Context, tx *sql.Tx, sourceID, targetID string, now time.Time) error {
	type link struct {
		entryID   string
		count     int
		relation  sql.NullString
		sentiment sql.NullFloat64
	}
	rows, err := tx.QueryContext(ctx,
		`SELECT entry_id, count, relation, sentiment FROM entry_entities WHERE entity_id = ?`, sourceID)
	if err != nil {
		return fmt.Errorf("store: merge entity links: %w", err)
	}
	var links []link
	for rows.Next() {
		var l link
		if err := rows.Scan(&l.entryID, &l.count, &l.relation, &l.sentiment); err != nil {
			rows.Close()
			return fmt.Errorf("store: scan merge link: %w", err)
		}
		links = append(links, l)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, l := range links {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (entry_id, entity_id) DO UPDATE SET
				count = count + excluded.count,
				relation = COALESCE(relation, excluded.relation),
				sentiment = COALESCE(sentiment, excluded.sentiment)`,
			l.entryID, targetID, l.count, l.relation, l.sentiment, ts(now)); err != nil {
			return fmt.Errorf("store: merge link: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entry_entities WHERE entity_id = ?`, sourceID); err != nil {
		return fmt.Errorf("store: clear merged links: %w", err)
	}

	// O icone personalizado sobrevive quando o alvo ainda usa o do tipo.
	if _, err := tx.ExecContext(ctx, `
		UPDATE entities SET icon = (SELECT icon FROM entities WHERE id = ?)
		WHERE id = ? AND icon = '' AND (SELECT icon FROM entities WHERE id = ?) <> ''`,
		sourceID, targetID, sourceID); err != nil {
		return fmt.Errorf("store: merge entity icon: %w", err)
	}

	// Move the source aliases before deleting the source (FK cascade would take
	// them). A name already used by the target is ignored; both point to the
	// same survivor.
	aliasRows, err := tx.QueryContext(ctx,
		`SELECT kind, name FROM entity_aliases WHERE entity_id = ?`, sourceID)
	if err != nil {
		return fmt.Errorf("store: merge aliases: %w", err)
	}
	var aliases []struct{ kind, name string }
	for aliasRows.Next() {
		var a struct{ kind, name string }
		if err := aliasRows.Scan(&a.kind, &a.name); err != nil {
			aliasRows.Close()
			return err
		}
		aliases = append(aliases, a)
	}
	if err := aliasRows.Err(); err != nil {
		aliasRows.Close()
		return err
	}
	if err := aliasRows.Close(); err != nil {
		return err
	}
	for _, a := range aliases {
		if err := addEntityAlias(ctx, tx, a.kind, a.name, targetID, now); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entity_aliases WHERE entity_id = ?`, sourceID); err != nil {
		return fmt.Errorf("store: clear merged aliases: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entities WHERE id = ?`, sourceID); err != nil {
		return fmt.Errorf("store: delete merged entity: %w", err)
	}
	return nil
}

func addEntityAlias(ctx context.Context, ex execer, kind, name, entityID string, now time.Time) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	if _, err := ex.ExecContext(ctx, `
		INSERT INTO entity_aliases (id, entity_id, kind, name, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT DO UPDATE SET entity_id = excluded.entity_id`,
		newID(), entityID, kind, name, ts(now)); err != nil {
		return fmt.Errorf("store: alias de entidade: %w", err)
	}
	return nil
}

// ClaimPersonAsOwner folds a person into the diarist. The duplicate entity stops
// existing as a node: every spelling it had becomes an owner alias, so analyses
// written before or after the merge resolve those names to the owner name from
// settings. The map center is the only representation of the diarist.
func (s *Store) ClaimPersonAsOwner(ctx context.Context, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", ErrInvalidEntity
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("store: claim person: %w", err)
	}
	defer tx.Rollback()

	id, found, err := entityIDByName(ctx, tx, EntityPerson, name)
	if err != nil {
		return "", err
	}
	if !found {
		return "", ErrNotFound
	}

	var canonical string
	if err := tx.QueryRowContext(ctx, `SELECT name FROM entities WHERE id = ?`, id).Scan(&canonical); err != nil {
		return "", fmt.Errorf("store: claim person name: %w", err)
	}
	names := []string{canonical}
	aliasRows, err := tx.QueryContext(ctx, `SELECT name FROM entity_aliases WHERE entity_id = ?`, id)
	if err != nil {
		return "", fmt.Errorf("store: claim person aliases: %w", err)
	}
	for aliasRows.Next() {
		var alias string
		if err := aliasRows.Scan(&alias); err != nil {
			aliasRows.Close()
			return "", fmt.Errorf("store: scan claim alias: %w", err)
		}
		names = append(names, alias)
	}
	if err := aliasRows.Err(); err != nil {
		aliasRows.Close()
		return "", err
	}
	if err := aliasRows.Close(); err != nil {
		return "", err
	}

	now := time.Now().UTC()
	for _, alias := range names {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO owner_aliases (name, created_at, updated_at) VALUES (?, ?, ?)
			ON CONFLICT (name) DO UPDATE SET updated_at = excluded.updated_at`, alias, ts(now), ts(now)); err != nil {
			return "", fmt.Errorf("store: owner alias: %w", err)
		}
	}
	// As ligacoes e os aliases da entidade saem junto (ON DELETE CASCADE): o
	// nome antigo passa a ser o dono, nao um segundo no no mapa.
	if _, err := tx.ExecContext(ctx, `DELETE FROM entities WHERE id = ?`, id); err != nil {
		return "", fmt.Errorf("store: delete claimed person: %w", err)
	}
	owner, err := ownerDisplayName(ctx, tx)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("store: claim person: %w", err)
	}
	return owner, nil
}

// SetEntityIcon stores the monochrome icon key a node should draw. An empty key
// clears the custom icon and goes back to the kind icon. The drawing lives in
// the clients; the store only validates the key.
func (s *Store) SetEntityIcon(ctx context.Context, kind, name, icon string) (EntitySummary, error) {
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	icon = strings.TrimSpace(icon)
	if !ValidEntityKind(kind) || name == "" || (icon != "" && !ValidGraphIcon(icon)) {
		return EntitySummary{}, ErrInvalidEntity
	}
	id, found, err := entityIDByName(ctx, s.db, kind, name)
	if err != nil {
		return EntitySummary{}, err
	}
	if !found {
		return EntitySummary{}, ErrNotFound
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE entities SET icon = ?, updated_at = ? WHERE id = ?`, icon, ts(time.Now()), id); err != nil {
		return EntitySummary{}, fmt.Errorf("store: set entity icon: %w", err)
	}
	summary, _, ok, err := s.GetEntity(ctx, kind, name)
	if err != nil {
		return EntitySummary{}, err
	}
	if !ok {
		return EntitySummary{}, ErrNotFound
	}
	return summary, nil
}

// SetEntityLabel stores the free display label of one entity (escola, gata,
// personagem). Empty clears it. The label is display-only: it does not change
// the kind, the metrics or the sync key.
func (s *Store) SetEntityLabel(ctx context.Context, kind, name, label string) (EntitySummary, error) {
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	label = strings.TrimSpace(label)
	if !ValidEntityKind(kind) || name == "" || len([]rune(label)) > 80 {
		return EntitySummary{}, ErrInvalidEntity
	}
	id, found, err := entityIDByName(ctx, s.db, kind, name)
	if err != nil {
		return EntitySummary{}, err
	}
	if !found {
		return EntitySummary{}, ErrNotFound
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE entities SET label = ?, updated_at = ? WHERE id = ?`,
		label, ts(time.Now().UTC()), id); err != nil {
		return EntitySummary{}, fmt.Errorf("store: set entity label: %w", err)
	}
	summary, _, ok, err := s.GetEntity(ctx, kind, name)
	if err != nil {
		return EntitySummary{}, err
	}
	if !ok {
		return EntitySummary{}, ErrNotFound
	}
	return summary, nil
}

// ChangeEntityKind moves an entity to another kind. When the target kind
// already has the same name (or one of its aliases), the two are merged: links
// and aliases move to the survivor. Otherwise the entity changes kind and its
// aliases move with it. The old kind is always recorded as a rejection, so a
// future analysis does not recreate the entity there.
func (s *Store) ChangeEntityKind(ctx context.Context, kind, name, newKind string) (EntitySummary, error) {
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	newKind = strings.TrimSpace(newKind)
	if !ValidEntityKind(kind) || !ValidEntityKind(newKind) || name == "" || kind == newKind {
		return EntitySummary{}, ErrInvalidEntity
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return EntitySummary{}, fmt.Errorf("store: change entity kind: %w", err)
	}
	defer tx.Rollback()

	sourceID, found, err := entityIDByName(ctx, tx, kind, name)
	if err != nil {
		return EntitySummary{}, err
	}
	if !found {
		return EntitySummary{}, ErrNotFound
	}
	var canonical string
	if err := tx.QueryRowContext(ctx, `SELECT name FROM entities WHERE id = ?`, sourceID).Scan(&canonical); err != nil {
		return EntitySummary{}, fmt.Errorf("store: read entity name: %w", err)
	}

	targetID, found, err := entityIDByName(ctx, tx, newKind, name)
	if err != nil {
		return EntitySummary{}, err
	}
	switch {
	case found && targetID != sourceID:
		if err := mergeEntity(ctx, tx, sourceID, targetID, now); err != nil {
			return EntitySummary{}, err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE entities SET updated_at = ? WHERE id = ?`, ts(now), targetID); err != nil {
			return EntitySummary{}, fmt.Errorf("store: touch changed entity: %w", err)
		}
	default:
		if _, err := tx.ExecContext(ctx,
			`UPDATE entities SET kind = ?, updated_at = ? WHERE id = ?`,
			newKind, ts(now), sourceID); err != nil {
			return EntitySummary{}, fmt.Errorf("store: change entity kind: %w", err)
		}
		// Os aliases acompanham o novo tipo: a grafia antiga continua resolvendo
		// para a entidade e nao cria uma segunda no tipo antigo.
		if err := moveEntityAliasesKind(ctx, tx, sourceID, kind, newKind, now); err != nil {
			return EntitySummary{}, err
		}
	}
	if err := upsertEntityRejection(ctx, tx, kind, canonical, now); err != nil {
		return EntitySummary{}, err
	}
	if err := tx.Commit(); err != nil {
		return EntitySummary{}, fmt.Errorf("store: change entity kind: %w", err)
	}
	summary, _, ok, err := s.GetEntity(ctx, newKind, name)
	if err != nil {
		return EntitySummary{}, err
	}
	if !ok {
		return EntitySummary{}, ErrNotFound
	}
	return summary, nil
}

// moveEntityAliasesKind copies the aliases of one entity to the new kind and
// removes the old-kind rows. Insert-or-ignore keeps a spelling that already
// belongs to another entity of the destination kind.
func moveEntityAliasesKind(ctx context.Context, tx *sql.Tx, entityID, oldKind, newKind string, now time.Time) error {
	rows, err := tx.QueryContext(ctx,
		`SELECT name FROM entity_aliases WHERE entity_id = ? AND kind = ? ORDER BY name`,
		entityID, oldKind)
	if err != nil {
		return fmt.Errorf("store: list moved aliases: %w", err)
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return fmt.Errorf("store: scan moved alias: %w", err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, name := range names {
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO entity_aliases (id, entity_id, kind, name, created_at)
			VALUES (?, ?, ?, ?, ?)`,
			newID(), entityID, newKind, name, ts(now)); err != nil {
			return fmt.Errorf("store: move entity alias: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM entity_aliases WHERE entity_id = ? AND kind = ?`, entityID, oldKind); err != nil {
		return fmt.Errorf("store: clear moved aliases: %w", err)
	}
	return nil
}

// DeleteEntity removes an entity, its links and its aliases, and records a
// rejection of its kind so a future analysis never recreates it. The caller may
// snapshot the previous state first to support undo.
func (s *Store) DeleteEntity(ctx context.Context, kind, name string) error {
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	if !ValidEntityKind(kind) || name == "" {
		return ErrInvalidEntity
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: delete entity: %w", err)
	}
	defer tx.Rollback()

	id, found, err := entityIDByName(ctx, tx, kind, name)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	var canonical string
	if err := tx.QueryRowContext(ctx, `SELECT name FROM entities WHERE id = ?`, id).Scan(&canonical); err != nil {
		return fmt.Errorf("store: read deleted entity name: %w", err)
	}
	// A FK em cascata leva vinculos e aliases junto.
	if _, err := tx.ExecContext(ctx, `DELETE FROM entities WHERE id = ?`, id); err != nil {
		return fmt.Errorf("store: delete entity: %w", err)
	}
	if err := upsertEntityRejection(ctx, tx, kind, canonical, now); err != nil {
		return err
	}
	return tx.Commit()
}

// AddEntityRejection records that a name is never an entity of a kind.
func (s *Store) AddEntityRejection(ctx context.Context, kind, name string) error {
	return upsertEntityRejection(ctx, s.db, kind, name, time.Now().UTC())
}

// RemoveEntityRejection releases a rejected name. Removing a missing rejection
// is a no-op: the client may retry it.
func (s *Store) RemoveEntityRejection(ctx context.Context, kind, name string) error {
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	if !ValidEntityKind(kind) || name == "" {
		return ErrInvalidEntity
	}
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM entity_rejections WHERE kind = ? AND name_key = ?`,
		kind, EntityRejectionKey(name)); err != nil {
		return fmt.Errorf("store: remove entity rejection: %w", err)
	}
	return nil
}

// upsertEntityRejection writes or refreshes the rejection of one name. The
// primary key is (kind, name_key), so a new spelling of the same rejected name
// updates the displayed name and the sync clock instead of duplicating it.
func upsertEntityRejection(ctx context.Context, ex execer, kind, name string, now time.Time) error {
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	if !ValidEntityKind(kind) || name == "" {
		return ErrInvalidEntity
	}
	if _, err := ex.ExecContext(ctx, `
		INSERT INTO entity_rejections (kind, name, name_key, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (kind, name_key) DO UPDATE SET
			name = excluded.name,
			updated_at = excluded.updated_at`,
		kind, name, EntityRejectionKey(name), ts(now), ts(now)); err != nil {
		return fmt.Errorf("store: save entity rejection: %w", err)
	}
	return nil
}
