// Package llm manages the embedded llama.cpp runtime used by the local
// analysis. The model is a GGUF file downloaded on demand; the server process
// is started only while an analysis runs and is released after an idle period,
// so a small VPS does not keep the weights resident all day.
package llm

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// Model describes one GGUF model the embedded runtime can load.
type Model struct {
	Name     string
	Filename string
	URL      string
	SizeMB   int
}

// Catalog lists the models the embedded runtime knows. One small model is
// enough for the first version: the same analysis quality as the default
// Ollama model, without the Ollama service.
var Catalog = []Model{
	{
		Name:     "qwen2.5-0.5b-instruct-q4_k_m",
		Filename: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
		URL:      "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
		SizeMB:   469,
	},
}

// DefaultModel is the model the dashboard offers for the embedded runtime.
const DefaultModel = "qwen2.5-0.5b-instruct-q4_k_m"

// ErrUnavailable marks a missing binary or model: retrying will not fix it.
var ErrUnavailable = errors.New("llm: runtime local indisponivel")

// Progress is one event of a model download. Total is 0 when the server does
// not send a content length.
type Progress struct {
	Received int64
	Total    int64
	Done     bool
}

// Info describes a catalog model with its local state.
type Info struct {
	Name       string `json:"name"`
	Filename   string `json:"filename"`
	SizeMB     int    `json:"size_mb"`
	Path       string `json:"path"`
	Downloaded bool   `json:"downloaded"`
	LocalBytes int64  `json:"local_bytes"`
}

// Store is the slice of Manager the API and the workers need. It keeps the
// tests independent from the Hugging Face download.
type Store interface {
	Downloaded(name string) bool
	Path(name string) (string, bool)
	Download(ctx context.Context, name string, report func(Progress)) error
}

// Manager tracks the GGUF models on disk and downloads new ones.
type Manager struct {
	dir  string
	http *http.Client
}

// NewManager builds a Manager rooted at dir.
func NewManager(dir string) *Manager {
	return &Manager{dir: dir, http: &http.Client{}}
}

// List returns the catalog with local availability.
func (m *Manager) List() []Info {
	out := make([]Info, 0, len(Catalog))
	for _, model := range Catalog {
		path := filepath.Join(m.dir, model.Filename)
		info := Info{Name: model.Name, Filename: model.Filename, SizeMB: model.SizeMB, Path: path}
		if st, err := os.Stat(path); err == nil && st.Size() > 0 {
			info.Downloaded = true
			info.LocalBytes = st.Size()
		}
		out = append(out, info)
	}
	return out
}

// Find returns the catalog entry for name.
func Find(name string) (Model, bool) {
	for _, model := range Catalog {
		if model.Name == name {
			return model, true
		}
	}
	return Model{}, false
}

// Path returns the local path of a catalog model.
func (m *Manager) Path(name string) (string, bool) {
	model, ok := Find(name)
	if !ok {
		return "", false
	}
	return filepath.Join(m.dir, model.Filename), true
}

// Downloaded reports whether the model file is present and non-empty.
func (m *Manager) Downloaded(name string) bool {
	path, ok := m.Path(name)
	if !ok {
		return false
	}
	st, err := os.Stat(path)
	return err == nil && st.Size() > 0
}

// Download fetches the model and reports progress until the file is renamed
// into place. A partial file never becomes visible as a valid model.
func (m *Manager) Download(ctx context.Context, name string, report func(Progress)) error {
	model, ok := Find(name)
	if !ok {
		return fmt.Errorf("llm: modelo desconhecido: %s", name)
	}
	if err := os.MkdirAll(m.dir, 0o750); err != nil {
		return fmt.Errorf("llm: criar diretorio: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, model.URL, nil)
	if err != nil {
		return err
	}
	resp, err := m.http.Do(req)
	if err != nil {
		return fmt.Errorf("llm: download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("llm: download: status %d", resp.StatusCode)
	}

	dst := filepath.Join(m.dir, model.Filename)
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("llm: criar arquivo: %w", err)
	}
	// On any failure the partial file is removed; on success it is renamed.
	published := false
	defer func() {
		if !published {
			f.Close()
			os.Remove(tmp)
		}
	}()

	total := resp.ContentLength
	buf := make([]byte, 1<<20)
	var received int64
	last := time.Now()
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := f.Write(buf[:n]); writeErr != nil {
				return fmt.Errorf("llm: gravar modelo: %w", writeErr)
			}
			received += int64(n)
			if time.Since(last) >= 500*time.Millisecond {
				reportProgress(report, Progress{Received: received, Total: total})
				last = time.Now()
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return fmt.Errorf("llm: download: %w", readErr)
		}
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("llm: fechar modelo: %w", err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		return fmt.Errorf("llm: publicar modelo: %w", err)
	}
	published = true
	reportProgress(report, Progress{Received: received, Total: total, Done: true})
	return nil
}

func reportProgress(report func(Progress), progress Progress) {
	if report != nil {
		report(progress)
	}
}
