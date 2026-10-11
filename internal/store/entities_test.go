package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func openStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return s
}

func floatPtr(v float64) *float64 { return &v }

func seedEntry(t *testing.T, s *Store, id string, when time.Time) {
	t.Helper()
	entry := Entry{
		ID:        id,
		Title:     "entrada " + id,
		Status:    EntryStored,
		Source:    "upload",
		CreatedAt: when,
		UpdatedAt: when,
	}
	if err := s.CreateEntry(context.Background(), entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
}

func TestSaveRichAnalysisPopulatesEntities(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)

	analysis := Analysis{
		ID: "a1", EntryID: "e1", Model: "m", Sentiment: 0.5, SentimentLabel: "positivo",
		Data: `{"summary":"ok"}`, CreatedAt: now,
	}
	links := []EntityLink{
		{Kind: EntityPerson, Name: "Maria", Count: 3, Relation: "irma", Sentiment: floatPtr(0.4)},
		{Kind: EntityPlace, Name: "Recife", Count: 2},
		{Kind: EntityTheme, Name: "familia", Count: 1},
	}
	if err := s.SaveRichAnalysis(ctx, analysis, links); err != nil {
		t.Fatalf("save rich analysis: %v", err)
	}

	stored, ok, err := s.GetAnalysis(ctx, "e1")
	if err != nil || !ok {
		t.Fatalf("get analysis: ok=%v err=%v", ok, err)
	}
	if stored.SentimentLabel != "positivo" || stored.Data != `{"summary":"ok"}` {
		t.Fatalf("analysis rica nao persistida: %+v", stored)
	}

	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list entities: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Maria" || people[0].Mentions != 3 || people[0].Entries != 1 {
		t.Fatalf("entidades de pessoa = %+v", people)
	}
	if people[0].Sentiment != 0.4 {
		t.Fatalf("sentimento agregado = %v", people[0].Sentiment)
	}

	summary, entries, found, err := s.GetEntity(ctx, EntityPerson, "maria")
	if err != nil || !found {
		t.Fatalf("get entity: found=%v err=%v", found, err)
	}
	if summary.Name != "Maria" || len(entries) != 1 || entries[0].EntryID != "e1" || entries[0].Count != 3 {
		t.Fatalf("detalhe da entidade = %+v / %+v", summary, entries)
	}
}

func TestSaveRichAnalysisReplacesLinks(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)

	if err := s.SaveRichAnalysis(ctx, Analysis{ID: "a1", EntryID: "e1", CreatedAt: now},
		[]EntityLink{{Kind: EntityPerson, Name: "Maria", Count: 1}}); err != nil {
		t.Fatalf("first save: %v", err)
	}
	if err := s.SaveRichAnalysis(ctx, Analysis{ID: "a2", EntryID: "e1", CreatedAt: now},
		[]EntityLink{{Kind: EntityPerson, Name: "Joao", Count: 1}}); err != nil {
		t.Fatalf("second save: %v", err)
	}

	people, err := s.ListEntities(ctx, EntityPerson)
	if err != nil {
		t.Fatalf("list entities: %v", err)
	}
	if len(people) != 1 || people[0].Name != "Joao" {
		t.Fatalf("links antigos deveriam ter sido substituidos: %+v", people)
	}
}

func TestListEntriesFiltered(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)

	if err := s.SaveRichAnalysis(ctx, Analysis{ID: "a1", EntryID: "e1", CreatedAt: now},
		[]EntityLink{
			{Kind: EntityPerson, Name: "Maria", Count: 1},
			{Kind: EntityPlace, Name: "Recife", Count: 1},
		}); err != nil {
		t.Fatalf("save e1: %v", err)
	}
	if err := s.SaveRichAnalysis(ctx, Analysis{ID: "a2", EntryID: "e2", CreatedAt: now},
		[]EntityLink{{Kind: EntityPerson, Name: "Joao", Count: 1}}); err != nil {
		t.Fatalf("save e2: %v", err)
	}

	byPerson, err := s.ListEntriesFiltered(ctx, 10, "maria", "", "")
	if err != nil {
		t.Fatalf("filter person: %v", err)
	}
	if len(byPerson) != 1 || byPerson[0].ID != "e1" {
		t.Fatalf("filtro por pessoa = %+v", byPerson)
	}
	byPlace, err := s.ListEntriesFiltered(ctx, 10, "", "Recife", "")
	if err != nil {
		t.Fatalf("filter place: %v", err)
	}
	if len(byPlace) != 1 || byPlace[0].ID != "e1" {
		t.Fatalf("filtro por lugar = %+v", byPlace)
	}
	none, err := s.ListEntriesFiltered(ctx, 10, "ninguem", "", "")
	if err != nil {
		t.Fatalf("filter none: %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("esperava nenhum resultado: %+v", none)
	}
}

func TestMoodSeries(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	day1 := time.Date(2026, 1, 2, 10, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 1, 3, 10, 0, 0, 0, time.UTC)
	seedEntry(t, s, "e1", day1)
	seedEntry(t, s, "e2", day1)
	seedEntry(t, s, "e3", day2)

	for _, a := range []Analysis{
		{ID: "a1", EntryID: "e1", Sentiment: 0.2, CreatedAt: day1},
		{ID: "a2", EntryID: "e2", Sentiment: 0.8, CreatedAt: day1},
		{ID: "a3", EntryID: "e3", Sentiment: -0.6, CreatedAt: day2},
	} {
		if err := s.SaveAnalysis(ctx, a); err != nil {
			t.Fatalf("save analysis: %v", err)
		}
	}

	points, err := s.MoodSeries(ctx, time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("mood series: %v", err)
	}
	if len(points) != 2 {
		t.Fatalf("pontos = %+v, queria 2 dias", points)
	}
	if points[0].Date != "2026-01-02" || points[0].Entries != 2 {
		t.Fatalf("primeiro ponto = %+v", points[0])
	}
	if points[0].Sentiment < 0.49 || points[0].Sentiment > 0.51 {
		t.Fatalf("media do dia 1 = %v, queria ~0.5", points[0].Sentiment)
	}

	from := time.Date(2026, 1, 3, 0, 0, 0, 0, time.UTC)
	points, err = s.MoodSeries(ctx, from, time.Time{})
	if err != nil {
		t.Fatalf("mood series from: %v", err)
	}
	if len(points) != 1 || points[0].Date != "2026-01-03" {
		t.Fatalf("filtro from = %+v", points)
	}
}
