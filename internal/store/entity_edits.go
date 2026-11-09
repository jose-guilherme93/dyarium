package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// ErrEntityEditNotFound is returned when the edit id does not exist (or was
// already undone).
var ErrEntityEditNotFound = errors.New("store: edicao de entidade inexistente")

// ErrEditNotLatest is returned when an older edit is undone while a newer one
// is still standing: reverting it would discard the newer change.
var ErrEditNotLatest = errors.New("store: ha uma edicao mais nova")

// entityEditRetention keeps only the last edits; undo is an immediate action,
// not a version history.
const entityEditRetention = 50

// EntityEdit is the record of a reversible entity mutation.
type EntityEdit struct {
	ID        string
	Action    string
	Label     string
	CreatedAt time.Time
}

type entityEditSnapshot struct {
	Entities   []snapshotEntity    `json:"entities"`
	Aliases    []snapshotAlias     `json:"aliases"`
	Links      []snapshotLink      `json:"links"`
	Owners     []snapshotOwner     `json:"owners"`
	Rejections []snapshotRejection `json:"rejections"`
}

type snapshotEntity struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Label     string `json:"label"`
	Icon      string `json:"icon"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// snapshotRejection captures the rejection of one (kind, name_key) pair. Empty
// timestamps mean the rejection did not exist before the edit; undoing then
// only removes the one the mutation created.
type snapshotRejection struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	NameKey   string `json:"name_key"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type snapshotAlias struct {
	ID        string `json:"id"`
	EntityID  string `json:"entity_id"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

type snapshotLink struct {
	EntryID   string   `json:"entry_id"`
	EntityID  string   `json:"entity_id"`
	Count     int      `json:"count"`
	Relation  *string  `json:"relation,omitempty"`
	Sentiment *float64 `json:"sentiment,omitempty"`
	CreatedAt string   `json:"created_at"`
}

type snapshotOwner struct {
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// EntityPair identifies one entity by kind and canonical name or alias. A kind
// change needs two pairs: the source and the possible merge target.
type EntityPair struct {
	Kind string
	Name string
}

// PrepareEntityEdit stores the current state of the entities named in `names`
// (canonical names or aliases) plus their aliases, links and the owner spelling
// list. It must run before the mutation; the returned id is what the client
// uses to undo. A failure to snapshot is not fatal for the mutation: the caller
// logs and proceeds without undo.
func (s *Store) PrepareEntityEdit(ctx context.Context, action, label, kind string, names ...string) (string, error) {
	kind = strings.TrimSpace(kind)
	if !ValidEntityKind(kind) {
		return "", ErrInvalidEntity
	}
	pairs := make([]EntityPair, 0, len(names))
	for _, name := range names {
		pairs = append(pairs, EntityPair{Kind: kind, Name: name})
	}
	return s.prepareEntityEditPairs(ctx, action, label, pairs)
}

// PrepareEntityEditPairs is PrepareEntityEdit for a mutation that touches more
// than one kind, such as changing an entity's kind: the source and the possible
// merge target are both snapshotted.
func (s *Store) PrepareEntityEditPairs(ctx context.Context, action, label string, pairs ...EntityPair) (string, error) {
	return s.prepareEntityEditPairs(ctx, action, label, pairs)
}

func (s *Store) prepareEntityEditPairs(ctx context.Context, action, label string, pairs []EntityPair) (string, error) {
	snapshot := entityEditSnapshot{Owners: []snapshotOwner{}, Rejections: []snapshotRejection{}}

	ids := make(map[string]struct{})
	cleanPairs := make([]EntityPair, 0, len(pairs))
	for _, pair := range pairs {
		kind := strings.TrimSpace(pair.Kind)
		name := strings.TrimSpace(pair.Name)
		if name == "" {
			continue
		}
		if !ValidEntityKind(kind) {
			return "", ErrInvalidEntity
		}
		cleanPairs = append(cleanPairs, EntityPair{Kind: kind, Name: name})
		id, found, err := entityIDByName(ctx, s.db, kind, name)
		if err != nil {
			return "", err
		}
		if found {
			ids[id] = struct{}{}
		}
	}

	entityIDs := keys(ids)
	if len(entityIDs) > 0 {
		rows, err := s.db.QueryContext(ctx, `
			SELECT id, kind, name, COALESCE(label, ''), COALESCE(icon, ''), created_at, COALESCE(updated_at, '')
			FROM entities WHERE id IN (`+placeholders(len(entityIDs))+`)`, anyArgs(entityIDs)...)
		if err != nil {
			return "", fmt.Errorf("store: snapshot entities: %w", err)
		}
		for rows.Next() {
			var item snapshotEntity
			if err := rows.Scan(&item.ID, &item.Kind, &item.Name, &item.Label, &item.Icon, &item.CreatedAt, &item.UpdatedAt); err != nil {
				rows.Close()
				return "", fmt.Errorf("store: scan snapshot entity: %w", err)
			}
			snapshot.Entities = append(snapshot.Entities, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", err
		}
		if err := rows.Close(); err != nil {
			return "", err
		}
	}

	// Aliases: os das entidades afetadas e os que tenham o nome antigo/novo (a
	// renomeacao pode mover um alias que pertencia a outra entidade).
	var aliasConds []string
	var aliasArgs []any
	if len(entityIDs) > 0 {
		aliasConds = append(aliasConds, "entity_id IN ("+placeholders(len(entityIDs))+")")
		aliasArgs = append(aliasArgs, anyArgs(entityIDs)...)
	}
	for _, pair := range cleanPairs {
		aliasConds = append(aliasConds, "(kind = ? AND name = ?)")
		aliasArgs = append(aliasArgs, pair.Kind, pair.Name)
	}
	if len(aliasConds) > 0 {
		rows, err := s.db.QueryContext(ctx, `
			SELECT id, entity_id, kind, name, created_at
			FROM entity_aliases WHERE `+strings.Join(aliasConds, " OR ")+` ORDER BY created_at`, aliasArgs...)
		if err != nil {
			return "", fmt.Errorf("store: snapshot aliases: %w", err)
		}
		for rows.Next() {
			var item snapshotAlias
			if err := rows.Scan(&item.ID, &item.EntityID, &item.Kind, &item.Name, &item.CreatedAt); err != nil {
				rows.Close()
				return "", fmt.Errorf("store: scan snapshot alias: %w", err)
			}
			snapshot.Aliases = append(snapshot.Aliases, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", err
		}
		if err := rows.Close(); err != nil {
			return "", err
		}
	}

	// Icone nao mexe em vinculo: a foto fica menor e o clique e frequente.
	if len(entityIDs) > 0 && action != "icon" {
		rows, err := s.db.QueryContext(ctx, `
			SELECT entry_id, entity_id, count, relation, sentiment, created_at
			FROM entry_entities WHERE entity_id IN (`+placeholders(len(entityIDs))+`)`, anyArgs(entityIDs)...)
		if err != nil {
			return "", fmt.Errorf("store: snapshot links: %w", err)
		}
		for rows.Next() {
			var item snapshotLink
			var relation sql.NullString
			var sentiment sql.NullFloat64
			if err := rows.Scan(&item.EntryID, &item.EntityID, &item.Count, &relation, &sentiment, &item.CreatedAt); err != nil {
				rows.Close()
				return "", fmt.Errorf("store: scan snapshot link: %w", err)
			}
			if relation.Valid {
				item.Relation = &relation.String
			}
			if sentiment.Valid {
				item.Sentiment = &sentiment.Float64
			}
			snapshot.Links = append(snapshot.Links, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", err
		}
		if err := rows.Close(); err != nil {
			return "", err
		}
	}

	// Rejeicoes afetadas: os pares pedidos, os nomes canonicos do snapshot e os
	// aliases. Captura o estado anterior; um par sem linha vira fantasma, para o
	// desfazer apagar a rejeicao que a mutacao criar.
	rejectionKeys := make(map[rejectionKey]struct{})
	for _, pair := range cleanPairs {
		rejectionKeys[rejectionKey{kind: pair.Kind, nameKey: EntityRejectionKey(pair.Name)}] = struct{}{}
	}
	for _, item := range snapshot.Entities {
		rejectionKeys[rejectionKey{kind: item.Kind, nameKey: EntityRejectionKey(item.Name)}] = struct{}{}
	}
	for _, item := range snapshot.Aliases {
		rejectionKeys[rejectionKey{kind: item.Kind, nameKey: EntityRejectionKey(item.Name)}] = struct{}{}
	}
	rejections, err := snapshotRejections(ctx, s.db, rejectionKeys)
	if err != nil {
		return "", err
	}
	snapshot.Rejections = rejections

	ownerRows, err := s.db.QueryContext(ctx,
		`SELECT name, created_at, COALESCE(updated_at, '') FROM owner_aliases ORDER BY name`)
	if err != nil {
		return "", fmt.Errorf("store: snapshot owners: %w", err)
	}
	for ownerRows.Next() {
		var item snapshotOwner
		if err := ownerRows.Scan(&item.Name, &item.CreatedAt, &item.UpdatedAt); err != nil {
			ownerRows.Close()
			return "", fmt.Errorf("store: scan snapshot owner: %w", err)
		}
		snapshot.Owners = append(snapshot.Owners, item)
	}
	if err := ownerRows.Err(); err != nil {
		ownerRows.Close()
		return "", err
	}
	if err := ownerRows.Close(); err != nil {
		return "", err
	}

	raw, err := json.Marshal(snapshot)
	if err != nil {
		return "", fmt.Errorf("store: snapshot json: %w", err)
	}
	editID := newID()
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO entity_edits (id, action, label, snapshot, created_at)
		VALUES (?, ?, ?, ?, ?)`, editID, action, label, string(raw), ts(now)); err != nil {
		return "", fmt.Errorf("store: save entity edit: %w", err)
	}
	// Mantem so as ultimas edicoes: desfazer e uma acao imediata.
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM entity_edits WHERE id NOT IN (
			SELECT id FROM entity_edits ORDER BY created_at DESC, rowid DESC LIMIT ?
		)`, entityEditRetention); err != nil {
		return "", fmt.Errorf("store: prune entity edits: %w", err)
	}
	return editID, nil
}

// DiscardEntityEdit removes a snapshot whose mutation failed. Best-effort: a
// leftover snapshot only restores the state it already had.
func (s *Store) DiscardEntityEdit(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return nil
	}
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM entity_edits WHERE id = ? AND undone_at IS NULL`, id); err != nil {
		return fmt.Errorf("store: discard entity edit: %w", err)
	}
	return nil
}

// UndoEntityEdit restores the state captured before the edit. Only the latest
// standing edit can be undone; an older one would discard a newer change.
func (s *Store) UndoEntityEdit(ctx context.Context, id string) (EntityEdit, error) {
	var edit EntityEdit
	var snapshotRaw, createdAt string
	var undone sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT action, label, snapshot, created_at, undone_at
		FROM entity_edits WHERE id = ?`, id).Scan(
		&edit.Action, &edit.Label, &snapshotRaw, &createdAt, &undone)
	if errors.Is(err, sql.ErrNoRows) {
		return EntityEdit{}, ErrEntityEditNotFound
	}
	if err != nil {
		return EntityEdit{}, fmt.Errorf("store: read entity edit: %w", err)
	}
	if undone.Valid {
		return EntityEdit{}, ErrEntityEditNotFound
	}
	var snapshot entityEditSnapshot
	if err := json.Unmarshal([]byte(snapshotRaw), &snapshot); err != nil {
		return EntityEdit{}, fmt.Errorf("store: decode entity edit: %w", err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return EntityEdit{}, fmt.Errorf("store: undo entity edit: %w", err)
	}
	defer tx.Rollback()

	var latest string
	if err := tx.QueryRowContext(ctx, `
		SELECT id FROM entity_edits WHERE undone_at IS NULL
		ORDER BY created_at DESC, rowid DESC LIMIT 1`).Scan(&latest); err != nil {
		return EntityEdit{}, fmt.Errorf("store: latest entity edit: %w", err)
	}
	if latest != id {
		return EntityEdit{}, ErrEditNotLatest
	}

	entityIDs := make([]string, 0, len(snapshot.Entities))
	for _, item := range snapshot.Entities {
		entityIDs = append(entityIDs, item.ID)
	}
	aliasIDs := make([]string, 0, len(snapshot.Aliases))
	for _, item := range snapshot.Aliases {
		aliasIDs = append(aliasIDs, item.ID)
	}
	now := time.Now().UTC()

	if edit.Action == "icon" {
		// Icone nao apaga entidade nem vinculos: so o glifo volta ao anterior.
		for _, item := range snapshot.Entities {
			if _, err := tx.ExecContext(ctx,
				`UPDATE entities SET icon = ?, updated_at = ? WHERE id = ?`,
				item.Icon, ts(now), item.ID); err != nil {
				return EntityEdit{}, fmt.Errorf("store: restore icon: %w", err)
			}
		}
	} else {
		// Apaga o estado atual dos mesmos ids. Aliases sao apagados tambem pelo id:
		// uma renomeacao pode ter movido um alias de outra entidade.
		if len(aliasIDs) > 0 || len(entityIDs) > 0 {
			var conds []string
			var args []any
			if len(entityIDs) > 0 {
				conds = append(conds, "entity_id IN ("+placeholders(len(entityIDs))+")")
				args = append(args, anyArgs(entityIDs)...)
			}
			if len(aliasIDs) > 0 {
				conds = append(conds, "id IN ("+placeholders(len(aliasIDs))+")")
				args = append(args, anyArgs(aliasIDs)...)
			}
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM entity_aliases WHERE `+strings.Join(conds, " OR "), args...); err != nil {
				return EntityEdit{}, fmt.Errorf("store: undo aliases: %w", err)
			}
		}
		if len(entityIDs) > 0 {
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM entry_entities WHERE entity_id IN (`+placeholders(len(entityIDs))+`)`,
				anyArgs(entityIDs)...); err != nil {
				return EntityEdit{}, fmt.Errorf("store: undo links: %w", err)
			}
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM entities WHERE id IN (`+placeholders(len(entityIDs))+`)`,
				anyArgs(entityIDs)...); err != nil {
				return EntityEdit{}, fmt.Errorf("store: undo entities: %w", err)
			}
		}

		// O desfazer e uma mudanca nova: o carimbo sobe para agora, senao outro
		// aparelho que ainda tem o nome errado (mais novo que a foto) venceria a
		// comparacao e empurraria a edicao de volta.
		for _, item := range snapshot.Entities {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO entities (id, kind, name, label, icon, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
				item.ID, item.Kind, item.Name, item.Label, item.Icon, item.CreatedAt, ts(now)); err != nil {
				return EntityEdit{}, fmt.Errorf("store: restore entity: %w", err)
			}
		}
		for _, item := range snapshot.Aliases {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO entity_aliases (id, entity_id, kind, name, created_at)
				VALUES (?, ?, ?, ?, ?)`,
				item.ID, item.EntityID, item.Kind, item.Name, item.CreatedAt); err != nil {
				return EntityEdit{}, fmt.Errorf("store: restore alias: %w", err)
			}
		}
		for _, item := range snapshot.Links {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
				item.EntryID, item.EntityID, item.Count, nullStringPtr(item.Relation),
				nullFloatPtr(item.Sentiment), item.CreatedAt); err != nil {
				return EntityEdit{}, fmt.Errorf("store: restore link: %w", err)
			}
		}

		if _, err := tx.ExecContext(ctx, `DELETE FROM owner_aliases`); err != nil {
			return EntityEdit{}, fmt.Errorf("store: undo owner aliases: %w", err)
		}
		for _, item := range snapshot.Owners {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO owner_aliases (name, created_at, updated_at) VALUES (?, ?, ?)`,
				item.Name, item.CreatedAt, ts(now)); err != nil {
				return EntityEdit{}, fmt.Errorf("store: restore owner alias: %w", err)
			}
		}

		// Rejeicoes: apaga o estado atual dos name_keys da foto e devolve o que
		// existia antes. Um par fantasma (sem timestamps) so apaga a rejeicao que
		// a mutacao criou.
		if err := restoreEntityRejections(ctx, tx, snapshot.Rejections); err != nil {
			return EntityEdit{}, err
		}
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE entity_edits SET undone_at = ? WHERE id = ?`, ts(now), id); err != nil {
		return EntityEdit{}, fmt.Errorf("store: mark entity edit undone: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return EntityEdit{}, fmt.Errorf("store: undo entity edit: %w", err)
	}
	edit.ID = id
	edit.CreatedAt = parseTS(createdAt)
	return edit, nil
}

// snapshotRejections reads the current rejection rows of the affected keys. A
// key without a row becomes a phantom entry, so undoing a delete or a kind
// change removes the rejection that mutation created even when none existed.
func snapshotRejections(ctx context.Context, ex execer, keys map[rejectionKey]struct{}) ([]snapshotRejection, error) {
	out := make([]snapshotRejection, 0, len(keys))
	if len(keys) == 0 {
		return out, nil
	}
	ordered := make([]rejectionKey, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].kind != ordered[j].kind {
			return ordered[i].kind < ordered[j].kind
		}
		return ordered[i].nameKey < ordered[j].nameKey
	})
	conds := make([]string, 0, len(ordered))
	args := make([]any, 0, len(ordered)*2)
	for _, key := range ordered {
		conds = append(conds, "(kind = ? AND name_key = ?)")
		args = append(args, key.kind, key.nameKey)
	}
	rows, err := ex.QueryContext(ctx, `
		SELECT kind, name, name_key, created_at, COALESCE(updated_at, '')
		FROM entity_rejections WHERE `+strings.Join(conds, " OR ")+`
		ORDER BY kind, name_key`, args...)
	if err != nil {
		return nil, fmt.Errorf("store: snapshot rejections: %w", err)
	}
	found := make(map[rejectionKey]bool)
	for rows.Next() {
		var item snapshotRejection
		if err := rows.Scan(&item.Kind, &item.Name, &item.NameKey, &item.CreatedAt, &item.UpdatedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: scan snapshot rejection: %w", err)
		}
		found[rejectionKey{kind: item.Kind, nameKey: item.NameKey}] = true
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for _, key := range ordered {
		if !found[key] {
			out = append(out, snapshotRejection{Kind: key.kind, NameKey: key.nameKey})
		}
	}
	return out, nil
}

// restoreEntityRejections removes the current rows of every captured name_key
// and reinserts the ones that existed before. Empty timestamps are the phantom
// entries: they only remove the row created by the mutation.
func restoreEntityRejections(ctx context.Context, tx *sql.Tx, items []snapshotRejection) error {
	if len(items) == 0 {
		return nil
	}
	conds := make([]string, 0, len(items))
	args := make([]any, 0, len(items)*2)
	seen := make(map[rejectionKey]bool, len(items))
	for _, item := range items {
		key := rejectionKey{kind: item.Kind, nameKey: item.NameKey}
		if seen[key] {
			continue
		}
		seen[key] = true
		conds = append(conds, "(kind = ? AND name_key = ?)")
		args = append(args, item.Kind, item.NameKey)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM entity_rejections WHERE `+strings.Join(conds, " OR "), args...); err != nil {
		return fmt.Errorf("store: undo rejections: %w", err)
	}
	for _, item := range items {
		if item.CreatedAt == "" {
			continue
		}
		updatedAt := item.UpdatedAt
		if updatedAt == "" {
			updatedAt = item.CreatedAt
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO entity_rejections (kind, name, name_key, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)`,
			item.Kind, item.Name, item.NameKey, item.CreatedAt, updatedAt); err != nil {
			return fmt.Errorf("store: restore rejection: %w", err)
		}
	}
	return nil
}

func anyArgs(values []string) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

func keys(values map[string]struct{}) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	return out
}

func nullStringPtr(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullFloatPtr(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}
