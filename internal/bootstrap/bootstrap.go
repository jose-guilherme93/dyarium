// Package bootstrap resolves the runtime secrets of the server. The goal is a
// turnkey first run: when the environment does not provide a master key or an
// access token, they are generated locally so the operator never has to
// configure anything by hand. The master key is persisted under the data
// directory; the access token is only persisted once the operator claims the
// instance through the first-run wizard.
package bootstrap

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	// MasterKeyFile guards the AES-256 key that protects the audio at rest.
	MasterKeyFile = "master.key"
	// TokenFile holds the bearer token chosen during first-run setup.
	TokenFile = "token"
	// MinTokenLength is the shortest accepted access token.
	MinTokenLength = 8
)

// Result carries the resolved secrets and whether the instance still needs the
// operator to claim it.
type Result struct {
	MasterKey     string
	Token         string
	SetupRequired bool
}

// Resolve returns the master key and access token to use. An environment value
// always wins. Otherwise the master key is read from (or created in) the data
// directory, and the token either comes from the data directory or triggers
// first-run setup.
func Resolve(dataDir, envMasterKey, envToken string) (Result, error) {
	key := strings.TrimSpace(envMasterKey)
	if key == "" {
		var err error
		key, err = ensureSecret(filepath.Join(dataDir, MasterKeyFile), 32)
		if err != nil {
			return Result{}, fmt.Errorf("resolver chave mestra: %w", err)
		}
	}

	token := strings.TrimSpace(envToken)
	if token != "" {
		return Result{MasterKey: key, Token: token}, nil
	}

	if stored, err := readSecret(filepath.Join(dataDir, TokenFile)); err != nil {
		return Result{}, fmt.Errorf("ler token: %w", err)
	} else if stored != "" {
		return Result{MasterKey: key, Token: stored}, nil
	}

	// No token yet: generate an ephemeral one so the API stays protected while
	// setup is pending. The operator replaces it through the wizard, which is
	// the only thing that persists it.
	ephemeral, err := randomHex(32)
	if err != nil {
		return Result{}, fmt.Errorf("gerar token temporario: %w", err)
	}
	return Result{MasterKey: key, Token: ephemeral, SetupRequired: true}, nil
}

// Claim persists the operator-chosen token under the data directory.
func Claim(dataDir, token string) error {
	token = strings.TrimSpace(token)
	if len(token) < MinTokenLength {
		return fmt.Errorf("o token deve ter ao menos %d caracteres", MinTokenLength)
	}
	path := filepath.Join(dataDir, TokenFile)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("criar diretorio de dados: %w", err)
	}
	return writeSecret(path, token)
}

// ensureSecret reads a secret from path, generating and persisting a new one
// when the file is missing or empty. Hex bytes gives the length of the raw
// secret (twice as many characters once encoded).
func ensureSecret(path string, hexBytes int) (string, error) {
	if existing, err := readSecret(path); err != nil {
		return "", err
	} else if existing != "" {
		return existing, nil
	}
	value, err := randomHex(hexBytes)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	if err := writeSecret(path, value); err != nil {
		return "", err
	}
	return value, nil
}

func readSecret(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func writeSecret(path, value string) error {
	return os.WriteFile(path, []byte(value+"\n"), 0o600)
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
