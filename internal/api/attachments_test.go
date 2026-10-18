package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestParseRange(t *testing.T) {
	cases := []struct {
		header     string
		size       int64
		start, end int64
		partial    bool
	}{
		{"", 100, 0, 99, false},
		{"bytes=0-9", 100, 0, 9, true},
		{"bytes=10-", 100, 10, 99, true},
		{"bytes=-10", 100, 90, 99, true},
		{"bytes=50-200", 100, 50, 99, true},
		{"bytes=200-300", 100, 0, 99, false},
	}
	for _, c := range cases {
		start, end, partial := parseRange(c.header, c.size)
		if start != c.start || end != c.end || partial != c.partial {
			t.Errorf("parseRange(%q, %d) = %d,%d,%v; queria %d,%d,%v",
				c.header, c.size, start, end, partial, c.start, c.end, c.partial)
		}
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

// Range requests must return exactly the requested window without decrypting
// the whole object, and the response must be cacheable for a long time because
// an attachment id never changes content.
func TestAttachmentRangeAndConditional(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	data := bytes.Repeat([]byte("0123456789"), 300000) // ~3 MiB, several records

	att, err := srv.deps.Ingest.PutAttachment(context.Background(), "e1", "image", "image/png", bytes.NewReader(data), 10<<20)
	if err != nil {
		t.Fatalf("put attachment: %v", err)
	}
	path := "/api/v1/attachments/" + att.ID

	for _, rg := range [][2]int{{0, 0}, {123, 456}, {len(data) - 10, len(data) - 1}, {1 << 20, (1 << 20) + 25}} {
		req := authedRequest(http.MethodGet, path, nil)
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", rg[0], rg[1]))
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusPartialContent {
			t.Fatalf("range %v: status %d", rg, rec.Code)
		}
		if !bytes.Equal(rec.Body.Bytes(), data[rg[0]:rg[1]+1]) {
			t.Fatalf("range %v: corpo difere (%d bytes)", rg, rec.Body.Len())
		}
		if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
			t.Fatalf("cache-control = %q", cc)
		}
	}

	req := authedRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("full get: status %d", rec.Code)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("sem ETag")
	}
	req = authedRequest(http.MethodGet, path, nil)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
		t.Fatalf("condicional: status %d body %d", rec.Code, rec.Body.Len())
	}

	// HEAD returns metadata only, without decrypting the body.
	req = authedRequest(http.MethodHead, path, nil)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("head: status %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("head body = %d bytes", rec.Body.Len())
	}
	if got := rec.Header().Get("Content-Length"); got != fmt.Sprint(len(data)) {
		t.Fatalf("head content-length = %q, want %d", got, len(data))
	}
}

func TestSegmentsPagination(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e1")
	ctx := context.Background()
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
		ID: "a1", EntryID: "e1", Kind: store.AttachmentOriginal, StorageKey: "objects/a1",
		ContentType: "audio/wav", SizeBytes: 10, Cipher: "aes-256-gcm", DurationSeconds: 12, CreatedAt: now,
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	segs := []store.Segment{
		{ID: "s1", StartMS: 0, EndMS: 1000, Text: "um"},
		{ID: "s2", StartMS: 1000, EndMS: 2000, Text: "dois"},
		{ID: "s3", StartMS: 2000, EndMS: 3000, Text: "tres"},
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t1", EntryID: "e1", AttachmentID: "a1", Model: "local", Text: "um dois tres", CreatedAt: now,
	}, segs); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	rec, page := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/segments?attachment_id=a1&limit=2", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("page 1: %d %s", rec.Code, rec.Body.String())
	}
	if got, _ := page["segments"].([]any); len(got) != 2 {
		t.Fatalf("page 1 segments = %v", page["segments"])
	}
	cursor, _ := page["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("sem next_cursor: %v", page)
	}
	_, next := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/segments?attachment_id=a1&limit=2&cursor="+cursor, nil)
	if got, _ := next["segments"].([]any); len(got) != 1 {
		t.Fatalf("page 2 segments = %v", next["segments"])
	}
	if _, ok := next["next_cursor"]; ok {
		t.Fatalf("ultima pagina nao deveria ter cursor: %v", next)
	}

	// The full entry payload carries the transcript text but not the segments.
	_, entry := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1", nil)
	audios, _ := entry["audios"].([]any)
	if len(audios) != 1 {
		t.Fatalf("audios = %v", entry["audios"])
	}
	audio, _ := audios[0].(map[string]any)
	transcript, _ := audio["transcript"].(map[string]any)
	if _, ok := transcript["segments"]; ok {
		t.Fatalf("entry nao deveria carregar segmentos: %v", transcript)
	}
	if transcript["text"] != "um dois tres" {
		t.Fatalf("texto do entry = %v", transcript["text"])
	}
}
