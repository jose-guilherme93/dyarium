// Package ingest handles resumable uploads, integrity validation and entry
// creation. Bytes are encrypted in streaming as they arrive, so no plaintext is
// ever persisted to disk.
package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/audio"
	"github.com/joseti/dyarium/internal/crypto"
	"github.com/joseti/dyarium/internal/id"
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
	cfg     Config
	store   *store.Store
	key     []byte
	dataDir string
	prober  *audio.Prober
}

// New builds a Service.
func New(cfg Config, st *store.Store, key []byte, dataDir string, prober *audio.Prober) *Service {
	return &Service{cfg: cfg, store: st, key: key, dataDir: dataDir, prober: prober}
}

// Meta is the metadata supplied when starting an upload.
type Meta struct {
	Filename    string
	ContentType string
	SizeBytes   int64
	// SHA256 is optional. When empty, the server computes and stores the hash
	// of the received content at Complete without comparing it to anything.
	SHA256 string
	// Title and RecordedAt are optional client-provided metadata applied to the
	// entry created at Complete.
	Title      string
	RecordedAt *time.Time
	// ClientKey makes Start idempotent: repeating it returns the same upload.
	ClientKey string
}

// Error carries an HTTP status so handlers can map failures precisely.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func newError(status int, code, msg string) *Error {
	return &Error{Status: status, Code: code, Message: msg}
}

// Start reserves a new upload and writes the ciphertext stream header.
func (s *Service) Start(ctx context.Context, meta Meta) (store.Upload, error) {
	clientKey := strings.TrimSpace(meta.ClientKey)
	if clientKey != "" {
		existing, ok, err := s.store.GetUploadByClientKey(ctx, clientKey)
		if err != nil {
			return store.Upload{}, err
		}
		if ok {
			return existing, nil
		}
	}
	sha := strings.ToLower(strings.TrimSpace(meta.SHA256))
	if sha != "" {
		if len(sha) != 64 {
			return store.Upload{}, newError(400, "invalid_sha256", "sha256 deve ter 64 caracteres hexadecimais")
		}
		if _, err := hex.DecodeString(sha); err != nil {
			return store.Upload{}, newError(400, "invalid_sha256", "sha256 invalido")
		}
	}
	if meta.SizeBytes <= 0 {
		return store.Upload{}, newError(400, "invalid_size", "tamanho deve ser maior que zero")
	}
	if meta.SizeBytes > s.cfg.MaxUploadBytes {
		return store.Upload{}, newError(413, "too_large", "arquivo excede o tamanho maximo")
	}
	format := formatOf(meta.Filename)
	if !s.allowsFormat(format) {
		return store.Upload{}, newError(422, "unsupported_format", "formato nao suportado: "+format)
	}

	prefix, err := crypto.NewPrefix()
	if err != nil {
		return store.Upload{}, fmt.Errorf("ingest: prefix: %w", err)
	}
	uploadID := id.New()
	storageKey := filepath.Join("objects", uploadID+".enc")
	path := filepath.Join(s.dataDir, storageKey)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return store.Upload{}, fmt.Errorf("ingest: mkdir: %w", err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return store.Upload{}, fmt.Errorf("ingest: create object: %w", err)
	}
	if err := crypto.WriteHeader(f, prefix); err != nil {
		f.Close()
		return store.Upload{}, fmt.Errorf("ingest: write header: %w", err)
	}
	if err := f.Close(); err != nil {
		return store.Upload{}, fmt.Errorf("ingest: close object: %w", err)
	}

	now := time.Now().UTC()
	u := store.Upload{
		ID:          uploadID,
		Status:      "open",
		Filename:    meta.Filename,
		ContentType: meta.ContentType,
		SizeBytes:   meta.SizeBytes,
		SHA256:      sha,
		Title:       strings.TrimSpace(meta.Title),
		RecordedAt:  meta.RecordedAt,
		ClientKey:   clientKey,
		StorageKey:  storageKey,
		Prefix:      prefix[:],
		NextCounter: 0,
		CreatedAt:   now,
		ExpiresAt:   now.Add(24 * time.Hour),
	}
	if err := s.store.CreateUpload(ctx, u); err != nil {
		return store.Upload{}, err
	}
	return u, nil
}

// Get returns the upload state so a client can resume.
func (s *Service) Get(ctx context.Context, uploadID string) (store.Upload, error) {
	u, err := s.store.GetUpload(ctx, uploadID)
	if err != nil {
		return store.Upload{}, newError(404, "not_found", "upload inexistente")
	}
	return u, nil
}

// Append writes a resumable chunk encrypted at rest, returning the new offset.
func (s *Service) Append(ctx context.Context, uploadID string, offset int64, body io.Reader) (int64, error) {
	u, err := s.Get(ctx, uploadID)
	if err != nil {
		return 0, err
	}
	if u.Status != "open" {
		return 0, newError(409, "not_open", "upload nao esta aberto")
	}
	if offset != u.ReceivedBytes {
		return 0, newError(409, "offset_mismatch", fmt.Sprintf("offset esperado %d", u.ReceivedBytes))
	}
	remaining := u.SizeBytes - offset
	if remaining <= 0 {
		return offset, nil
	}

	var prefix [8]byte
	copy(prefix[:], u.Prefix)
	path := filepath.Join(s.dataDir, u.StorageKey)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return 0, fmt.Errorf("ingest: open object: %w", err)
	}
	defer f.Close()

	counter, written, err := crypto.Append(f, s.key, prefix, u.NextCounter, io.LimitReader(body, remaining))
	if err != nil {
		return 0, fmt.Errorf("ingest: append: %w", err)
	}
	if err := s.store.UpdateUploadProgress(ctx, uploadID, offset+written, counter); err != nil {
		return 0, err
	}
	return offset + written, nil
}

// CompleteResult reports the outcome of Complete. Duplicate is true when an
// active entry with the same sha256 already existed; Entry is then the
// pre-existing entry and no new entry or object is kept.
type CompleteResult struct {
	Entry     store.Entry
	Duplicate bool
}

// Complete validates size, format and SHA-256, then creates the entry. Because
// the audio is immutable, its sha256 is its identity: when the hash matches an
// existing active entry, no new entry is created. Instead the freshly received
// ciphertext is discarded and the existing entry is returned as a duplicate, so
// reimporting the same audio never duplicates it.
func (s *Service) Complete(ctx context.Context, uploadID string) (CompleteResult, error) {
	u, err := s.Get(ctx, uploadID)
	if err != nil {
		return CompleteResult{}, err
	}
	if u.Status != "open" {
		return CompleteResult{}, newError(409, "not_open", "upload nao esta aberto")
	}
	if u.ReceivedBytes != u.SizeBytes {
		return CompleteResult{}, newError(422, "incomplete", "upload incompleto")
	}

	path := filepath.Join(s.dataDir, u.StorageKey)
	f, err := os.Open(path)
	if err != nil {
		return CompleteResult{}, fmt.Errorf("ingest: open object: %w", err)
	}
	defer f.Close()

	tmp, err := os.CreateTemp("", "dyarium-verify-*.bin")
	if err != nil {
		return CompleteResult{}, fmt.Errorf("ingest: temp: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	hasher := sha256.New()
	n, err := crypto.Decrypt(f, s.key, io.MultiWriter(tmp, hasher))
	if err != nil {
		tmp.Close()
		return CompleteResult{}, newError(422, "corrupt", "falha ao decifrar o upload")
	}
	if err := tmp.Close(); err != nil {
		return CompleteResult{}, fmt.Errorf("ingest: close temp: %w", err)
	}

	if n != u.SizeBytes {
		return CompleteResult{}, newError(422, "size_mismatch", "tamanho do conteudo diverge do esperado")
	}
	sum := hex.EncodeToString(hasher.Sum(nil))
	if u.SHA256 != "" && sum != u.SHA256 {
		return CompleteResult{}, newError(422, "integrity", "sha256 do conteudo diverge do informado")
	}

	// Dedupe: se ja existe uma entrada ativa com o mesmo conteudo, nao cria
	// outra; descarta o objeto recem-recebido e devolve a entrada existente.
	if existing, ok, err := s.store.GetActiveEntryBySHA256(ctx, sum); err != nil {
		return CompleteResult{}, err
	} else if ok {
		if err := f.Close(); err != nil {
			return CompleteResult{}, fmt.Errorf("ingest: close object: %w", err)
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return CompleteResult{}, fmt.Errorf("ingest: remove duplicate object: %w", err)
		}
		if err := s.store.SetUploadStatus(ctx, uploadID, "duplicate"); err != nil {
			return CompleteResult{}, err
		}
		return CompleteResult{Entry: existing, Duplicate: true}, nil
	}

	var durationSeconds float64
	if s.prober != nil {
		d, err := s.prober.DurationSeconds(ctx, tmpPath)
		if err == nil {
			durationSeconds = d
			if s.cfg.MaxDurationSeconds > 0 && d > float64(s.cfg.MaxDurationSeconds) {
				return CompleteResult{}, newError(422, "too_long", "duracao excede o maximo permitido")
			}
		}
	}

	now := time.Now().UTC()
	title := strings.TrimSpace(u.Title)
	if title == "" {
		title = defaultTitle(u.Filename, now)
	}
	recordedAt := u.RecordedAt
	if recordedAt == nil {
		recordedAt = &now
	}
	entry := store.Entry{
		ID:               id.New(),
		Title:            title,
		Status:           store.EntryStored,
		Source:           "upload",
		OriginalFilename: u.Filename,
		ContentType:      u.ContentType,
		SizeBytes:        u.SizeBytes,
		DurationSeconds:  durationSeconds,
		SHA256:           sum,
		RecordedAt:       recordedAt,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := s.store.CreateEntry(ctx, entry); err != nil {
		return CompleteResult{}, err
	}
	attachment := store.Attachment{
		ID:          id.New(),
		EntryID:     entry.ID,
		Kind:        store.AttachmentOriginal,
		StorageKey:  u.StorageKey,
		ContentType: u.ContentType,
		SizeBytes:   u.SizeBytes,
		SHA256:      u.SHA256,
		Cipher:      "aes-256-gcm",
		CreatedAt:   now,
	}
	if err := s.store.CreateAttachment(ctx, attachment); err != nil {
		return CompleteResult{}, err
	}
	if err := s.store.SetUploadStatus(ctx, uploadID, "completed"); err != nil {
		return CompleteResult{}, err
	}
	return CompleteResult{Entry: entry}, nil
}

// DecryptToTemp decrypts the original audio of an entry into a restricted temp
// file and returns its path. The caller must remove it.
func (s *Service) DecryptToTemp(ctx context.Context, att store.Attachment) (string, error) {
	src := filepath.Join(s.dataDir, att.StorageKey)
	f, err := os.Open(src)
	if err != nil {
		return "", fmt.Errorf("ingest: open object: %w", err)
	}
	defer f.Close()
	tmp, err := os.CreateTemp("", "dyarium-audio-*.bin")
	if err != nil {
		return "", fmt.Errorf("ingest: temp: %w", err)
	}
	if _, err := crypto.Decrypt(f, s.key, tmp); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", fmt.Errorf("ingest: decrypt: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return tmp.Name(), nil
}

// IngestStream encrypts an audio stream directly into a new entry (used by the
// Telegram module and other non-resumable sources).
func (s *Service) IngestStream(ctx context.Context, source, filename, contentType string, data io.Reader) (store.Entry, error) {
	prefix, err := crypto.NewPrefix()
	if err != nil {
		return store.Entry{}, fmt.Errorf("ingest: prefix: %w", err)
	}
	entryID := id.New()
	storageKey := filepath.Join("objects", entryID+".enc")
	path := filepath.Join(s.dataDir, storageKey)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return store.Entry{}, fmt.Errorf("ingest: mkdir: %w", err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return store.Entry{}, fmt.Errorf("ingest: create object: %w", err)
	}
	defer f.Close()
	if err := crypto.WriteHeader(f, prefix); err != nil {
		return store.Entry{}, fmt.Errorf("ingest: header: %w", err)
	}
	hasher := sha256.New()
	tee := io.TeeReader(data, hasher)
	_, size, err := crypto.Append(f, s.key, prefix, 0, tee)
	if err != nil {
		return store.Entry{}, fmt.Errorf("ingest: append: %w", err)
	}
	if s.cfg.MaxUploadBytes > 0 && size > s.cfg.MaxUploadBytes {
		os.Remove(path)
		return store.Entry{}, newError(413, "too_large", "arquivo excede o tamanho maximo")
	}
	sum := hex.EncodeToString(hasher.Sum(nil))

	now := time.Now().UTC()
	entry := store.Entry{
		ID:               entryID,
		Title:            defaultTitle(filename, now),
		Status:           store.EntryStored,
		Source:           source,
		OriginalFilename: filename,
		ContentType:      contentType,
		SizeBytes:        size,
		SHA256:           sum,
		RecordedAt:       &now,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := s.store.CreateEntry(ctx, entry); err != nil {
		return store.Entry{}, err
	}
	att := store.Attachment{
		ID:          id.New(),
		EntryID:     entryID,
		Kind:        store.AttachmentOriginal,
		StorageKey:  storageKey,
		ContentType: contentType,
		SizeBytes:   size,
		SHA256:      sum,
		Cipher:      "aes-256-gcm",
		CreatedAt:   now,
	}
	if err := s.store.CreateAttachment(ctx, att); err != nil {
		return store.Entry{}, err
	}
	return entry, nil
}

func (s *Service) allowsFormat(format string) bool {
	if format == "" {
		return false
	}
	for _, f := range s.cfg.AllowedFormats {
		if f == format {
			return true
		}
	}
	return false
}

func formatOf(filename string) string {
	return strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))
}

// defaultTitle derives a non-empty title for an entry: the original file name
// (without directory and extension) when available, otherwise the recorded day
// and time. Toda entrada precisa de um titulo e de um dia no calendario.
func defaultTitle(filename string, at time.Time) string {
	base := strings.TrimSpace(strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename)))
	if base != "" {
		return base
	}
	return at.Format("02/01/2006 15:04")
}

// Key exposes the master key for the transcription pipeline.
func (s *Service) Key() []byte { return s.key }

// DataDir exposes the data directory.
func (s *Service) DataDir() string { return s.dataDir }

// GetDerived decrypts a cached derived audio into a temp file, if present.
func (s *Service) GetDerived(ctx context.Context, entryID, cacheKey string) (string, bool, error) {
	att, ok, err := s.store.GetAttachmentByCacheKey(ctx, entryID, cacheKey)
	if err != nil || !ok {
		return "", false, err
	}
	path, err := s.DecryptToTemp(ctx, att)
	if err != nil {
		return "", false, err
	}
	return path, true, nil
}

// SaveDerived encrypts a derived audio file and records it as a cached artifact.
func (s *Service) SaveDerived(ctx context.Context, entryID, cacheKey, contentType, srcPath string) error {
	prefix, err := crypto.NewPrefix()
	if err != nil {
		return fmt.Errorf("ingest: prefix: %w", err)
	}
	attID := id.New()
	storageKey := filepath.Join("objects", attID+"_16k.enc")
	dstPath := filepath.Join(s.dataDir, storageKey)
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o750); err != nil {
		return fmt.Errorf("ingest: mkdir: %w", err)
	}
	dst, err := os.OpenFile(dstPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("ingest: create derived: %w", err)
	}
	defer dst.Close()
	if err := crypto.WriteHeader(dst, prefix); err != nil {
		return fmt.Errorf("ingest: header: %w", err)
	}
	src, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("ingest: open derived source: %w", err)
	}
	defer src.Close()
	_, size, err := crypto.Append(dst, s.key, prefix, 0, src)
	if err != nil {
		return fmt.Errorf("ingest: encrypt derived: %w", err)
	}
	att := store.Attachment{
		ID:          attID,
		EntryID:     entryID,
		Kind:        store.AttachmentDerived16k,
		StorageKey:  storageKey,
		ContentType: contentType,
		SizeBytes:   size,
		Cipher:      "aes-256-gcm",
		CacheKey:    cacheKey,
		CreatedAt:   time.Now().UTC(),
	}
	return s.store.CreateAttachment(ctx, att)
}
