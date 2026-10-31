package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestCompleteUploadUsesClientAttachmentID(t *testing.T) {
	srv := newTestServer(t)
	plain := bytes.Repeat([]byte("audio-portatil-"), 20)
	sum := sha256.Sum256(plain)
	body, err := json.Marshal(map[string]any{
		"filename":     "nota.wav",
		"content_type": "audio/wav",
		"size_bytes":   len(plain),
		"sha256":       hex.EncodeToString(sum[:]),
		"title":        "nota",
		"entry_id":     "note_http",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, authedRequest(http.MethodPost, "/api/v1/uploads", bytes.NewReader(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create upload: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode upload: %v", err)
	}

	req := authedRequest(http.MethodPut, "/api/v1/uploads/"+created.ID, bytes.NewReader(plain))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Upload-Offset", "0")
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("append: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	req = authedRequest(http.MethodPost, "/api/v1/uploads/"+created.ID+"/complete", nil)
	req.Header.Set("X-Attachment-Id", "att_http")
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("complete: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var completed struct {
		EntryID      string `json:"entry_id"`
		AttachmentID string `json:"attachment_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &completed); err != nil {
		t.Fatalf("decode complete: %v", err)
	}
	if completed.EntryID != "note_http" || completed.AttachmentID != "att_http" {
		t.Fatalf("complete inesperado: %+v", completed)
	}

	// Repetir o complete nao cria outro audio e devolve o mesmo id.
	req = authedRequest(http.MethodPost, "/api/v1/uploads/"+created.ID+"/complete", nil)
	req.Header.Set("X-Attachment-Id", "att_http")
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("complete repetido: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var repeated struct {
		AttachmentID string `json:"attachment_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &repeated); err != nil {
		t.Fatalf("decode repeated: %v", err)
	}
	if repeated.AttachmentID != "att_http" {
		t.Fatalf("id mudou no retry: %q", repeated.AttachmentID)
	}
}

func TestCreateAttachmentUsesClientIDAndHashes(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateEntry(ctx, store.Entry{
		ID:        "e_img_http",
		Title:     "nota",
		Status:    store.EntryReady,
		Source:    "text",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	plain := bytes.Repeat([]byte("imagem-"), 30)
	sum := sha256.Sum256(plain)

	req := authedRequest(http.MethodPost, "/api/v1/entries/e_img_http/attachments", bytes.NewReader(plain))
	req.Header.Set("Content-Type", "image/png")
	req.Header.Set("X-Attachment-Id", "att_img_http")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("attachment: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var att struct {
		ID     string `json:"id"`
		SHA256 string `json:"sha256"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &att); err != nil {
		t.Fatalf("decode attachment: %v", err)
	}
	if att.ID != "att_img_http" {
		t.Fatalf("id = %q", att.ID)
	}
	if att.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("sha256 = %q", att.SHA256)
	}
}
