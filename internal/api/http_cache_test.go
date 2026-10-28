package api

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// JSON responses must be compressible and must support conditional requests:
// the dashboard reopens notes constantly and should get 304 instead of the
// whole payload.
func TestJSONGzipAndETag(t *testing.T) {
	srv := newTestServer(t)

	req := authedRequest(http.MethodGet, "/api/v1/version", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if enc := rec.Header().Get("Content-Encoding"); enc != "gzip" {
		t.Fatalf("content-encoding = %q", enc)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("sem ETag")
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}
	body, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("read gzip: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if parsed["version"] != "test" {
		t.Fatalf("body = %v", parsed)
	}

	req = authedRequest(http.MethodGet, "/api/v1/version", nil)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Fatalf("condicional status = %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("304 body = %d bytes", rec.Body.Len())
	}
}

func TestEtagMatches(t *testing.T) {
	cases := []struct {
		header, etag string
		want         bool
	}{
		{"", "", false},
		{`"a"`, "", false},
		{"", `"a"`, false},
		{`"a"`, `"a"`, true},
		{`W/"a"`, `"a"`, true},
		{`"b", "a"`, `"a"`, true},
		{`*`, `"a"`, true},
		{`"b"`, `"a"`, false},
	}
	for _, c := range cases {
		if got := etagMatches(c.header, c.etag); got != c.want {
			t.Errorf("etagMatches(%q, %q) = %v, want %v", c.header, c.etag, got, c.want)
		}
	}
}

func TestStaticAssetWithoutValidatorIsServed(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("index sem If-None-Match: status %d (nao pode virar 304)", rec.Code)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("index veio vazio")
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("cache-control = %q", cc)
	}
}

func TestShouldGzip(t *testing.T) {
	cases := []struct {
		contentType string
		want        bool
	}{
		{"application/json; charset=utf-8", true},
		{"text/css; charset=utf-8", true},
		{"application/javascript", true},
		{"image/svg+xml", true},
		{"text/event-stream", false},
		{"image/png", false},
		{"audio/aac", false},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		header := http.Header{}
		header.Set("Content-Type", c.contentType)
		if got := shouldGzip(req, header); got != c.want {
			t.Errorf("shouldGzip(%q) = %v, want %v", c.contentType, got, c.want)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	if shouldGzip(req, header) {
		t.Error("nao deveria comprimir sem Accept-Encoding")
	}
}

func TestJSONETagWithoutGzip(t *testing.T) {
	srv := newTestServer(t)
	req := authedRequest(http.MethodGet, "/api/v1/version", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if enc := rec.Header().Get("Content-Encoding"); enc != "" {
		t.Fatalf("content-encoding = %q", enc)
	}
	if rec.Header().Get("ETag") == "" {
		t.Fatal("sem ETag")
	}
	if vary := rec.Header().Get("Vary"); vary != "Accept-Encoding" {
		t.Fatalf("vary = %q", vary)
	}
}
