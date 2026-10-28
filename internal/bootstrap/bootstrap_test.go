package bootstrap

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveUsesEnvironmentValues(t *testing.T) {
	dir := t.TempDir()

	got, err := Resolve(dir, "chave-do-ambiente", "token-do-ambiente")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.MasterKey != "chave-do-ambiente" || got.Token != "token-do-ambiente" {
		t.Fatalf("valores do ambiente ignorados: %+v", got)
	}
	if got.SetupRequired {
		t.Fatal("setup nao deveria ser exigido quando o token vem do ambiente")
	}
	if _, err := os.Stat(filepath.Join(dir, MasterKeyFile)); !os.IsNotExist(err) {
		t.Fatal("chave mestra nao deveria ser gravada quando vem do ambiente")
	}
}

func TestResolveGeneratesAndPersistsMasterKey(t *testing.T) {
	dir := t.TempDir()

	first, err := Resolve(dir, "", "token-fixo")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if _, err := hex.DecodeString(first.MasterKey); err != nil || len(first.MasterKey) != 64 {
		t.Fatalf("chave mestra nao parece hex de 32 bytes: %q", first.MasterKey)
	}

	second, err := Resolve(dir, "", "token-fixo")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if second.MasterKey != first.MasterKey {
		t.Fatal("a chave mestra deveria ser estavel entre execucoes")
	}
}

func TestResolveRequiresSetupWithoutToken(t *testing.T) {
	dir := t.TempDir()

	got, err := Resolve(dir, "", "")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !got.SetupRequired {
		t.Fatal("setup deveria ser exigido sem token")
	}
	if len(got.Token) < MinTokenLength {
		t.Fatalf("token temporario curto demais: %q", got.Token)
	}
	if _, err := os.Stat(filepath.Join(dir, TokenFile)); !os.IsNotExist(err) {
		t.Fatal("o token temporario nao deveria ser persistido")
	}
}

func TestClaimPersistsTokenAndClearsSetup(t *testing.T) {
	dir := t.TempDir()

	if err := Claim(dir, "meu-token-secreto"); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if info, err := os.Stat(filepath.Join(dir, TokenFile)); err != nil {
		t.Fatalf("token nao foi gravado: %v", err)
	} else if info.Mode().Perm() != 0o600 {
		t.Fatalf("permissoes do token = %o, esperado 600", info.Mode().Perm())
	}

	got, err := Resolve(dir, "", "")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.SetupRequired {
		t.Fatal("setup nao deveria ser exigido apos o claim")
	}
	if got.Token != "meu-token-secreto" {
		t.Fatalf("token = %q, esperado o definido no claim", got.Token)
	}
}

func TestClaimRejectsShortToken(t *testing.T) {
	if err := Claim(t.TempDir(), "curto"); err == nil {
		t.Fatal("Claim deveria recusar token curto")
	}
}
