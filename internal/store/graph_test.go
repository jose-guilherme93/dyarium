package store

import (
	"context"
	"testing"
	"time"
)

func saveEntities(t *testing.T, s *Store, entryID string, links ...EntityLink) {
	t.Helper()
	now := time.Now().UTC()
	if err := s.SaveRichAnalysis(context.Background(), Analysis{
		ID: "a-" + entryID, EntryID: entryID, CreatedAt: now,
	}, links); err != nil {
		t.Fatalf("save analysis %s: %v", entryID, err)
	}
}

func TestGraphEgoHasNodesEdgesAndCooccurrence(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)
	seedEntry(t, s, "e3", now)
	saveEntities(t, s, "e1",
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 3},
		EntityLink{Kind: EntityPlace, Name: "Recife", Count: 1},
		EntityLink{Kind: EntityTheme, Name: "trabalho", Count: 1},
	)
	saveEntities(t, s, "e2",
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2},
		EntityLink{Kind: EntityTheme, Name: "trabalho", Count: 1},
	)
	saveEntities(t, s, "e3",
		EntityLink{Kind: EntityPerson, Name: "João", Count: 1},
		EntityLink{Kind: EntityPlace, Name: "Recife", Count: 1},
	)

	graph, err := s.Graph(ctx, GraphOptions{})
	if err != nil {
		t.Fatalf("graph: %v", err)
	}
	if graph.TotalNodes != 4 || len(graph.Nodes) != 4 {
		t.Fatalf("nos = %d/%d, queria 4", len(graph.Nodes), graph.TotalNodes)
	}
	if graph.TotalEdges < len(graph.Nodes) {
		t.Fatalf("arestas = %d, queria pelo menos uma por entidade", graph.TotalEdges)
	}
	// Maria aparece em duas notas; a aresta do centro tem esse peso.
	var mariaID string
	for _, node := range graph.Nodes {
		if node.Label == "Maria" {
			mariaID = node.ID
			if node.Notes != 2 || node.Mentions != 5 {
				t.Fatalf("Maria = %+v, queria 2 notas e 5 mencoes", node)
			}
		}
	}
	if mariaID == "" {
		t.Fatal("Maria nao apareceu no grafo")
	}
	var userEdge, cooccurrence bool
	for _, edge := range graph.Edges {
		if edge.Source == GraphUser && edge.Target == mariaID && edge.Weight == 2 {
			userEdge = true
		}
		if edge.Kind == "cooccurrence" {
			cooccurrence = true
		}
	}
	if !userEdge {
		t.Fatalf("aresta do usuario para Maria ausente: %+v", graph.Edges)
	}
	if !cooccurrence {
		t.Fatalf("co-ocorrencia ausente: %+v", graph.Edges)
	}
}

func TestGraphFocusAddsNotesAndMentionEdges(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	seedEntry(t, s, "e2", now)
	saveEntities(t, s, "e1",
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 2},
		EntityLink{Kind: EntityPlace, Name: "Recife", Count: 1},
	)
	saveEntities(t, s, "e2",
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 1},
		EntityLink{Kind: EntityTheme, Name: "familia", Count: 1},
	)
	graph, err := s.Graph(ctx, GraphOptions{})
	if err != nil {
		t.Fatalf("graph: %v", err)
	}
	var mariaID string
	for _, node := range graph.Nodes {
		if node.Label == "Maria" {
			mariaID = node.ID
		}
	}
	if mariaID == "" {
		t.Fatal("Maria nao apareceu")
	}
	focus, err := s.Graph(ctx, GraphOptions{Focus: mariaID})
	if err != nil {
		t.Fatalf("focus: %v", err)
	}
	var notes, entities, mentions int
	for _, node := range focus.Nodes {
		switch node.Kind {
		case GraphNote:
			notes++
		case EntityPerson, EntityPlace, EntityTheme:
			entities++
		}
	}
	for _, edge := range focus.Edges {
		if edge.Kind == "mention" {
			mentions++
		}
	}
	if notes != 2 {
		t.Fatalf("notas no foco = %d, queria 2", notes)
	}
	if entities != 3 { // Maria + Recife + familia
		t.Fatalf("entidades no foco = %d, queria 3", entities)
	}
	if mentions < 3 {
		t.Fatalf("arestas de mencao = %d, queria pelo menos 3", mentions)
	}
}

func TestGraphCapsAndMissingFocus(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1",
		EntityLink{Kind: EntityPerson, Name: "Maria", Count: 1},
		EntityLink{Kind: EntityPlace, Name: "Recife", Count: 1},
	)
	graph, err := s.Graph(ctx, GraphOptions{NodeLimit: 1})
	if err != nil {
		t.Fatalf("graph: %v", err)
	}
	if len(graph.Nodes) != 1 || graph.TotalNodes != 2 || !graph.Truncated {
		t.Fatalf("teto de nos = %+v", graph)
	}
	if _, err := s.Graph(ctx, GraphOptions{Focus: "person:nao-existe"}); err != ErrNotFound {
		t.Fatalf("foco inexistente = %v, queria ErrNotFound", err)
	}
}

func TestEffectiveAuthor(t *testing.T) {
	if got := EffectiveAuthor("", true); got != AuthorSelf {
		t.Fatalf("padrao ligado = %q", got)
	}
	if got := EffectiveAuthor("", false); got != "" {
		t.Fatalf("padrao desligado = %q", got)
	}
	if got := EffectiveAuthor(AuthorOther, true); got != AuthorOther {
		t.Fatalf("escolha explicita = %q", got)
	}
}

func TestGraphFiltersByNotebookAndPeriod(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	recent := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	old := time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)
	if err := s.CreateNotebook(ctx, Notebook{
		ID: "nb-trabalho", Name: "trabalho", CreatedAt: recent, UpdatedAt: recent,
	}); err != nil {
		t.Fatalf("notebook: %v", err)
	}
	create := func(id, notebook string, recorded time.Time) {
		t.Helper()
		when := recorded
		if err := s.CreateEntry(ctx, Entry{
			ID: id, Title: id, Status: EntryStored, Source: "upload",
			NotebookID: notebook, RecordedAt: &when, CreatedAt: when, UpdatedAt: when,
		}); err != nil {
			t.Fatalf("entrada %s: %v", id, err)
		}
	}
	create("e1", DefaultNotebookID, recent)
	create("e2", "nb-trabalho", recent)
	create("e3", DefaultNotebookID, old)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPerson, Name: "Maria", Count: 1})
	saveEntities(t, s, "e2", EntityLink{Kind: EntityPerson, Name: "João", Count: 1})
	saveEntities(t, s, "e3", EntityLink{Kind: EntityPerson, Name: "Ana", Count: 1})

	labels := func(data GraphData) []string {
		t.Helper()
		out := make([]string, 0, len(data.Nodes))
		for _, node := range data.Nodes {
			out = append(out, node.Label)
		}
		return out
	}
	has := func(got []string, want string) bool {
		for _, label := range got {
			if label == want {
				return true
			}
		}
		return false
	}

	notebook, err := s.Graph(ctx, GraphOptions{NotebookID: DefaultNotebookID})
	if err != nil {
		t.Fatalf("grafo do caderno: %v", err)
	}
	if got := labels(notebook); len(got) != 2 || !has(got, "Maria") || !has(got, "Ana") {
		t.Fatalf("caderno padrao = %v, queria Maria e Ana", got)
	}
	work, err := s.Graph(ctx, GraphOptions{NotebookID: "nb-trabalho"})
	if err != nil {
		t.Fatalf("grafo do trabalho: %v", err)
	}
	if got := labels(work); len(got) != 1 || got[0] != "João" {
		t.Fatalf("caderno trabalho = %v, queria João", got)
	}
	period, err := s.Graph(ctx, GraphOptions{From: recent.Add(-time.Hour)})
	if err != nil {
		t.Fatalf("grafo do periodo: %v", err)
	}
	if got := labels(period); len(got) != 2 || !has(got, "Maria") || !has(got, "João") {
		t.Fatalf("periodo recente = %v, queria Maria e João", got)
	}
	before, err := s.Graph(ctx, GraphOptions{To: old.Add(time.Hour)})
	if err != nil {
		t.Fatalf("grafo antes: %v", err)
	}
	if got := labels(before); len(got) != 1 || got[0] != "Ana" {
		t.Fatalf("periodo antigo = %v, queria Ana", got)
	}
}

func TestGraphNodeCarriesCustomIcon(t *testing.T) {
	ctx := context.Background()
	s := openStore(t)
	now := time.Now().UTC()
	seedEntry(t, s, "e1", now)
	saveEntities(t, s, "e1", EntityLink{Kind: EntityPlace, Name: "Recife", Count: 1})
	if _, err := s.SetEntityIcon(ctx, EntityPlace, "Recife", "star"); err != nil {
		t.Fatalf("set icon: %v", err)
	}
	data, err := s.Graph(ctx, GraphOptions{})
	if err != nil {
		t.Fatalf("graph: %v", err)
	}
	if len(data.Nodes) != 1 || data.Nodes[0].Icon != "star" {
		t.Fatalf("no sem icone: %+v", data.Nodes)
	}
}
