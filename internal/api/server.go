// Package api implements the HTTP server, authentication and the embedded
// dashboard.
package api

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/events"
	"github.com/joseti/dyarium/internal/ingest"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/llm"
	"github.com/joseti/dyarium/internal/models"
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
	Models   *models.Manager
	// LocalAI is the embedded llama.cpp runtime; LLMModels is its GGUF store.
	// Both are nil when the build does not include llama-server.
	LocalAI   llm.Runner
	LLMModels llm.Store
	Canceller *jobs.Canceller
	Tokens    *TokenSource
}

// Server holds the HTTP handlers and their dependencies.
type Server struct {
	deps    Deps
	pullsMu sync.Mutex
	pulls   map[string]*localPullState
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
	if deps.Tokens == nil {
		deps.Tokens = NewTokenSource(deps.Config.Token, false)
	}
	return &Server{deps: deps, pulls: map[string]*localPullState{}}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /setup/state", s.handleSetupState)
	mux.HandleFunc("POST /setup", s.handleSetupClaim)

	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/v1/version", s.handleVersion)

	protected.HandleFunc("POST /api/v1/uploads", s.handleCreateUpload)
	protected.HandleFunc("PUT /api/v1/uploads/{id}", s.handlePutUpload)
	protected.HandleFunc("GET /api/v1/uploads/{id}", s.handleGetUpload)
	protected.HandleFunc("POST /api/v1/uploads/{id}/complete", s.handleCompleteUpload)

	protected.HandleFunc("GET /api/v1/entries", s.handleListEntries)
	protected.HandleFunc("POST /api/v1/entries", s.handleCreateEntry)
	protected.HandleFunc("GET /api/v1/entries/{id}", s.handleGetEntry)
	protected.HandleFunc("PATCH /api/v1/entries/{id}", s.handlePatchEntry)
	protected.HandleFunc("DELETE /api/v1/entries/{id}", s.handleDeleteEntry)
	protected.HandleFunc("POST /api/v1/entries/{id}/restore", s.handleRestoreEntry)
	protected.HandleFunc("GET /api/v1/entries/{id}/audio", s.handleGetEntryAudio)
	protected.HandleFunc("GET /api/v1/entries/{id}/attachments", s.handleListAttachments)
	protected.HandleFunc("POST /api/v1/entries/{id}/attachments", s.handleCreateAttachment)
	protected.HandleFunc("GET /api/v1/attachments/{id}", s.handleGetAttachment)
	protected.HandleFunc("DELETE /api/v1/attachments/{id}", s.handleDeleteAttachment)

	protected.HandleFunc("GET /api/v1/entries/{id}/transcript", s.handleGetTranscript)
	protected.HandleFunc("GET /api/v1/entries/{id}/segments", s.handleListSegments)
	protected.HandleFunc("PUT /api/v1/entries/{id}/transcript", s.handlePutTranscript)
	protected.HandleFunc("PUT /api/v1/entries/{id}/transcript/revisions", s.handlePutTranscriptRevisions)
	protected.HandleFunc("POST /api/v1/entries/{id}/retranscribe", s.handleRetranscribe)
	protected.HandleFunc("POST /api/v1/entries/{id}/cancel", s.handleCancelEntry)
	protected.HandleFunc("GET /api/v1/entries/{id}/analysis", s.handleGetAnalysis)
	protected.HandleFunc("PUT /api/v1/entries/{id}/analysis", s.handlePutAnalysis)
	protected.HandleFunc("POST /api/v1/entries/{id}/analyze", s.handleAnalyze)

	protected.HandleFunc("GET /api/v1/entities", s.handleListEntities)
	protected.HandleFunc("GET /api/v1/entities/{kind}/{name}", s.handleGetEntity)
	protected.HandleFunc("PATCH /api/v1/entities/{kind}/{name}", s.handleRenameEntity)
	protected.HandleFunc("POST /api/v1/entities/person/{name}/self", s.handleClaimSelf)
	protected.HandleFunc("PUT /api/v1/entities/{kind}/{name}/icon", s.handleSetEntityIcon)
	protected.HandleFunc("GET /api/v1/graph", s.handleGraph)
	protected.HandleFunc("GET /api/v1/mood", s.handleMood)
	protected.HandleFunc("GET /api/v1/analysis/runs/summary", s.handleAnalysisRunsSummary)

	protected.HandleFunc("PUT /api/v1/metrics", s.handlePutMetrics)
	protected.HandleFunc("GET /api/v1/metrics", s.handleListMetrics)
	protected.HandleFunc("DELETE /api/v1/metrics/{device_id}", s.handleDeleteMetrics)

	protected.HandleFunc("GET /api/v1/entries/{id}/notes", s.handleListNotes)
	protected.HandleFunc("POST /api/v1/entries/{id}/notes", s.handleCreateNote)
	protected.HandleFunc("GET /api/v1/notes/{id}", s.handleGetNote)
	protected.HandleFunc("PUT /api/v1/notes/{id}", s.handleUpdateNote)
	protected.HandleFunc("DELETE /api/v1/notes/{id}", s.handleDeleteNote)
	protected.HandleFunc("GET /api/v1/notes/{id}/revisions", s.handleListRevisions)

	protected.HandleFunc("GET /api/v1/entries/{id}/tags", s.handleListEntryTags)
	protected.HandleFunc("PUT /api/v1/entries/{id}/tags", s.handleSetEntryTags)

	protected.HandleFunc("GET /api/v1/entries/{id}/links", s.handleListLinks)
	protected.HandleFunc("POST /api/v1/entries/{id}/links", s.handleCreateLink)
	protected.HandleFunc("DELETE /api/v1/links/{id}", s.handleDeleteLink)

	protected.HandleFunc("GET /api/v1/tags", s.handleListTags)
	protected.HandleFunc("POST /api/v1/tags", s.handleCreateTag)
	protected.HandleFunc("PATCH /api/v1/tags/{id}", s.handleUpdateTag)
	protected.HandleFunc("DELETE /api/v1/tags/{id}", s.handleDeleteTag)

	protected.HandleFunc("GET /api/v1/notebooks", s.handleListNotebooks)
	protected.HandleFunc("POST /api/v1/notebooks", s.handleCreateNotebook)
	protected.HandleFunc("PATCH /api/v1/notebooks/{id}", s.handleUpdateNotebook)
	protected.HandleFunc("DELETE /api/v1/notebooks/{id}", s.handleDeleteNotebook)

	protected.HandleFunc("GET /api/v1/settings", s.handleGetSettings)
	protected.HandleFunc("PUT /api/v1/settings", s.handlePutSettings)
	protected.HandleFunc("GET /api/v1/analyze/models", s.handleListAnalyzeModels)
	protected.HandleFunc("GET /api/v1/analyze/local", s.handleLocalAnalysis)
	protected.HandleFunc("POST /api/v1/analyze/local", s.handleSetupLocalAnalysis)

	protected.HandleFunc("GET /api/v1/models", s.handleListModels)
	protected.HandleFunc("POST /api/v1/models/download", s.handleDownloadModel)

	protected.HandleFunc("GET /api/v1/activities", s.handleListActivities)

	protected.HandleFunc("GET /api/v1/events", s.handleEvents)

	mux.Handle("/api/v1/", s.requireAuth(protected))
	mux.Handle("/", s.spaHandler())
	return s.withLogging(s.withResponseCache(mux))
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
			path = "index.html"
		}
		// Vite puts a content hash in every asset name, so they can be cached
		// forever. index.html must always be revalidated, and the service worker
		// must never be pinned. Fonts are not hashed: keep them on a shorter TTL.
		switch {
		case strings.HasPrefix(path, "assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case path == "index.html":
			w.Header().Set("Cache-Control", "no-cache")
		case strings.HasPrefix(path, "fonts/"):
			w.Header().Set("Cache-Control", "public, max-age=604800")
		default:
			w.Header().Set("Cache-Control", "no-cache")
		}
		fileServer.ServeHTTP(w, r)
	})
}

// withResponseCache adds HTTP validators and gzip to JSON responses, and answers
// If-None-Match with 304. Handlers stay unaware of it: writeJSON publishes the
// ETag and the wrapper decides whether to reuse the cached representation.
func (s *Server) withResponseCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cw := &responseCacheWriter{ResponseWriter: w, req: r}
		next.ServeHTTP(cw, r)
		cw.close()
	})
}

type responseCacheWriter struct {
	http.ResponseWriter
	req     *http.Request
	decided bool
	notMod  bool
	gz      *gzip.Writer
}

func (w *responseCacheWriter) WriteHeader(status int) {
	if w.decided {
		return
	}
	w.decided = true
	header := w.Header()
	if status == http.StatusOK && w.req.Method != http.MethodPost && w.req.Header.Get("Range") == "" &&
		etagMatches(w.req.Header.Get("If-None-Match"), header.Get("ETag")) {
		w.notMod = true
		w.ResponseWriter.WriteHeader(http.StatusNotModified)
		return
	}
	if status == http.StatusOK && shouldGzip(w.req, header) {
		header.Set("Content-Encoding", "gzip")
		header.Del("Content-Length")
		appendVary(header, "Accept-Encoding")
		w.gz = gzip.NewWriter(w.ResponseWriter)
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseCacheWriter) Write(p []byte) (int, error) {
	if !w.decided {
		w.WriteHeader(http.StatusOK)
	}
	if w.notMod {
		// The client already has this representation: drop the body.
		return len(p), nil
	}
	if w.gz != nil {
		return w.gz.Write(p)
	}
	return w.ResponseWriter.Write(p)
}

func (w *responseCacheWriter) Flush() {
	if w.gz != nil {
		_ = w.gz.Flush()
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *responseCacheWriter) close() {
	if w.gz != nil {
		_ = w.gz.Close()
	}
}

func shouldGzip(r *http.Request, header http.Header) bool {
	if r.Method == http.MethodHead || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") || r.Header.Get("Range") != "" {
		return false
	}
	contentType := header.Get("Content-Type")
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false
	}
	if strings.HasPrefix(contentType, "application/json") {
		return true
	}
	// Static text assets (JS/CSS/SVG/HTML) are the bulk of the first load.
	compressible := strings.HasPrefix(contentType, "text/") ||
		strings.Contains(contentType, "javascript") ||
		strings.Contains(contentType, "svg")
	if !compressible {
		return false
	}
	if raw := header.Get("Content-Length"); raw != "" {
		if size, err := strconv.ParseInt(raw, 10, 64); err == nil && size < 1024 {
			return false
		}
	}
	return true
}

// appendVary adds a value to Vary without discarding existing entries.
func appendVary(header http.Header, value string) {
	for _, existing := range header.Values("Vary") {
		for _, item := range strings.Split(existing, ",") {
			if strings.EqualFold(strings.TrimSpace(item), value) {
				return
			}
		}
	}
	header.Add("Vary", value)
}

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.deps.Logger.Info("http", "method", r.Method, "path", r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		// Never leave the client with an empty 200: marshal errors are bugs in
		// the handler, so report a generic 500.
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"code":"internal","message":"resposta indisponivel"}}` + "\n"))
		return
	}
	body = append(body, '\n')
	sum := sha256.Sum256(body)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:8])+`"`)
	appendVary(w.Header(), "Accept-Encoding")
	w.WriteHeader(status)
	_, _ = w.Write(body)
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
