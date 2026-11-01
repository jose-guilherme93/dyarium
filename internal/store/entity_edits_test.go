package store

import (
	"context"
	"testing"
	"time"
)

func linksOf(t *testing.T, s *Store, name string) map[string]int {
	t.Helper()
	id, found, err := entityIDByName(context.Background(), s.db, EntityPerson, name)
	if err != nil || !found {
		return nil
	}
	rows, err := s.db.QueryContext(context.Background(),
		`SELECT entry_id, count FROM entry_entities WHERE entity_id = ?`, id)
	if err != nil {
		t.Fatalf("links: %v", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var entry string
		var count int
		if err := rows.Scan(&entry, &count); err != nil {
			t.Fatalf("scan link: %v", err)
		}
		out[entry] = count
	}
	return out
}

func TestUndoRenameRestoresNameAndAlias(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 3})

	editID, err := s.PrepareEntityEdit(ctx, "rename", "Maria -> Mariana", EntityPerson, "Maria", "Mariana")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := s.RenameEntity(ctx, EntityPerson, "Maria", "Mariana"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := s.UndoEntityEdit(ctx, editID); err != nil {
		t.Fatalf("undo: %v", err)
	}

	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Maria" || people[0].Mentions != 3 {
		t.Fatalf("depois do desfazer: %+v", people)
	}
	names, err := s.EntityNameMap(ctx)
	if err != nil {
		t.Fatalf("name map: %v", err)
	}
	if got := names[EntityNameKey(EntityPerson, "Mariana")]; got != "" {
		t.Fatalf("alias do nome errado ficou: %q", got)
	}
}

func TestUndoMergeRestoresBothEntitiesAndCounts(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)
	saveEntities(t, s, "e1",
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2},
		EntityLink{Kind: EntityPerson, Name: "Mariana", Count: 3},
	)
	saveEntities(t, s, "e2", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 4})

	editID, err := s.PrepareEntityEdit(ctx, "merge", "Maria -> Mariana", EntityPerson, "Maria", "Mariana")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := s.RenameEntity(ctx, EntityPerson, "Maria", "Mariana"); err != nil {
		t.Fatalf("merge: %v", err)
	}
	if got := linksOf(t, s, "Mariana"); got["e1"] != 5 || got["e2"] != 4 {
		t.Fatalf("depois da mescla: %+v", got)
	}

	if _, err := s.UndoEntityEdit(ctx, editID); err != nil {
		t.Fatalf("undo: %v", err)
	}
	if got := linksOf(t, s, "Maria"); got["e1"] != 2 || got["e2"] != 4 {
		t.Fatalf("Maria depois do desfazer: %+v", got)
	}
	if got := linksOf(t, s, "Mariana"); got["e1"] != 3 || len(got) != 1 {
		t.Fatalf("Mariana depois do desfazer: %+v", got)
	}
}

func TestUndoClaimRestoresPersonAndOwnerAliases(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	if err := s.SetSetting(ctx, "owner_name", "Joseti"); err != nil {
		t.Fatalf("owner name: %v", err)
	}
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "eu", Count: 2})

	editID, err := s.PrepareEntityEdit(ctx, "self", "eu", EntityPerson, "eu")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := s.ClaimPersonAsOwner(ctx, "eu"); err != nil {
		t.Fatalf("claim: %v", err)
	}
	if _, err := s.UndoEntityEdit(ctx, editID); err != nil {
		t.Fatalf("undo: %v", err)
	}

	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(people) != 1 || people[0].Name != "eu" || people[0].Mentions != 2 {
		t.Fatalf("pessoa depois do desfazer: %+v", people)
	}
	aliases, err := s.ListOwnerAliases(ctx)
	if err != nil {
		t.Fatalf("owner aliases: %v", err)
	}
	for _, alias := range aliases {
		if alias == "eu" {
			t.Fatalf("owner alias nao voltou atras: %+v", aliases)
		}
	}
}

func TestUndoIconRestoresPreviousGlyph(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPlace, Name: "Praia", Count: 1})

	editID, err := s.PrepareEntityEdit(ctx, "icon", "Praia", EntityPlace, "Praia")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := s.SetEntityIcon(ctx, EntityPlace, "Praia", "sun"); err != nil {
		t.Fatalf("icon: %v", err)
	}
	if _, err := s.UndoEntityEdit(ctx, editID); err != nil {
		t.Fatalf("undo: %v", err)
	}
	summary, _, ok, err := s.GetEntity(ctx, EntityPlace, "Praia")
	if err != nil || !ok {
		t.Fatalf("get entity: %v", err)
	}
	if summary.Icon != "" {
		t.Fatalf("icone depois do desfazer = %q", summary.Icon)
	}
}

func TestUndoOnlyTheLatestEdit(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1",
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 1},
		EntityLink{Kind: EntityPerson, Name: "Ana", Count: 1},
	)

	first, err := s.PrepareEntityEdit(ctx, "rename", "Maria -> Maria II", EntityPerson, "Maria", "Maria II")
	if err != nil {
		t.Fatalf("prepare 1: %v", err)
	}
	if _, err := s.RenameEntity(ctx, EntityPerson, "Maria", "Maria II"); err != nil {
		t.Fatalf("rename 1: %v", err)
	}
	if _, err := s.PrepareEntityEdit(ctx, "rename", "Ana -> Ana II", EntityPerson, "Ana", "Ana II"); err != nil {
		t.Fatalf("prepare 2: %v", err)
	}
	if _, err := s.RenameEntity(ctx, EntityPerson, "Ana", "Ana II"); err != nil {
		t.Fatalf("rename 2: %v", err)
	}

	if _, err := s.UndoEntityEdit(ctx, first); err != ErrEditNotLatest {
		t.Fatalf("desfazer edicao antiga = %v, want ErrEditNotLatest", err)
	}
}

func TestDiscardedEditCannotBeUndone(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	id, err := s.PrepareEntityEdit(ctx, "rename", "x", EntityPerson, "Ninguem")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if err := s.DiscardEntityEdit(ctx, id); err != nil {
		t.Fatalf("discard: %v", err)
	}
	if _, err := s.UndoEntityEdit(ctx, id); err != ErrEntityEditNotFound {
		t.Fatalf("desfazer descartada = %v, want ErrEntityEditNotFound", err)
	}
}
