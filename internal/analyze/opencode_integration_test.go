package analyze_test

import (
	"context"
	"os"
	"testing"

	"github.com/joseti/dyarium/internal/analyze"
)

// TestOpenCodeIntegration exercises the local OpenCode provider against a real
// server. It is skipped unless OPENCODE_URL and OPENCODE_PASSWORD are set.
func TestOpenCodeIntegration(t *testing.T) {
	base := os.Getenv("OPENCODE_URL")
	password := os.Getenv("OPENCODE_PASSWORD")
	if base == "" || password == "" {
		t.Skip("OPENCODE_URL e OPENCODE_PASSWORD nao definidos")
	}
	model := os.Getenv("OPENCODE_MODEL")
	if model == "" {
		model = "opencode-go/qwen3.8-flash"
	}
	client := analyze.New(analyze.Config{
		Enabled:  true,
		Provider: analyze.ProviderOpenCode,
		BaseURL:  base,
		APIKey:   password,
		Model:    model,
	})
	result, err := client.Analyze(context.Background(), "Hoje fui ao mercado com a Maria e fiquei muito feliz.")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if result.Summary == "" {
		t.Fatalf("sem resumo: %+v", result)
	}
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) == 0 {
		t.Fatal("nenhum modelo retornado")
	}
	t.Logf("resumo=%q pessoas=%d emocoes=%d modelos=%d", result.Summary, len(result.People), len(result.Emotions), len(models))
}
