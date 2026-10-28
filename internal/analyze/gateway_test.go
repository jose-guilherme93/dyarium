package analyze

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

// O gateway do OpenCode recusa toda requisicao sem o id de sessao, mesmo com a
// chave certa. Ele precisa ser estavel para o provedor rotear a conversa.
func TestGatewayHeaders(t *testing.T) {
	client := New(Config{BaseURL: "https://opencode.ai/inference/go/openai/v1"})
	request, err := http.NewRequest(http.MethodPost, "https://opencode.ai/inference/go/openai/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	client.gatewayHeaders(request)
	if client.sessionID == "" {
		t.Fatal("session id vazio")
	}
	if got := request.Header.Get("x-opencode-session"); got != client.sessionID {
		t.Fatalf("x-opencode-session = %q, want %q", got, client.sessionID)
	}
	if got := request.Header.Get("User-Agent"); got != "dyarium/1.0" {
		t.Fatalf("User-Agent = %q", got)
	}

	// Fora do gateway (Ollama, DeepSeek, opencode local) o cabecalho nao vai.
	local := New(Config{BaseURL: "http://ollama:11434/v1"})
	localRequest, _ := http.NewRequest(http.MethodPost, "http://ollama:11434/v1/chat/completions", nil)
	local.gatewayHeaders(localRequest)
	if got := localRequest.Header.Get("x-opencode-session"); got != "" {
		t.Fatalf("x-opencode-session = %q em provedor local", got)
	}
	if got := localRequest.Header.Get("User-Agent"); got != "dyarium/1.0" {
		t.Fatalf("User-Agent = %q em provedor local", got)
	}
}

func TestSessionIDIsStablePerClient(t *testing.T) {
	client := New(Config{BaseURL: "https://opencode.ai/inference/openai/v1"})
	first := client.sessionID
	client.gatewayHeaders(mustRequest(t))
	if client.sessionID != first {
		t.Fatalf("session id mudou de %q para %q", first, client.sessionID)
	}
	other := New(Config{BaseURL: "https://opencode.ai/inference/openai/v1"})
	if other.sessionID == first {
		t.Fatal("dois clientes deveriam ter sessoes diferentes")
	}
}

func mustRequest(t *testing.T) *http.Request {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, "https://opencode.ai/inference/openai/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	return request
}

func TestRetryable(t *testing.T) {
	cases := []struct {
		message string
		want    bool
	}{
		{"analyze: status 400: modelo invalido", false},
		{"analyze: status 401: chave invalida", false},
		{"analyze: status 402: sem saldo", false},
		{"analyze: status 403: sem permissao", false},
		{"analyze: status 404: modelo nao encontrado", false},
		{"analyze: status 422: formato recusado", false},
		{"analyze: status 429: limite de uso", true},
		{"analyze: status 500: erro do provedor", true},
		{"analyze: status 503: indisponivel", true},
		{"analyze: request: dial tcp: connection refused", true},
		{"analyze: request: context deadline exceeded", true},
	}
	for _, tc := range cases {
		if got := Retryable(errors.New(tc.message)); got != tc.want {
			t.Errorf("Retryable(%q) = %v, want %v", tc.message, got, tc.want)
		}
	}
	if Retryable(nil) {
		t.Error("Retryable(nil) deveria ser false")
	}
	if !strings.Contains(FriendlyError(errors.New("analyze: status 400: ruim")), "modelo") {
		t.Error("FriendlyError de 400 deveria falar de modelo/provedor")
	}
}
