package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestSyncManifestEntriesCarryContractFields(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateEntry(ctx, store.Entry{
		ID:        "note_manifest",
		Title:     "nota",
		Status:    store.EntryReady,
		Source:    "text",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := srv.deps.Store.CreateNote(ctx, store.Note{
		ID:              "body_manifest",
		EntryID:         "note_manifest",
		Title:           "nota",
		ContentMarkdown: "# corpo",
		CreatedAt:       now,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, authedRequest(http.MethodGet, "/api/v1/sync/manifest?kind=entries", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Contract   string           `json:"contract"`
		InstanceID string           `json:"instance_id"`
		Items      []map[string]any `json:"items"`
		Complete   bool             `json:"complete"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Contract != SyncContract || body.InstanceID != "instancia-de-teste" {
		t.Fatalf("cabecalho do contrato inesperado: %+v", body)
	}
	if !body.Complete || len(body.Items) != 1 {
		t.Fatalf("itens = %d, complete = %v", len(body.Items), body.Complete)
	}
	item := body.Items[0]
	if item["id"] != "note_manifest" {
		t.Fatalf("id = %v", item["id"])
	}
	if item["body_hash"] == "" || item["body_hash"] == nil {
		t.Fatalf("body_hash ausente: %+v", item)
	}
	if item["versions"] == nil {
		t.Fatalf("versions ausente: %+v", item)
	}
	if item["attachment_ids"] == nil {
		t.Fatalf("attachment_ids ausente: %+v", item)
	}
}

func TestSyncManifestDeletedSurvivesPurge(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateEntry(ctx, store.Entry{
		ID:        "note_gone",
		Title:     "nota",
		Status:    store.EntryReady,
		Source:    "text",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := srv.deps.Store.SoftDeleteEntryWithOrigin(ctx, "note_gone", "aparelho"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := srv.deps.Store.PurgeEntry(ctx, "note_gone"); err != nil {
		t.Fatalf("purge: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, authedRequest(http.MethodGet, "/api/v1/sync/manifest?kind=deleted", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Items) != 1 || body.Items[0]["id"] != "note_gone" || body.Items[0]["deleted_at"] == nil {
		t.Fatalf("tombstone ausente no manifesto: %+v", body.Items)
	}
}

func TestSyncManifestNotebooksIncludeDeleted(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	if err := srv.deps.Store.CreateNotebook(ctx, store.Notebook{
		ID:        "nb_manifest",
		Name:      "caderno",
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	if err := srv.deps.Store.DeleteNotebook(ctx, "nb_manifest"); err != nil {
		t.Fatalf("delete notebook: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, authedRequest(http.MethodGet, "/api/v1/sync/manifest?kind=notebooks", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Deleted []map[string]any `json:"deleted"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	found := false
	for _, item := range body.Deleted {
		if item["id"] == "nb_manifest" {
			found = true
		}
	}
	if !found {
		t.Fatalf("tombstone do caderno ausente: %+v", body.Deleted)
	}
}
