package store

import (
	"context"
	"testing"
	"time"
)

func TestBackfillDecisionEntities(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	// O migrate ja rodou com a biblioteca vazia e marcou o backfill; libere para
	// simular uma analise antiga que ainda nao tem os nos de decisao.
	if err := s.SetSetting(ctx, "decisions_backfilled", ""); err != nil {
		t.Fatalf("reset flag: %v", err)
	}
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	if err := s.SaveRichAnalysis(ctx, Analysis{
		ID: "a1", EntryID: "e1", CreatedAt: now, Data: `{"decisions":["Comprar leite","comprar leite"],"sentiment":{"score":0,"label":"neutro"}}`,
	}, []EntityLink{{Kind: EntityPerson, Name: "Maria", Count: 1}}); err != nil {
		t.Fatalf("save analysis: %v", err)
	}
	if err := s.backfillDecisionEntities(ctx); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	decisions, err := s.ListEntities(ctx, EntityDecision)
	if err != nil {
		t.Fatalf("list decisions: %v", err)
	}
	if len(decisions) != 1 || decisions[0].Name != "Comprar leite" || decisions[0].Mentions != 1 {
		t.Fatalf("decisoes = %+v", decisions)
	}
	// A segunda passada nao duplica.
	if err := s.backfillDecisionEntities(ctx); err != nil {
		t.Fatalf("backfill 2: %v", err)
	}
	decisions, _ = s.ListEntities(ctx, EntityDecision)
	if len(decisions) != 1 || decisions[0].Mentions != 1 {
		t.Fatalf("decisoes duplicadas = %+v", decisions)
	}
}
