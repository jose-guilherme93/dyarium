package store

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestEntityRejectionKeyNormalizes(t *testing.T) {
	cases := map[string]string{
		"  Você  ":          "voce",
		"José   Guilherme":  "jose guilherme",
		"MARIA":             "maria",
		"":                  "",
		"  \t ":             "",
		"João  Pedro Gomes": "joao pedro gomes",
	}
	for input, want := range cases {
		if got := EntityRejectionKey(input); got != want {
			t.Fatalf("EntityRejectionKey(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSetEntityLabel(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2})

	summary, err := s.SetEntityLabel(ctx, EntityPerson, "Maria", "  gata  ")
	if err != nil {
		t.Fatalf("set label: %v", err)
	}
	if summary.Label != "gata" {
		t.Fatalf("label = %q", summary.Label)
	}
	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(people) != 1 || people[0].Label != "gata" {
		t.Fatalf("lista sem label: %+v", people)
	}
	detail, _, ok, err := s.GetEntity(ctx, EntityPerson, "Maria")
	if err != nil || !ok || detail.Label != "gata" {
		t.Fatalf("detalhe = %+v / %v", detail, err)
	}

	if _, err := s.SetEntityLabel(ctx, EntityPerson, "Maria", ""); err != nil {
		t.Fatalf("limpar label: %v", err)
	}
	detail, _, _, err = s.GetEntity(ctx, EntityPerson, "Maria")
	if err != nil || detail.Label != "" {
		t.Fatalf("label nao foi limpo: %+v / %v", detail, err)
	}

	if _, err := s.SetEntityLabel(ctx, EntityPerson, "Maria", strings.Repeat("a", 81)); err != ErrInvalidEntity {
		t.Fatalf("label longo = %v, queria ErrInvalidEntity", err)
	}
	if _, err := s.SetEntityLabel(ctx, EntityPerson, "Ninguem", "x"); err != ErrNotFound {
		t.Fatalf("entidade inexistente = %v, queria ErrNotFound", err)
	}
	if _, err := s.SetEntityLabel(ctx, "bogus", "Maria", "x"); err != ErrInvalidEntity {
		t.Fatalf("kind invalido = %v, queria ErrInvalidEntity", err)
	}
}

func TestChangeEntityKindMovesAliases(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2})
	// O nome antigo vira alias; trocar o tipo precisa levar o alias junto.
	if _, err := s.RenameEntity(ctx, EntityPerson, "Maria", "Mariana"); err != nil {
		t.Fatalf("rename: %v", err)
	}

	summary, err := s.ChangeEntityKind(ctx, EntityPerson, "Mariana", EntityPlace)
	if err != nil {
		t.Fatalf("change kind: %v", err)
	}
	if summary.Kind != EntityPlace || summary.Name != "Mariana" || summary.Mentions != 2 {
		t.Fatalf("resumo depois da troca = %+v", summary)
	}
	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list person: %v", err)
	}
	if len(people) != 0 {
		t.Fatalf("entidade continuou em person: %+v", people)
	}
	// O alias foi movido para o tipo novo e continua resolvendo.
	byAlias, _, found, err := s.GetEntity(ctx, EntityPlace, "Maria")
	if err != nil || !found || byAlias.Name != "Mariana" {
		t.Fatalf("alias nao acompanhou o tipo: %+v found=%v err=%v", byAlias, found, err)
	}
	rejected, err := s.EntityRejected(ctx, s.DB(), EntityPerson, "mariana")
	if err != nil || !rejected {
		t.Fatalf("rejeicao do tipo antigo = %v / %v", rejected, err)
	}
	items, err := s.ListEntityRejections(ctx)
	if err != nil || len(items) != 1 || items[0].Kind != EntityPerson || items[0].NameKey != "mariana" {
		t.Fatalf("rejeicoes = %+v / %v", items, err)
	}
}

func TestChangeEntityKindMergesTarget(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)
	saveEntities(t, s, "e1",
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2},
		EntityLink{Kind: EntityPlace, Name: "Maria", Count: 3},
	)
	saveEntities(t, s, "e2", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 4})

	summary, err := s.ChangeEntityKind(ctx, EntityPerson, "Maria", EntityPlace)
	if err != nil {
		t.Fatalf("change kind merge: %v", err)
	}
	if summary.Kind != EntityPlace || summary.Name != "Maria" || summary.Mentions != 9 || summary.Entries != 2 {
		t.Fatalf("merge = %+v", summary)
	}
	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list person: %v", err)
	}
	if len(people) != 0 {
		t.Fatalf("a origem sobreviveu ao merge: %+v", people)
	}
	rejected, err := s.EntityRejected(ctx, s.DB(), EntityPerson, "Maria")
	if err != nil || !rejected {
		t.Fatalf("rejeicao do tipo antigo = %v / %v", rejected, err)
	}
}

func TestDeleteEntityWritesRejection(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2})

	if err := s.DeleteEntity(ctx, EntityPerson, "Maria"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, found, err := s.GetEntity(ctx, EntityPerson, "Maria"); err != nil || found {
		t.Fatalf("entidade continuou: found=%v err=%v", found, err)
	}
	rejected, err := s.EntityRejected(ctx, s.DB(), EntityPerson, "MARIA")
	if err != nil || !rejected {
		t.Fatalf("rejeicao = %v / %v", rejected, err)
	}
	items, err := s.ListEntityRejections(ctx)
	if err != nil || len(items) != 1 || items[0].Name != "Maria" || items[0].NameKey != "maria" {
		t.Fatalf("rejeicoes = %+v / %v", items, err)
	}
	if err := s.DeleteEntity(ctx, EntityPerson, "Maria"); err != ErrNotFound {
		t.Fatalf("segunda exclusao = %v, queria ErrNotFound", err)
	}
}

func TestSaveRichAnalysisSkipsRejectedLinks(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	if err := s.AddEntityRejection(ctx, EntityPerson, "  Você  "); err != nil {
		t.Fatalf("add rejection: %v", err)
	}

	if err := s.SaveRichAnalysis(ctx, Analysis{ID: "a1", EntryID: "e1", CreatedAt: now},
		[]EntityLink{
			{Kind: EntityPerson, Name: "você", Count: 2},
			{Kind: EntityPlace, Name: "Recife", Count: 1},
		}); err != nil {
		t.Fatalf("save rich analysis: %v", err)
	}

	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list person: %v", err)
	}
	if len(people) != 0 {
		t.Fatalf("vinculo rejeitado entrou no banco: %+v", people)
	}
	places, err := s.ListEntities(ctx, EntityPlace)
	if err != nil || len(places) != 1 || places[0].Name != "Recife" {
		t.Fatalf("lugar valido sumiu: %+v / %v", places, err)
	}
}

func TestUndoKindChangeRestoresKindAndRemovesRejection(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 3})

	editID, err := s.PrepareEntityEditPairs(ctx, "kind", "Maria -> place",
		EntityPair{Kind: EntityPerson, Name: "Maria"},
		EntityPair{Kind: EntityPlace, Name: "Maria"})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := s.ChangeEntityKind(ctx, EntityPerson, "Maria", EntityPlace); err != nil {
		t.Fatalf("change kind: %v", err)
	}
	if _, err := s.UndoEntityEdit(ctx, editID); err != nil {
		t.Fatalf("undo: %v", err)
	}

	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list person: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Maria" || people[0].Mentions != 3 {
		t.Fatalf("tipo antigo nao voltou: %+v", people)
	}
	places, err := s.ListEntities(ctx, EntityPlace)
	if err != nil || len(places) != 0 {
		t.Fatalf("entidade ficou no tipo novo: %+v / %v", places, err)
	}
	items, err := s.ListEntityRejections(ctx)
	if err != nil || len(items) != 0 {
		t.Fatalf("rejeicao nao foi removida: %+v / %v", items, err)
	}
}

func TestUndoDeleteRestoresEntityAndClearsNewRejection(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 3})

	editID, err := s.PrepareEntityEdit(ctx, "delete", "Maria", EntityPerson, "Maria")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if err := s.DeleteEntity(ctx, EntityPerson, "Maria"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.UndoEntityEdit(ctx, editID); err != nil {
		t.Fatalf("undo: %v", err)
	}

	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list person: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Maria" || people[0].Mentions != 3 {
		t.Fatalf("entidade nao voltou: %+v", people)
	}
	items, err := s.ListEntityRejections(ctx)
	if err != nil || len(items) != 0 {
		t.Fatalf("rejeicao nova nao foi apagada: %+v / %v", items, err)
	}
}

func TestUndoDeleteRestoresPreviousRejection(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 1})

	if err := s.AddEntityRejection(ctx, EntityPerson, "Maria"); err != nil {
		t.Fatalf("add rejection: %v", err)
	}
	before, err := s.ListEntityRejections(ctx)
	if err != nil || len(before) != 1 {
		t.Fatalf("rejeicao inicial: %+v / %v", before, err)
	}

	editID, err := s.PrepareEntityEdit(ctx, "delete", "Maria", EntityPerson, "Maria")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if err := s.DeleteEntity(ctx, EntityPerson, "Maria"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.UndoEntityEdit(ctx, editID); err != nil {
		t.Fatalf("undo: %v", err)
	}

	after, err := s.ListEntityRejections(ctx)
	if err != nil || len(after) != 1 {
		t.Fatalf("rejeicao nao voltou: %+v / %v", after, err)
	}
	if !after[0].CreatedAt.Equal(before[0].CreatedAt) {
		t.Fatalf("created_at da rejeicao mudou: %v -> %v", before[0].CreatedAt, after[0].CreatedAt)
	}
	if people, _ := s.ListEntities(ctx, EntityPerson); len(people) != 1 {
		t.Fatalf("entidade nao voltou: %+v", people)
	}
}
