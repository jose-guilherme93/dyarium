package llm

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeServerBinary stands in for llama-server. The version exit code is what
// Available probes; the real process is replaced by exec.Command("sleep").
func fakeServerBinary(t *testing.T, versionExit int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "llama-server")
	script := fmt.Sprintf("#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then exit %d; fi\nexit 0\n", versionExit)
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatalf("binario de teste: %v", err)
	}
	return path
}

type rewriteTransport struct {
	target *url.URL
}

func (t rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = t.target.Scheme
	clone.URL.Host = t.target.Host
	clone.Host = ""
	return http.DefaultTransport.RoundTrip(clone)
}

func TestDownloadPublishesModelOnlyWhenComplete(t *testing.T) {
	content := strings.Repeat("gguf", 1024)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "4096")
		_, _ = io.WriteString(w, content)
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)

	dir := t.TempDir()
	manager := NewManager(dir)
	manager.http = &http.Client{Transport: rewriteTransport{target: target}}

	model, ok := Find(DefaultModel)
	if !ok {
		t.Fatal("modelo padrao fora do catalogo")
	}
	if manager.Downloaded(DefaultModel) {
		t.Fatal("modelo nao deveria existir antes do download")
	}

	var last Progress
	err := manager.Download(context.Background(), DefaultModel, func(p Progress) { last = p })
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if !last.Done || last.Received != int64(len(content)) {
		t.Fatalf("progresso final = %+v", last)
	}
	path, _ := manager.Path(DefaultModel)
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ler modelo: %v", err)
	}
	if string(got) != content {
		t.Fatalf("conteudo = %d bytes, quer %d", len(got), len(content))
	}
	if _, err := os.Stat(path + ".part"); !os.IsNotExist(err) {
		t.Fatalf("arquivo parcial ficou no disco: %v", err)
	}
	if !manager.Downloaded(DefaultModel) {
		t.Fatal("modelo deveria estar disponivel depois do download")
	}
	if model.SizeMB <= 0 {
		t.Fatalf("tamanho do catalogo = %d", model.SizeMB)
	}
}

func TestDownloadRejectsUnknownModel(t *testing.T) {
	manager := NewManager(t.TempDir())
	if err := manager.Download(context.Background(), "nao-existe", nil); err == nil {
		t.Fatal("modelo fora do catalogo deveria falhar")
	}
	if _, ok := manager.Path("nao-existe"); ok {
		t.Fatal("Path nao deveria aceitar modelo fora do catalogo")
	}
}

func TestDownloadKeepsPartialFileOutOfTheCatalog(t *testing.T) {
	dir := t.TempDir()
	manager := NewManager(dir)
	path, _ := manager.Path(DefaultModel)
	if err := os.WriteFile(path+".part", []byte("parcial"), 0o600); err != nil {
		t.Fatalf("criar parcial: %v", err)
	}
	if manager.Downloaded(DefaultModel) {
		t.Fatal("arquivo .part nao conta como modelo baixado")
	}
	if _, err := os.Stat(filepath.Join(dir, Catalog[0].Filename)); !os.IsNotExist(err) {
		t.Fatalf("arquivo final nao deveria existir: %v", err)
	}
}

func TestServerAcquireStartsAndIdleReleases(t *testing.T) {
	health := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer health.Close()

	model := filepath.Join(t.TempDir(), "model.gguf")
	if err := os.WriteFile(model, []byte("gguf"), 0o600); err != nil {
		t.Fatalf("modelo de teste: %v", err)
	}

	server := NewServer(fakeServerBinary(t, 0), 0, 1, 50*time.Millisecond, nil)
	t.Cleanup(server.Close)
	server.healthURL = health.URL
	server.command = func(string, ...string) *exec.Cmd { return exec.Command("sleep", "30") }

	release, err := server.Acquire(context.Background(), model)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if !server.Running() {
		t.Fatal("servidor deveria estar rodando")
	}
	release()
	waitFor(t, 3*time.Second, func() bool { return !server.Running() })
}

func TestStopIfIdleWaitsForTheAnalysis(t *testing.T) {
	health := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer health.Close()

	model := filepath.Join(t.TempDir(), "model.gguf")
	if err := os.WriteFile(model, []byte("gguf"), 0o600); err != nil {
		t.Fatalf("modelo de teste: %v", err)
	}

	server := NewServer(fakeServerBinary(t, 0), 0, 1, 0, nil)
	t.Cleanup(server.Close)
	server.healthURL = health.URL
	server.command = func(string, ...string) *exec.Cmd { return exec.Command("sleep", "30") }

	release, err := server.Acquire(context.Background(), model)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	server.StopIfIdle()
	if !server.Running() {
		t.Fatal("nao pode derrubar o modelo com analise em andamento")
	}
	release()
	server.StopIfIdle()
	if server.Running() {
		t.Fatal("servidor deveria parar depois da analise")
	}
}

func TestAcquireRejectsMissingModel(t *testing.T) {
	server := NewServer(fakeServerBinary(t, 0), 0, 1, 0, nil)
	t.Cleanup(server.Close)
	_, err := server.Acquire(context.Background(), filepath.Join(t.TempDir(), "ausente.gguf"))
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("erro = %v, quer ErrUnavailable", err)
	}
}

// WITH_LLAMA=0 entrega um stub que sai com erro; o runtime precisa aparecer
// indisponivel em vez de prometer uma analise que nao roda.
func TestAvailableRejectsDisabledBinary(t *testing.T) {
	server := NewServer(fakeServerBinary(t, 1), 0, 1, 0, nil)
	t.Cleanup(server.Close)
	if server.Available() {
		t.Fatal("stub desabilitado nao pode ser considerado disponivel")
	}
	_, err := server.Acquire(context.Background(), filepath.Join(t.TempDir(), "model.gguf"))
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("erro = %v, quer ErrUnavailable", err)
	}
}

func waitFor(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condicao nao atendida no prazo")
}
