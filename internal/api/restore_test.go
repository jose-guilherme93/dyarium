package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

func seedEntry(t *testing.T, srv *Server, entryID, title string) {
	t.Helper()
	now := time.Now().UTC()
	entry := store.Entry{ID: entryID, Title: title, Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now}
	if err := srv.deps.Store.CreateEntry(context.Background(), entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
}

// Uma nota apagada fica na lixeira e volta inteira: e o que permite restaurar um
// backup sem que o proximo pull apague a nota de novo.
func TestDeletedEntryIsRecoverable(t *testing.T) {
	srv := newTestServer(t)
	entryID := id.New()
	seedEntry(t, srv, entryID, "nota apagada")

	if rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/entries/"+entryID, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", rec.Code)
	}

	// Sai da lista viva e entra na lixeira.
	_, live := doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	if containsEntry(live, entryID) {
		t.Fatalf("entrada apagada nao deveria aparecer na lista viva")
	}
	_, trashed := doJSON(t, srv, http.MethodGet, "/api/v1/entries?deleted=1", nil)
	if !containsEntry(trashed, entryID) {
		t.Fatalf("entrada apagada deveria aparecer na lixeira")
	}

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/restore", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body["id"] != entryID {
		t.Fatalf("id = %v, want %s", body["id"], entryID)
	}

	_, live = doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	if !containsEntry(live, entryID) {
		t.Fatalf("entrada restaurada deveria voltar para a lista viva")
	}
	_, trashed = doJSON(t, srv, http.MethodGet, "/api/v1/entries?deleted=1", nil)
	if containsEntry(trashed, entryID) {
		t.Fatalf("entrada restaurada nao deveria continuar na lixeira")
	}
}

func TestRestoreMissingEntryReturnsNotFound(t *testing.T) {
	srv := newTestServer(t)
	rec, _ := doJSON(t, srv, http.MethodPost, "/api/v1/entries/en_inexistente/restore", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// Criar uma nota com um id que existe na lixeira a traz de volta, em vez de
// falhar com conflito: e o caminho de quem restaura um backup.
func TestCreateEntryRevivesDeletedClientID(t *testing.T) {
	srv := newTestServer(t)
	const clientID = "note_01J8Z0000000000000000000C"
	seedEntry(t, srv, clientID, "apagada")

	if rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/entries/"+clientID, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", rec.Code)
	}

	rec, body := doJSON(t, srv, http.MethodPost, "/api/v1/entries",
		strings.NewReader(`{"id":"`+clientID+`","title":"de volta"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body["id"] != clientID {
		t.Fatalf("id = %v, want %s", body["id"], clientID)
	}

	_, live := doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	if !containsEntry(live, clientID) {
		t.Fatalf("nota recriada pelo mesmo id deveria estar viva")
	}
}

// A limpeza (que destroi os objetos cifrados) so pode rodar depois da janela de
// retencao: e nela que o restore acontece sem perder midia.
func TestDeleteSchedulesCleanupAfterRetention(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	entryID := id.New()
	seedEntry(t, srv, entryID, "nota")

	if rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/entries/"+entryID, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", rec.Code)
	}

	var availableAt string
	if err := srv.deps.Store.DB().QueryRowContext(ctx,
		`SELECT available_at FROM jobs WHERE idempotency_key = ?`, "cleanup:"+entryID).Scan(&availableAt); err != nil {
		t.Fatalf("query job: %v", err)
	}
	when, err := time.Parse(time.RFC3339, availableAt)
	if err != nil {
		t.Fatalf("parse available_at %q: %v", availableAt, err)
	}
	if when.Before(time.Now().Add(24 * time.Hour)) {
		t.Fatalf("limpeza agendada para %s; deveria respeitar a retencao", availableAt)
	}
}

func containsEntry(body map[string]any, entryID string) bool {
	entries, _ := body["entries"].([]any)
	for _, raw := range entries {
		if item, ok := raw.(map[string]any); ok && item["id"] == entryID {
			return true
		}
	}
	return false
}
