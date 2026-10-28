package store

import (
	"context"
	"testing"
	"time"
)

func TestRenameEntityKeepsAlias(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 3})
	saveEntities(t, s, "e2", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2})

	summary, err := s.RenameEntity(ctx, EntityPerson, "Maria", "Marianna")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if summary.Name != "Marianna" || summary.Mentions != 5 || summary.Entries != 2 {
		t.Fatalf("resumo depois do rename = %+v", summary)
	}
	// O nome antigo continua resolvendo para a mesma entidade.
	old, entries, found, err := s.GetEntity(ctx, EntityPerson, "maria")
	if err != nil || !found {
		t.Fatalf("alias: found=%v err=%v", found, err)
	}
	if old.Name != "Marianna" || len(entries) != 2 {
		t.Fatalf("alias devolveu %+v / %d notas", old, len(entries))
	}

	// Uma analise futura que ainda diz "Maria" cai na mesma entidade.
	seedEntry(t, s, "e3", now)
	saveEntities(t, s, "e3", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 1})
	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Marianna" || people[0].Mentions != 6 {
		t.Fatalf("alias nao foi aplicado na analise: %+v", people)
	}
}

func TestRenameEntityMergesExistingTarget(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 3})
	saveEntities(t, s, "e2", EntityLink{Kind: EntityPerson, Name: "Marianna", Count: 2})

	summary, err := s.RenameEntity(ctx, EntityPerson, "Maria", "Marianna")
	if err != nil {
		t.Fatalf("rename merge: %v", err)
	}
	if summary.Name != "Marianna" || summary.Mentions != 5 || summary.Entries != 2 {
		t.Fatalf("merge = %+v", summary)
	}
	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Marianna" || people[0].Mentions != 5 {
		t.Fatalf("sobrau entidade depois do merge: %+v", people)
	}
}

func TestRenameEntityRejectsUnknownName(t *testing.T) {
	s := openStore(t)
	if _, err := s.RenameEntity(context.Background(), EntityPerson, "Ninguem", "Alguem"); err != ErrNotFound {
		t.Fatalf("rename inexistente = %v, queria ErrNotFound", err)
	}
	if _, err := s.RenameEntity(context.Background(), "bogus", "Maria", "Marianna"); err != ErrInvalidEntity {
		t.Fatalf("kind invalido = %v, queria ErrInvalidEntity", err)
	}
}

func TestClaimPersonAsOwnerMergesIntoDiarist(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	if err := s.SetSetting(ctx, "owner_name", "joseti"); err != nil {
		t.Fatalf("owner name: %v", err)
	}
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)
	saveEntities(t, s, "e1",
		EntityLink{Kind: EntityPerson, Name: "José Guilherme", Count: 2},
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 1},
	)
	saveEntities(t, s, "e2", EntityLink{Kind: EntityPerson, Name: "José Guilherme", Count: 1})

	owner, err := s.ClaimPersonAsOwner(ctx, "José Guilherme")
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if owner != "joseti" {
		t.Fatalf("dono = %q", owner)
	}
	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Maria" {
		t.Fatalf("a pessoa reivindicada deveria sumir do mapa: %+v", people)
	}

	// Toda analise, antiga ou futura, resolve a grafia antiga para o dono.
	names, err := s.EntityNameMap(ctx)
	if err != nil {
		t.Fatalf("name map: %v", err)
	}
	if got := names[EntityNameKey(EntityPerson, "José Guilherme")]; got != "joseti" {
		t.Fatalf("alias do dono = %q", got)
	}
	pairs, err := s.EntityAliasPairs(ctx)
	if err != nil {
		t.Fatalf("alias pairs: %v", err)
	}
	found := false
	for _, pair := range pairs {
		if pair.Old == "José Guilherme" && pair.New == "joseti" {
			found = true
		}
	}
	if !found {
		t.Fatalf("prosa nao recebeu o alias do dono: %+v", pairs)
	}

	// Uma analise futura que ainda diz o nome antigo nao recria a pessoa.
	seedEntry(t, s, "e3", now)
	saveEntities(t, s, "e3", EntityLink{Kind: EntityPerson, Name: "José Guilherme", Count: 1})
	people, err = s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list after: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Maria" {
		t.Fatalf("analise futura recriou a pessoa: %+v", people)
	}
}

func TestClaimPersonAsOwnerRejectsUnknown(t *testing.T) {
	s := openStore(t)
	if _, err := s.ClaimPersonAsOwner(context.Background(), "Ninguem"); err != ErrNotFound {
		t.Fatalf("claim inexistente = %v, queria ErrNotFound", err)
	}
}

func TestSetEntityIcon(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2})

	summary, err := s.SetEntityIcon(ctx, EntityPerson, "Maria", "heart")
	if err != nil {
		t.Fatalf("set icon: %v", err)
	}
	if summary.Icon != "heart" {
		t.Fatalf("icone = %q", summary.Icon)
	}
	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(people) != 1 || people[0].Icon != "heart" {
		t.Fatalf("lista sem icone: %+v", people)
	}

	summary, err = s.SetEntityIcon(ctx, EntityPerson, "Maria", "")
	if err != nil || summary.Icon != "" {
		t.Fatalf("limpar icone = %+v / %v", summary, err)
	}
	if _, err := s.SetEntityIcon(ctx, EntityPerson, "Maria", "nao-existe"); err != ErrInvalidEntity {
		t.Fatalf("icone invalido = %v", err)
	}
	if _, err := s.SetEntityIcon(ctx, EntityPerson, "Ninguem", "heart"); err != ErrNotFound {
		t.Fatalf("entidade inexistente = %v", err)
	}
}
