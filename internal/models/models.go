// Package models manages the local whisper.cpp models: it lists which models
// are present on disk and downloads new ones, reporting progress through the
// event bus so the dashboard can show a download bar.
package models

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/joseti/dyarium/internal/events"
)

// Info describes a model in the catalog.
type Info struct {
	Name       string `json:"name"`
	Filename   string `json:"filename"`
	SizeMB     int    `json:"size_mb"`
	Path       string `json:"path"`
	Downloaded bool   `json:"downloaded"`
	LocalBytes int64  `json:"local_bytes"`
}

// CatalogEntry is a known model.
type CatalogEntry struct {
	Name     string
	Filename string
	SizeMB   int
}

// Catalog lists the supported whisper.cpp models.
var Catalog = []CatalogEntry{
	{"tiny", "ggml-tiny.bin", 75},
	{"base", "ggml-base.bin", 142},
	{"small-q5_1", "ggml-small-q5_1.bin", 182},
	{"medium-q5_0", "ggml-medium-q5_0.bin", 515},
	{"large-v3-q5_0", "ggml-large-v3-q5_0.bin", 1081},
}

// Manager tracks local models and downloads.
type Manager struct {
	dir     string
	baseURL string
	bus     *events.Bus
	http    *http.Client
	mu      sync.Mutex
	active  map[string]bool
}

// NewManager builds a Manager. baseURL is the directory-like URL where model
// files are hosted.
func NewManager(dir, baseURL string, bus *events.Bus) *Manager {
	return &Manager{
		dir:     dir,
		baseURL: baseURL,
		bus:     bus,
		http:    &http.Client{Timeout: 0},
		active:  map[string]bool{},
	}
}

// List returns the catalog with local availability.
func (m *Manager) List() []Info {
	out := make([]Info, 0, len(Catalog))
	for _, c := range Catalog {
		path := filepath.Join(m.dir, c.Filename)
		info := Info{Name: c.Name, Filename: c.Filename, SizeMB: c.SizeMB, Path: path}
		if st, err := os.Stat(path); err == nil && st.Size() > 0 {
			info.Downloaded = true
			info.LocalBytes = st.Size()
		}
		out = append(out, info)
	}
	return out
}

// Path returns the local path of a catalog model.
func (m *Manager) Path(name string) (string, bool) {
	if c, ok := find(name); ok {
		return filepath.Join(m.dir, c.Filename), true
	}
	return "", false
}

// Active reports whether a download is in progress for the model.
func (m *Manager) Active(name string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.active[name]
}

// StartDownload begins downloading a model in the background.
func (m *Manager) StartDownload(name string) error {
	c, ok := find(name)
	if !ok {
		return fmt.Errorf("modelo desconhecido: %s", name)
	}
	m.mu.Lock()
	if m.active[name] {
		m.mu.Unlock()
		return fmt.Errorf("download ja em andamento")
	}
	m.active[name] = true
	m.mu.Unlock()
	go m.download(c)
	return nil
}

func (m *Manager) download(c CatalogEntry) {
	defer func() {
		m.mu.Lock()
		delete(m.active, c.Name)
		m.mu.Unlock()
	}()
	if err := os.MkdirAll(m.dir, 0o750); err != nil {
		m.emit(c.Name, 0, 0, true, err.Error())
		return
	}
	url := m.baseURL + "/" + c.Filename
	resp, err := m.http.Get(url)
	if err != nil {
		m.emit(c.Name, 0, 0, true, err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		m.emit(c.Name, 0, 0, true, fmt.Sprintf("status %d", resp.StatusCode))
		return
	}
	total := resp.ContentLength
	dst := filepath.Join(m.dir, c.Filename)
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		m.emit(c.Name, 0, total, true, err.Error())
		return
	}
	buf := make([]byte, 1<<20)
	var received int64
	last := time.Now()
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				os.Remove(tmp)
				m.emit(c.Name, received, total, true, werr.Error())
				return
			}
			received += int64(n)
			if time.Since(last) > 500*time.Millisecond {
				m.emit(c.Name, received, total, false, "")
				last = time.Now()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			os.Remove(tmp)
			m.emit(c.Name, received, total, true, rerr.Error())
			return
		}
	}
	f.Close()
	if err := os.Rename(tmp, dst); err != nil {
		m.emit(c.Name, received, total, true, err.Error())
		return
	}
	m.emit(c.Name, received, total, true, "")
}

func (m *Manager) emit(name string, received, total int64, done bool, errMsg string) {
	m.bus.Publish("model.download", map[string]any{
		"name":     name,
		"received": received,
		"total":    total,
		"done":     done,
		"error":    errMsg,
	})
}

func find(name string) (CatalogEntry, bool) {
	for _, c := range Catalog {
		if c.Name == name {
			return c, true
		}
	}
	return CatalogEntry{}, false
}
