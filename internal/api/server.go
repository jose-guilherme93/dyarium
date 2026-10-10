// Package api implements the HTTP server, authentication and the embedded
// dashboard.
package api

import (
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/events"
	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
	"github.com/joseti/dyarium/internal/webui"
)

// Deps groups the server dependencies.
type Deps struct {
	Config   config.Config
	Store    *store.Store
	Logger   *slog.Logger
	Version  Version
	Ingest   *ingest.Service
	Queue    *jobs.Queue
	Analyzer *analyze.Client
	Events   *events.Bus
}

// Server holds the HTTP handlers and their dependencies.
type Server struct {
	deps Deps
}

// Version describes the build metadata reported by the API.
type Version struct {
	Version string
	Commit  string
	BuiltAt string
}

// New builds a Server.
func New(deps Deps) *Server {
	if deps.Events == nil {
		deps.Events = events.NewBus()
	}
	return &Server{deps: deps}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)

	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/v1/version", s.handleVersion)

	protected.HandleFunc("POST /api/v1/uploads", s.handleCreateUpload)
	protected.HandleFunc("PUT /api/v1/uploads/{id}", s.handlePutUpload)
	protected.HandleFunc("GET /api/v1/uploads/{id}", s.handleGetUpload)
	protected.HandleFunc("POST /api/v1/uploads/{id}/complete", s.handleCompleteUpload)

	protected.HandleFunc("GET /api/v1/entries", s.handleListEntries)
	protected.HandleFunc("GET /api/v1/entries/{id}", s.handleGetEntry)
	protected.HandleFunc("PATCH /api/v1/entries/{id}", s.handlePatchEntry)
	protected.HandleFunc("DELETE /api/v1/entries/{id}", s.handleDeleteEntry)
	protected.HandleFunc("GET /api/v1/entries/{id}/transcript", s.handleGetTranscript)
	protected.HandleFunc("POST /api/v1/entries/{id}/retranscribe", s.handleRetranscribe)
	protected.HandleFunc("GET /api/v1/entries/{id}/analysis", s.handleGetAnalysis)
	protected.HandleFunc("POST /api/v1/entries/{id}/analyze", s.handleAnalyze)

	protected.HandleFunc("GET /api/v1/entries/{id}/notes", s.handleListNotes)
	protected.HandleFunc("POST /api/v1/entries/{id}/notes", s.handleCreateNote)
	protected.HandleFunc("GET /api/v1/notes/{id}", s.handleGetNote)
	protected.HandleFunc("PUT /api/v1/notes/{id}", s.handleUpdateNote)
	protected.HandleFunc("DELETE /api/v1/notes/{id}", s.handleDeleteNote)
	protected.HandleFunc("GET /api/v1/notes/{id}/revisions", s.handleListRevisions)

	protected.HandleFunc("GET /api/v1/tags", s.handleListTags)
	protected.HandleFunc("POST /api/v1/tags", s.handleCreateTag)
	protected.HandleFunc("DELETE /api/v1/tags/{id}", s.handleDeleteTag)

	protected.HandleFunc("GET /api/v1/settings", s.handleGetSettings)
	protected.HandleFunc("PUT /api/v1/settings", s.handlePutSettings)

	protected.HandleFunc("GET /api/v1/events", s.handleEvents)

	mux.Handle("/api/v1/", s.requireAuth(protected))
	mux.Handle("/", s.spaHandler())
	return s.withLogging(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"version": s.deps.Version.Version,
	})
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"version":  s.deps.Version.Version,
		"commit":   s.deps.Version.Commit,
		"built_at": s.deps.Version.BuiltAt,
	})
}

// spaHandler serves the embedded dashboard, falling back to index.html so the
// single page application can handle client-side routes.
func (s *Server) spaHandler() http.Handler {
	dist, err := webui.Dist()
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusInternalServerError, "internal", "dashboard assets unavailable")
		})
	}
	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(dist, path); err != nil {
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.deps.Logger.Info("http", "method", r.Method, "path", r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

func decodeJSON(r *http.Request, out any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	return dec.Decode(out)
}
