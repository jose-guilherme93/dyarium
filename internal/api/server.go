// Package api implements the HTTP server, authentication and the embedded
// dashboard.
package api

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/store"
	"github.com/joseti/dyarium/internal/webui"
)

// Server holds the HTTP handlers and their dependencies.
type Server struct {
	cfg     config.Config
	store   *store.Store
	logger  *slog.Logger
	version Version
}

// Version describes the build metadata reported by the API.
type Version struct {
	Version string
	Commit  string
	BuiltAt string
}

// New builds a Server.
func New(cfg config.Config, st *store.Store, logger *slog.Logger, version Version) *Server {
	return &Server{cfg: cfg, store: st, logger: logger, version: version}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.handleHealth)

	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/v1/version", s.handleVersion)
	mux.Handle("/api/v1/", s.requireAuth(protected))

	mux.Handle("/", s.spaHandler())

	return s.withLogging(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"version": s.version.Version,
	})
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"version":  s.version.Version,
		"commit":   s.version.Commit,
		"built_at": s.version.BuiltAt,
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
		s.logger.Info("http", "method", r.Method, "path", r.URL.Path)
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
