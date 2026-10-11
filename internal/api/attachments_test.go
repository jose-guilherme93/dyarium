package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func seedPlainEntry(t *testing.T, srv *Server, id string) {
	t.Helper()
	now := time.Now().UTC()
	entry := store.Entry{ID: id, Title: id, Status: store.EntryStored, Source: "upload", CreatedAt: now, UpdatedAt: now}
	if err := srv.deps.Store.CreateEntry(context.Background(), entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
}

func authedRequest(method, path string, body io.Reader) *http.Request {
	req := httptest.NewRequest(method, path, body)
	req.Header.Set("Authorization", "Bearer token-de-teste")
	return req
}

func TestAttachmentLifecycle(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	image := []byte("PNGDATA")

	req := authedRequest(http.MethodPost, "/api/v1/entries/e1/attachments", bytes.NewReader(image))
	req.Header.Set("Content-Type", "image/png")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar anexo: status %d body %s", rec.Code, rec.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("anexo sem id: %s", rec.Body.String())
	}

	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/attachments", nil)
	list, _ := body["attachments"].([]any)
	if len(list) != 1 {
		t.Fatalf("lista de anexos = %+v", body)
	}

	req = authedRequest(http.MethodGet, "/api/v1/attachments/"+id, nil)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), image) {
		t.Fatalf("servir anexo: status %d body %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content-type = %q", ct)
	}

	req = authedRequest(http.MethodDelete, "/api/v1/attachments/"+id, nil)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("apagar anexo: status %d", rec.Code)
	}

	rec, _ = doJSON(t, srv, http.MethodGet, "/api/v1/attachments/"+id, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("apos apagar: status %d, want 404", rec.Code)
	}
}

func TestAttachmentRejectsNonImage(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	req := authedRequest(http.MethodPost, "/api/v1/entries/e1/attachments", bytes.NewReader([]byte("txt")))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestAttachmentRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/entries/e1/attachments", bytes.NewReader([]byte("x"))))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sem token: status = %d, want 401", rec.Code)
	}
}

func TestEntryAudioStream(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	audio := []byte("AUDIOBYTES")
	if _, err := srv.deps.Ingest.PutAttachment(context.Background(), "e1", store.AttachmentOriginal, "audio/wav", bytes.NewReader(audio), 1<<20); err != nil {
		t.Fatalf("put audio: %v", err)
	}
	req := authedRequest(http.MethodGet, "/api/v1/entries/e1/audio", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), audio) {
		t.Fatalf("audio: status %d body %q", rec.Code, rec.Body.String())
	}
}
