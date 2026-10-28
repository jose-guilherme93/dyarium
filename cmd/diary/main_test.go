package main

import (
	"strings"
	"testing"

	"github.com/joseti/dyarium/internal/bootstrap"
	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/crypto"
)

// O boot sem DIARY_MASTER_KEY precisa gerar a chave no volume, e nao morrer em
// crypto.ParseKey. Este teste guarda a ligacao entre serve e bootstrap que a
// release 0.3.0 perdeu.
func TestResolveSecretsCreatesAndReusesMasterKey(t *testing.T) {
	dir := t.TempDir()
	cfg, secrets, err := resolveSecrets(config.Config{DataDir: dir})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if !secrets.SetupRequired {
		t.Fatal("instancia nova deveria pedir setup")
	}
	if _, err := crypto.ParseKey(cfg.MasterKey); err != nil {
		t.Fatalf("chave gerada invalida: %v", err)
	}

	again, secrets, err := resolveSecrets(config.Config{DataDir: dir})
	if err != nil {
		t.Fatalf("resolve 2: %v", err)
	}
	if again.MasterKey != cfg.MasterKey {
		t.Fatal("a chave mestra mudou entre boots")
	}
	if !secrets.SetupRequired {
		t.Fatal("sem token, o setup continua pendente")
	}

	if err := bootstrap.Claim(dir, "token-do-operador"); err != nil {
		t.Fatalf("claim: %v", err)
	}
	claimed, secrets, err := resolveSecrets(config.Config{DataDir: dir})
	if err != nil {
		t.Fatalf("resolve 3: %v", err)
	}
	if secrets.SetupRequired || claimed.Token != "token-do-operador" {
		t.Fatalf("token apos claim = %q setup=%v", claimed.Token, secrets.SetupRequired)
	}
}

func TestResolveSecretsEnvironmentWins(t *testing.T) {
	key := strings.Repeat("ab", 32)
	cfg, secrets, err := resolveSecrets(config.Config{
		DataDir:   t.TempDir(),
		MasterKey: key,
		Token:     "token-do-ambiente",
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if cfg.MasterKey != key || cfg.Token != "token-do-ambiente" || secrets.SetupRequired {
		t.Fatalf("ambiente nao venceu: %+v %+v", cfg, secrets)
	}
}
