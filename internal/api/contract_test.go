package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// TestContractTextNoteRoundTrip prova o caminho que o app usa para uma nota de
// texto: criar a entrada com id/data, gravar o corpo em markdown, tags e
// arquivamento, e ler tudo de volta na lista e no detalhe.
func TestContractTextNoteRoundTrip(t *testing.T) {
	srv := newTestServer(t)
	entryID := "note_contract_text_01"
	bodyID := "note_contract_body_01"
	createdAt := "2026-10-01T10:00:00Z"
	recordedAt := "2026-09-30T20:00:00Z"

	rec, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries", strings.NewReader(fmt.Sprintf(
		`{"id":%q,"title":"Nota do contrato","created_at":%q,"recorded_at":%q,"notebook_id":"notas-ao-acaso"}`,
		entryID, createdAt, recordedAt)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar entrada: status = %d (%s)", rec.Code, rec.Body.String())
	}
	if created["id"] != entryID {
		t.Fatalf("id = %v, want %s", created["id"], entryID)
	}
	if created["source"] != "text" {
		t.Fatalf("source = %v, want text", created["source"])
	}
	if created["recorded_at"] != recordedAt {
		t.Fatalf("recorded_at = %v, want %s", created["recorded_at"], recordedAt)
	}

	rec, note := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(fmt.Sprintf(`{"id":%q,"title":"Nota do contrato","content_markdown":"# Titulo\n\ntexto do app"}`, bodyID)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("criar nota: status = %d (%s)", rec.Code, rec.Body.String())
	}
	if note["id"] != bodyID {
		t.Fatalf("nota id = %v, want %s", note["id"], bodyID)
	}
	if note["content_markdown"] != "# Titulo\n\ntexto do app" {
		t.Fatalf("corpo = %v", note["content_markdown"])
	}
	bodyVersion := versionOf(t, map[string]any{"body": note["body_version"]}, "body")

	if rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/"+entryID+"/tags",
		strings.NewReader(`{"tags":["viagem","familia"]}`)); rec.Code != http.StatusOK {
		t.Fatalf("tags: status = %d (%s)", rec.Code, rec.Body.String())
	}
	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"archived":true}`)); rec.Code != http.StatusOK {
		t.Fatalf("arquivar: status = %d (%s)", rec.Code, rec.Body.String())
	}

	rec, detail := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("detalhe: status = %d (%s)", rec.Code, rec.Body.String())
	}
	checks := map[string]any{
		"title":       "Nota do contrato",
		"recorded_at": recordedAt,
		"created_at":  createdAt,
		"archived":    true,
	}
	for field, want := range checks {
		if detail[field] != want {
			t.Fatalf("%s = %v, want %v", field, detail[field], want)
		}
	}
	detailTags, _ := detail["tags"].([]any)
	if len(detailTags) != 2 || detailTags[0] != "familia" || detailTags[1] != "viagem" {
		t.Fatalf("tags = %v", detail["tags"])
	}
	versions, _ := detail["versions"].(map[string]any)
	if versions["body"] != bodyVersion {
		t.Fatalf("versions.body = %v, want %s", versions["body"], bodyVersion)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=50", nil)
	entries, _ := list["entries"].([]any)
	var listed map[string]any
	for _, item := range entries {
		entry := item.(map[string]any)
		if entry["id"] == entryID {
			listed = entry
		}
	}
	if listed == nil {
		t.Fatalf("entrada %s ausente da listagem", entryID)
	}
	if listed["recorded_at"] != recordedAt || listed["archived"] != true {
		t.Fatalf("lista perdeu data/arquivamento: %v", listed)
	}
	if listVersions, _ := listed["versions"].(map[string]any); listVersions["body"] != bodyVersion {
		t.Fatalf("lista perdeu a versao do corpo: %v", listed["versions"])
	}
	listTags, _ := listed["tags"].([]any)
	if len(listTags) != 2 {
		t.Fatalf("lista perdeu as tags: %v", listed["tags"])
	}
	// A lista mostra as primeiras linhas em prosa: o markdown fica no corpo,
	// nunca na previa.
	if listed["preview"] != "Titulo texto do app" {
		t.Fatalf("preview = %v", listed["preview"])
	}
}

// TestContractEntriesPagination garante que uma biblioteca maior que o limite da
// pagina continua chegando inteira, com next_cursor.
func TestContractEntriesPagination(t *testing.T) {
	srv := newTestServer(t)
	base := time.Now().UTC().Add(-3 * time.Hour)
	for i := 0; i < 3; i++ {
		entry := store.Entry{
			ID:        fmt.Sprintf("note_page_%d", i),
			Title:     fmt.Sprintf("nota %d", i),
			Status:    store.EntryReady,
			Source:    "text",
			CreatedAt: base.Add(time.Duration(i) * time.Minute),
			UpdatedAt: base.Add(time.Duration(i) * time.Minute),
		}
		if err := srv.deps.Store.CreateEntry(context.Background(), entry); err != nil {
			t.Fatalf("criar entrada %d: %v", i, err)
		}
	}

	rec, first := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=2", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("primeira pagina: status = %d", rec.Code)
	}
	firstEntries, _ := first["entries"].([]any)
	if len(firstEntries) != 2 {
		t.Fatalf("primeira pagina = %d entradas, want 2", len(firstEntries))
	}
	cursor, _ := first["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("faltou next_cursor na primeira pagina: %v", first)
	}

	rec, second := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=2&cursor="+cursor, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("segunda pagina: status = %d", rec.Code)
	}
	secondEntries, _ := second["entries"].([]any)
	if len(secondEntries) != 1 {
		t.Fatalf("segunda pagina = %d entradas, want 1", len(secondEntries))
	}
	if second["next_cursor"] != nil {
		t.Fatalf("segunda pagina nao deveria ter next_cursor: %v", second["next_cursor"])
	}
}

// TestContractUnchangedTitleKeepsVersion evita que o sync periodico do app suba a
// versao do titulo sem ter mudado nada e dispare 409 em outro cliente.
func TestContractUnchangedTitleKeepsVersion(t *testing.T) {
	srv := newTestServer(t)
	entryID := "note_contract_same_title"
	seedTextEntry(t, srv, entryID, "mesmo titulo")

	_, detail := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	before := versionOf(t, detail["versions"].(map[string]any), "title")

	rec, body := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"mesmo titulo","versions":{"title":""}}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	versions, _ := body["versions"].(map[string]any)
	if got := versionOf(t, versions, "title"); got != before {
		t.Fatalf("versao do titulo mudou sem mudar o valor: %s -> %s", before, got)
	}
}

// TestContractNoteBodyTouchesEntry garante que uma edicao de corpo no dashboard
// mova a entrada na ordem de recentes que o app usa.
func TestContractNoteBodyTouchesEntry(t *testing.T) {
	srv := newTestServer(t)
	entryID := "note_contract_touch"
	old := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	entry := store.Entry{
		ID: entryID, Title: "nota antiga", Status: store.EntryReady, Source: "text",
		CreatedAt: old, UpdatedAt: old,
	}
	if err := srv.deps.Store.CreateEntry(context.Background(), entry); err != nil {
		t.Fatalf("criar entrada: %v", err)
	}

	if rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":"corpo novo"}`)); rec.Code != http.StatusCreated {
		t.Fatalf("criar nota: status = %d", rec.Code)
	}

	updated, err := srv.deps.Store.GetEntry(context.Background(), entryID)
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if !updated.UpdatedAt.After(old.Add(time.Minute)) {
		t.Fatalf("updated_at = %v, deveria ter avancado depois do corpo", updated.UpdatedAt)
	}
}

// TestContractPrimaryAttachment garante que lista e detalhe apontem para o audio
// da nota sem o app precisar baixar a pilha inteira.
func TestContractPrimaryAttachment(t *testing.T) {
	srv := newTestServer(t)
	entryID := "note_contract_audio"
	now := time.Now().UTC()
	entry := store.Entry{
		ID: entryID, Title: "com audio", Status: store.EntryReady, Source: "upload",
		ContentType: "audio/aac", CreatedAt: now, UpdatedAt: now,
	}
	if err := srv.deps.Store.CreateEntry(context.Background(), entry); err != nil {
		t.Fatalf("criar entrada: %v", err)
	}
	attachment := store.Attachment{
		ID: "at_contract", EntryID: entryID, Kind: store.AttachmentOriginal,
		StorageKey: "objects/at_contract", ContentType: "audio/aac", SizeBytes: 10,
		Cipher: "aes-256-gcm", CreatedAt: now,
	}
	if err := srv.deps.Store.CreateAttachment(context.Background(), attachment); err != nil {
		t.Fatalf("criar anexo: %v", err)
	}

	_, detail := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if detail["primary_attachment_id"] != "at_contract" {
		t.Fatalf("detalhe primary_attachment_id = %v", detail["primary_attachment_id"])
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=50", nil)
	entries, _ := list["entries"].([]any)
	for _, item := range entries {
		entry := item.(map[string]any)
		if entry["id"] == entryID {
			if entry["primary_attachment_id"] != "at_contract" {
				t.Fatalf("lista primary_attachment_id = %v", entry["primary_attachment_id"])
			}
			return
		}
	}
	t.Fatalf("entrada %s ausente da listagem", entryID)
}
