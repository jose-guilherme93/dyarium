package analysisbuild

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/store"
)

// O contrato da derivacao e compartilhado com o app: este teste e o par em Go
// de mobile/src/core/__tests__/graphEntities.test.ts. Mudar uma regra de um
// lado sem o outro quebra um dos dois.
type parityFile struct {
	Description string `json:"description"`
	Cases       []struct {
		Name     string   `json:"name"`
		Owner    []string `json:"owner"`
		Analysis struct {
			PeopleDetail []struct {
				Name      string  `json:"name"`
				Count     int     `json:"count"`
				Relation  string  `json:"relation"`
				Sentiment float64 `json:"sentiment"`
			} `json:"people_detail"`
			People       []string `json:"people"`
			PlacesDetail []struct {
				Name  string `json:"name"`
				Count int    `json:"count"`
			} `json:"places_detail"`
			Places []string `json:"places"`
			Themes []struct {
				Name       string  `json:"name"`
				Confidence float64 `json:"confidence"`
			} `json:"themes"`
			Decisions []string `json:"decisions"`
		} `json:"analysis"`
		Links []struct {
			Kind      string  `json:"kind"`
			Name      string  `json:"name"`
			Count     int     `json:"count"`
			Relation  string  `json:"relation"`
			Sentiment float64 `json:"sentiment"`
		} `json:"links"`
	} `json:"cases"`
}

func TestDerivationParityWithApp(t *testing.T) {
	path := filepath.Join("..", "..", "fixtures", "entity-derivation.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var file parityFile
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&file); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	for _, testCase := range file.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			result := analyze.Result{}
			for _, person := range testCase.Analysis.PeopleDetail {
				result.People = append(result.People, analyze.Person{
					Name: person.Name, Count: person.Count, Relation: person.Relation,
					Sentiment: person.Sentiment,
				})
			}
			for _, name := range testCase.Analysis.People {
				result.People = append(result.People, analyze.Person{Name: name})
			}
			for _, place := range testCase.Analysis.PlacesDetail {
				result.Places = append(result.Places, analyze.Place{Name: place.Name, Count: place.Count})
			}
			for _, name := range testCase.Analysis.Places {
				result.Places = append(result.Places, analyze.Place{Name: name})
			}
			for _, theme := range testCase.Analysis.Themes {
				result.Themes = append(result.Themes, analyze.Theme{Name: theme.Name})
			}
			result.Decisions = testCase.Analysis.Decisions

			_, links := Build("entry", result, Metrics{})

			// O app usa a lista simples quando o detalhe nao veio (contrato
			// antigo) e nesse caso nao ha tom por pessoa. O Build sempre grava o
			// ponteiro, entao o teste limpa o tom para comparar o mesmo contrato.
			hasPeopleDetail := len(testCase.Analysis.PeopleDetail) > 0

			owner := make(map[string]bool, len(testCase.Owner))
			for _, name := range testCase.Owner {
				owner[strings.ToLower(strings.TrimSpace(name))] = true
			}
			got := make([]string, 0, len(links))
			for _, link := range links {
				// O "sou eu" e aplicado pelo SaveRichAnalysis; a paridade vale
				// para o resultado depois do filtro.
				if link.Kind == store.EntityPerson && owner[strings.ToLower(strings.TrimSpace(link.Name))] {
					continue
				}
				sentiment := link.Sentiment
				if link.Kind == store.EntityPerson && !hasPeopleDetail {
					sentiment = nil
				}
				got = append(got, linkString(link.Kind, link.Name, link.Count, link.Relation, sentiment))
			}
			want := make([]string, 0, len(testCase.Links))
			for i := range testCase.Links {
				link := testCase.Links[i]
				var sentiment *float64
				if link.Kind == store.EntityPerson && hasPeopleDetail {
					sentiment = &link.Sentiment
				}
				want = append(want, linkString(link.Kind, link.Name, link.Count, link.Relation, sentiment))
			}
			if len(got) != len(want) {
				t.Fatalf("links = %v, want %v", got, want)
			}
			for i := range got {
				if got[i] != want[i] {
					t.Fatalf("link %d = %s, want %s", i, got[i], want[i])
				}
			}
		})
	}
}

func linkString(kind, name string, count int, relation string, sentiment *float64) string {
	parts := []string{strings.TrimSpace(kind), strings.TrimSpace(name), "count=" + strconv.Itoa(count)}
	if relation != "" {
		parts = append(parts, "relation="+strings.TrimSpace(relation))
	}
	if sentiment != nil {
		parts = append(parts, "sentiment="+strconv.FormatFloat(*sentiment, 'f', -1, 64))
	}
	return strings.Join(parts, "|")
}
