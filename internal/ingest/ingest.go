// Package ingest handles resumable uploads, integrity validation and entry
// creation. The request handlers are implemented in a later phase; this file
// defines the service surface and its limits.
package ingest

import (
	"github.com/joseti/dyarium/internal/store"
)

// Config holds the upload limits.
type Config struct {
	MaxUploadBytes     int64
	MaxDurationSeconds int
	AllowedFormats     []string
}

// Service coordinates uploads and entry creation.
type Service struct {
	cfg   Config
	store *store.Store
}

// New builds a Service.
func New(cfg Config, st *store.Store) *Service {
	return &Service{cfg: cfg, store: st}
}

// AllowsFormat reports whether the given container format is accepted.
func (s *Service) AllowsFormat(format string) bool {
	for _, f := range s.cfg.AllowedFormats {
		if f == format {
			return true
		}
	}
	return false
}
