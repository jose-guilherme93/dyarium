package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/store"
)

// strconvQuote cita uma string como literal JSON (versoes em branco).
func strconvQuote(value string) string {
	quoted, err := json.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(quoted)
}

func seedTextEntry(t *testing.T, srv *Server, entryID, title string) {
	t.Helper()
	now := time.Now().UTC()
	entry := store.Entry{
		ID: entryID, Title: title, Status: store.EntryReady, Source: "text",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := srv.deps.Store.CreateEntry(context.Background(), entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
}

// Titulo e data do evento teem versao propria: renomear no desktop nao briga com
// mexer na data no celular.
func TestPatchEntryFieldsAreIndependent(t *testing.T) {
	srv := newTestServer(t)
	entryID := id.New()
	seedTextEntry(t, srv, entryID, "nome antigo")

	_, first := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"nome novo","recorded_at":"2026-10-16T12:00:00Z"}`))
	versions, _ := first["versions"].(map[string]any)
	if versions["title"] == "" || versions["recorded_at"] == "" {
		t.Fatalf("versoes ausentes: %v", versions)
	}

	// O celular leu as duas versoes e so mexe no titulo.
	rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"outro nome","versions":{"title":`+strconvQuote(versions["title"].(string))+`}}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}

	entry, err := srv.deps.Store.GetEntry(context.Background(), entryID)
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if entry.Title != "outro nome" {
		t.Fatalf("title = %q", entry.Title)
	}
	if entry.RecordedAt == nil || !entry.RecordedAt.Equal(time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("recorded_at = %v, nao deveria ter mudado", entry.RecordedAt)
	}
}

// Conflito no titulo responde 409 e nao escreve nada.
func TestPatchEntryTitleConflictDoesNotOverwrite(t *testing.T) {
	srv := newTestServer(t)
	entryID := id.New()
	seedTextEntry(t, srv, entryID, "inicial")

	_, first := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"primeiro"}`))
	readVersion := first["versions"].(map[string]any)["title"].(string)

	// O desktop renomeia depois que o celular leu.
	doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"nome do desktop"}`))

	rec, conflict := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"meu nome","versions":{"title":`+strconvQuote(readVersion)+`}}`))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (%s)", rec.Code, rec.Body.String())
	}
	fields, _ := conflict["conflict"].([]any)
	if len(fields) != 1 || fields[0] != store.FieldTitle {
		t.Fatalf("conflict = %v, want [title]", fields)
	}

	entry, err := srv.deps.Store.GetEntry(context.Background(), entryID)
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if entry.Title != "nome do desktop" {
		t.Fatalf("title = %q, o conflito nao deveria ter escrito", entry.Title)
	}
}

// Cliente sem versao (app antigo) continua funcionando: ultimo a escrever vence.
func TestPatchEntryWithoutVersionStillWorks(t *testing.T) {
	srv := newTestServer(t)
	entryID := id.New()
	seedTextEntry(t, srv, entryID, "inicial")

	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"primeiro"}`)); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	rec, body := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"segundo"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	entry, _ := srv.deps.Store.GetEntry(context.Background(), entryID)
	if entry.Title != "segundo" {
		t.Fatalf("title = %q", entry.Title)
	}
	if body["versions"] == nil {
		t.Fatalf("a resposta deve trazer as versoes: %v", body)
	}
}

// A listagem traz a versao dos campos, para o app nao precisar de uma requisicao
// extra so para descobrir o que ja mudou.
func TestListEntriesCarriesFieldVersions(t *testing.T) {
	srv := newTestServer(t)
	entryID := id.New()
	seedTextEntry(t, srv, entryID, "com nota")

	doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":"corpo"}`))

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	entries, _ := list["entries"].([]any)
	var found map[string]any
	for _, item := range entries {
		entry := item.(map[string]any)
		if entry["id"] == entryID {
			found = entry
		}
	}
	if found == nil {
		t.Fatalf("entrada %s ausente da listagem", entryID)
	}
	versions, _ := found["versions"].(map[string]any)
	if versions["title"] == "" || versions["recorded_at"] == "" || versions["body"] == "" {
		t.Fatalf("a listagem deveria trazer as tres versoes: %v", versions)
	}
}

// A versao devolvida volta na gravacao seguinte sem virar conflito com ela mesma:
// a string e a mesma, byte a byte (sem reformatar, senao o cliente brigaria
// consigo mesmo na segunda digitacao).
func TestVersionRoundTripDoesNotConflictWithItself(t *testing.T) {
	srv := newTestServer(t)
	entryID := id.New()
	seedTextEntry(t, srv, entryID, "inicial")

	_, patched := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"primeiro"}`))
	titleVersion := patched["versions"].(map[string]any)["title"].(string)

	_, detail := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	readBack := detail["versions"].(map[string]any)["title"].(string)
	if readBack != titleVersion {
		t.Fatalf("a leitura devolveu %q, a gravacao %q: mesma versao, string diferente", readBack, titleVersion)
	}

	rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"title":"segundo","versions":{"title":`+strconvQuote(readBack)+`}}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: a versao lida nao pode brigar consigo mesma", rec.Code)
	}
}

// Arquivar sai da lista de trabalho e volta, sem virar exclusao: e um
// interruptor, entao nao tem versao nem conflito.
func TestArchiveIsNotDeletion(t *testing.T) {
	srv := newTestServer(t)
	entryID := id.New()
	seedTextEntry(t, srv, entryID, "para arquivar")

	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"archived":true}`)); rec.Code != http.StatusOK {
		t.Fatalf("arquivar: status = %d", rec.Code)
	}

	_, work := doJSON(t, srv, http.MethodGet, "/api/v1/entries?archived=0", nil)
	if countEntries(work) != 0 {
		t.Fatalf("a nota arquivada nao deveria aparecer na lista de trabalho")
	}
	_, shelf := doJSON(t, srv, http.MethodGet, "/api/v1/entries?archived=1", nil)
	if countEntries(shelf) != 1 {
		t.Fatalf("a nota arquivada deveria aparecer na prateleira")
	}
	_, deleted := doJSON(t, srv, http.MethodGet, "/api/v1/entries?deleted=1", nil)
	if countEntries(deleted) != 0 {
		t.Fatalf("arquivar nao pode colocar a nota na lixeira")
	}
	_, detail := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	if detail["archived"] != true {
		t.Fatalf("archived = %v", detail["archived"])
	}

	// Sem filtro traz as duas: nenhum cliente perde nota por omissao.
	_, all := doJSON(t, srv, http.MethodGet, "/api/v1/entries", nil)
	if countEntries(all) != 1 {
		t.Fatalf("sem filtro a nota deveria continuar aparecendo")
	}

	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+entryID,
		strings.NewReader(`{"archived":false}`)); rec.Code != http.StatusOK {
		t.Fatalf("desarquivar: status = %d", rec.Code)
	}
	_, work = doJSON(t, srv, http.MethodGet, "/api/v1/entries?archived=0", nil)
	if countEntries(work) != 1 {
		t.Fatalf("desarquivar deveria trazer a nota de volta para a lista")
	}
}

// O corpo da nota e markdown e nada mais: uma gravacao sem `content_markdown`
// nao entra (era o que fazia o app sobrescrever o markdown com o JSON antigo).
func TestUpdateNoteRejectsBodyWithoutMarkdown(t *testing.T) {
	srv := newTestServer(t)
	const entryID = "note_01J8Z0000000000000000000I"
	seedTextEntry(t, srv, entryID, "sem markdown")

	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":"original"}`))
	noteID, _ := created["id"].(string)

	rec, body := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID,
		strings.NewReader(`{"title":"velho","document":[{"type":"paragraph"}]}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != "missing_markdown" {
		t.Fatalf("erro = %v", errObj)
	}

	// O corpo anterior continua intacto.
	_, got := doJSON(t, srv, http.MethodGet, "/api/v1/notes/"+noteID, nil)
	if got["content_markdown"] != "original" {
		t.Fatalf("o corpo mudou: %v", got["content_markdown"])
	}
}

// As revisoes voltam em markdown: a coluna se chama `document` por heranca, mas
// o conteudo gravado e markdown, e devolver como JSON quebrava a resposta.
func TestRevisionsCarryMarkdown(t *testing.T) {
	srv := newTestServer(t)
	const entryID = "note_01J8Z0000000000000000000J"
	seedTextEntry(t, srv, entryID, "com revisao")

	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":"primeiro"}`))
	noteID, _ := created["id"].(string)
	if rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID,
		strings.NewReader(`{"content_markdown":"segundo"}`)); rec.Code != http.StatusOK {
		t.Fatalf("segunda gravacao: status = %d", rec.Code)
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/notes/"+noteID+"/revisions", nil)
	revisions, _ := list["revisions"].([]any)
	if len(revisions) != 1 {
		t.Fatalf("revisoes = %d, want 1", len(revisions))
	}
	revision, _ := revisions[0].(map[string]any)
	if revision["content_markdown"] != "primeiro" {
		t.Fatalf("revisao = %v, want o markdown anterior", revision["content_markdown"])
	}
}

func countEntries(body map[string]any) int {
	entries, _ := body["entries"].([]any)
	return len(entries)
}

// Limpar o corpo e uma gravacao como outra qualquer: `content_markdown` vazio
// nao pode virar 400, senao a nota nunca pode ser esvaziada.
func TestUpdateNoteCanClearTheBody(t *testing.T) {
	srv := newTestServer(t)
	const entryID = "note_01J8Z0000000000000000000L"
	seedTextEntry(t, srv, entryID, "para limpar")

	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries/"+entryID+"/notes",
		strings.NewReader(`{"content_markdown":"original"}`))
	noteID, _ := created["id"].(string)

	rec, first := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID,
		strings.NewReader(`{"content_markdown":""}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("limpar: status = %d (%s)", rec.Code, rec.Body.String())
	}
	_, got := doJSON(t, srv, http.MethodGet, "/api/v1/notes/"+noteID, nil)
	if got["content_markdown"] != "" {
		t.Fatalf("content_markdown = %v, want vazio", got["content_markdown"])
	}

	_, list := doJSON(t, srv, http.MethodGet, "/api/v1/notes/"+noteID+"/revisions", nil)
	revisions, _ := list["revisions"].([]any)
	if len(revisions) != 1 {
		t.Fatalf("revisoes = %d, want 1", len(revisions))
	}
	if revision, _ := revisions[0].(map[string]any); revision["content_markdown"] != "original" {
		t.Fatalf("revisao = %v, want o texto anterior", revision)
	}

	// Repetir a limpeza nao cria revisao nem move a versao.
	before := first["versions"].(map[string]any)["body"].(string)
	_, second := doJSON(t, srv, http.MethodPut, "/api/v1/notes/"+noteID,
		strings.NewReader(`{"content_markdown":""}`))
	after := second["versions"].(map[string]any)["body"].(string)
	if after != before {
		t.Fatalf("versao mudou numa gravacao sem mudanca: %q -> %q", before, after)
	}
	_, list = doJSON(t, srv, http.MethodGet, "/api/v1/notes/"+noteID+"/revisions", nil)
	if revisions, _ = list["revisions"].([]any); len(revisions) != 1 {
		t.Fatalf("revisoes = %d depois da limpeza repetida, want 1", len(revisions))
	}
}

func TestPatchEntryValidates(t *testing.T) {
	srv := newTestServer(t)

	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/en_inexistente",
		strings.NewReader(`{"title":"x"}`)); rec.Code != http.StatusNotFound {
		t.Fatalf("entrada inexistente: status = %d, want 404", rec.Code)
	}
	if rec, _ := doJSON(t, srv, http.MethodPatch, "/api/v1/entries/"+id.New(),
		strings.NewReader(`{}`)); rec.Code != http.StatusBadRequest {
		t.Fatalf("patch vazio: status = %d, want 400", rec.Code)
	}
}
