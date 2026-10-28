package analysisbuild

import (
	"testing"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/store"
)

func TestBuildLinksDecisions(t *testing.T) {
	_, links := Build("e1", analyze.Result{
		Decisions: []string{"Comprar leite", "comprar leite", "  "},
	}, Metrics{})
	decisions := 0
	for _, link := range links {
		if link.Kind == store.EntityDecision {
			decisions++
			if link.Name != "Comprar leite" {
				t.Fatalf("decisao = %q", link.Name)
			}
		}
	}
	if decisions != 1 {
		t.Fatalf("decisoes = %d, queria 1 (deduplicada)", decisions)
	}
}
