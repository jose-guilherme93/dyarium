package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/preview"
	"github.com/joseti/dyarium/internal/store"
)

// seedEntryWithText cria uma nota com corpo em markdown e transcricao, para os
// testes de include_text nao dependerem da ordem das linhas.
func seedEntryWithText(t *testing.T, srv *Server, entryID, body, spoken string) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	seedPlainEntry(t, srv, entryID)
	if err := srv.deps.Store.CreateNote(ctx, store.Note{
		ID: "n_" + entryID, EntryID: entryID,
		ContentMarkdown: body, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("note %s: %v", entryID, err)
	}
	if spoken == "" {
		return
	}
	attachmentID := "a_" + entryID
	if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
		ID: attachmentID, EntryID: entryID, Kind: store.AttachmentOriginal,
		StorageKey: "objects/" + attachmentID, ContentType: "audio/aac", SizeBytes: 10,
		Cipher: "aes-256-gcm", DurationSeconds: 12, CreatedAt: now,
	}); err != nil {
		t.Fatalf("attachment %s: %v", entryID, err)
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t_" + entryID, EntryID: entryID, AttachmentID: attachmentID,
		Model: "local", Text: spoken, CreatedAt: now,
	}, nil); err != nil {
		t.Fatalf("transcript %s: %v", entryID, err)
	}
}

func entryByID(t *testing.T, body map[string]any, entryID string) map[string]any {
	t.Helper()
	entries, ok := body["entries"].([]any)
	if !ok {
		t.Fatalf("resposta sem entries: %v", body)
	}
	for _, raw := range entries {
		item, ok := raw.(map[string]any)
		if ok && item["id"] == entryID {
			return item
		}
	}
	t.Fatalf("entrada %s ausente da resposta", entryID)
	return nil
}

// A lista normal nao carrega corpo nem transcricao: o payload fica pequeno.
// Com `include_text=1` o dashboard recebe o texto completo para calcular a
// analise local, sem pedir nota por nota.
func TestListEntriesIncludeText(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()

	seedPlainEntry(t, srv, "e_texto")
	if err := srv.deps.Store.CreateNote(ctx, store.Note{
		ID: "n_texto", EntryID: "e_texto",
		ContentMarkdown: "# titulo\n\ncorpo completo da nota",
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("note: %v", err)
	}

	seedPlainEntry(t, srv, "e_voz")
	if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
		ID: "a_voz", EntryID: "e_voz", Kind: store.AttachmentOriginal,
		StorageKey: "objects/a_voz", ContentType: "audio/aac", SizeBytes: 10,
		Cipher: "aes-256-gcm", DurationSeconds: 12, CreatedAt: now,
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	if err := srv.deps.Store.CreateNote(ctx, store.Note{
		ID: "n_voz", EntryID: "e_voz",
		ContentMarkdown: "!audio[attachment:a_voz]{d=12}\n",
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("note: %v", err)
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t_voz", EntryID: "e_voz", AttachmentID: "a_voz",
		Model: "local", Text: "fala transcrita da nota",
		CreatedAt: now,
	}, nil); err != nil {
		t.Fatalf("transcript: %v", err)
	}

	byID := func(body map[string]any) map[string]map[string]any {
		out := map[string]map[string]any{}
		for _, raw := range body["entries"].([]any) {
			item := raw.(map[string]any)
			out[item["id"].(string)] = item
		}
		return out
	}

	rec, plain := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=10", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}
	for id, item := range byID(plain) {
		if _, ok := item["text"]; ok {
			t.Fatalf("%s: lista padrao trouxe text", id)
		}
		if _, ok := item["transcript"]; ok {
			t.Fatalf("%s: lista padrao trouxe transcript", id)
		}
	}

	rec, withText := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=10&include_text=1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list include_text: %d", rec.Code)
	}
	entries := byID(withText)

	texto := entries["e_texto"]
	text, _ := texto["text"].(string)
	if !strings.Contains(text, "corpo completo da nota") {
		t.Fatalf("text = %q", text)
	}
	if !strings.Contains(text, "# titulo") {
		t.Fatalf("text deveria ser o markdown completo, veio %q", text)
	}

	voz := entries["e_voz"]
	transcript, _ := voz["transcript"].(string)
	if !strings.Contains(transcript, "fala transcrita da nota") {
		t.Fatalf("transcript = %q", transcript)
	}
}

// Ataque: a rota sem token nao pode devolver o corpo nem a transcricao. O
// include_text amplia o payload; se a autenticacao falhar, nada dele vaza.
func TestListEntriesIncludeTextRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	const corpo = "segredo-do-corpo-que-nao-pode-vazar"
	const fala = "segredo-da-fala-que-nao-pode-vazar"
	seedEntryWithText(t, srv, id.New(), corpo, fala)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/entries?include_text=1", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("sem token: status = %d, want 401", rec.Code)
	}
	if body := rec.Body.String(); strings.Contains(body, corpo) || strings.Contains(body, fala) {
		t.Fatalf("401 vazou texto da nota: %s", body)
	}
}

// Ataque: `deleted=1` tem ramo proprio e nao pode ser estendido pelo
// include_text. O tombstone continua sendo so id/titulo/datas, mesmo com o
// corpo ainda no banco (a limpeza so roda depois da retencao).
func TestListEntriesIncludeTextDoesNotLeakTombstones(t *testing.T) {
	srv := newTestServer(t)
	const corpo = "corpo secreto da nota apagada"
	const fala = "fala secreta da nota apagada"
	entryID := id.New()
	seedEntryWithText(t, srv, entryID, corpo, fala)

	if rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/entries/"+entryID, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: status = %d, want 204", rec.Code)
	}

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries?deleted=1&include_text=1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("lixeira: status = %d body %s", rec.Code, rec.Body.String())
	}
	if !containsEntry(body, entryID) {
		t.Fatalf("tombstone %s ausente da lixeira", entryID)
	}
	for _, raw := range body["entries"].([]any) {
		item := raw.(map[string]any)
		if _, ok := item["text"]; ok {
			t.Fatalf("%v: tombstone nao pode trazer text", item["id"])
		}
		if _, ok := item["transcript"]; ok {
			t.Fatalf("%v: tombstone nao pode trazer transcript", item["id"])
		}
	}
	if raw := rec.Body.String(); strings.Contains(raw, corpo) || strings.Contains(raw, fala) {
		t.Fatalf("lixeira vazou texto da nota: %s", raw)
	}
}

// Ataque: `limit` absurdo (ou invalido) nao pode estourar a resposta. O teto de
// 5000 e aplicado no handler; aqui se prova o contrato observavel: 200, JSON
// bem formado, todas as entradas e nenhum next_cursor prematuro. Provar o 5000
// exato exigiria 5001 linhas, que este teste evita de proposito.
func TestListEntriesAbsurdLimitStaysCapped(t *testing.T) {
	srv := newTestServer(t)
	for _, entryID := range []string{"e_lim_a", "e_lim_b", "e_lim_c"} {
		seedEntryWithText(t, srv, entryID, "corpo de "+entryID, "")
	}

	for _, raw := range []string{"999999999", "999999999999999999999", "-5", "abc"} {
		rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries?include_text=1&limit="+raw, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("limit=%s: status = %d body %s", raw, rec.Code, rec.Body.String())
		}
		entries, ok := body["entries"].([]any)
		if !ok {
			t.Fatalf("limit=%s: resposta sem entries: %v", raw, body)
		}
		if len(entries) != 3 {
			t.Fatalf("limit=%s: entries = %d, want 3", raw, len(entries))
		}
		if _, ok := body["next_cursor"]; ok {
			t.Fatalf("limit=%s: cursor prematuro com a lista inteira na pagina", raw)
		}
		for _, item := range entries {
			row := item.(map[string]any)
			if _, ok := row["id"].(string); !ok {
				t.Fatalf("limit=%s: linha malformada: %v", raw, row)
			}
		}
	}

	// A paginacao normal continua valendo com o teto aplicado.
	if _, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=2", nil); body["next_cursor"] != "2" {
		t.Fatalf("limit=2: next_cursor = %v, want 2", body["next_cursor"])
	}
	if _, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=3", nil); body["next_cursor"] != "3" {
		t.Fatalf("limit=3: next_cursor = %v, want 3", body["next_cursor"])
	}
}

// include_text so liga com valor verdadeiro. Qualquer outra grafia mantem a
// lista enxuta, como o cliente antigo espera.
func TestListEntriesIncludeTextFalseOmitsFields(t *testing.T) {
	srv := newTestServer(t)
	seedEntryWithText(t, srv, "e_sem_texto", "corpo que nao deve sair", "fala que nao deve sair")

	for _, value := range []string{"0", "false", "no", "off", "talvez"} {
		_, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries?include_text="+value, nil)
		item := entryByID(t, body, "e_sem_texto")
		if _, ok := item["text"]; ok {
			t.Fatalf("include_text=%s trouxe text", value)
		}
		if _, ok := item["transcript"]; ok {
			t.Fatalf("include_text=%s trouxe transcript", value)
		}
	}
}

// O include_text carrega o markdown cru inteiro e a transcricao inteira, nao a
// previa curta de duas linhas. Um corpo/transcricao maior que preview.Short
// precisa chegar inteiro para a analise local do dashboard.
func TestListEntriesIncludeTextIsFullBodyNotPreview(t *testing.T) {
	srv := newTestServer(t)
	corpo := "# titulo\n\n" + strings.Repeat("palavra do corpo ", 40) + "FIM-DO-CORPO"
	fala := strings.Repeat("fala completa ", 40) + "FIM-DA-FALA"
	seedEntryWithText(t, srv, "e_longo", corpo, fala)

	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries?include_text=1", nil)
	item := entryByID(t, body, "e_longo")

	text, _ := item["text"].(string)
	if text != corpo {
		t.Fatalf("text nao e o markdown completo: len=%d, want %d", len([]rune(text)), len([]rune(corpo)))
	}
	if !strings.Contains(text, "FIM-DO-CORPO") {
		t.Fatalf("text truncado antes do fim do corpo: %q", text)
	}
	if len([]rune(text)) <= preview.DefaultLimit {
		t.Fatalf("text com %d runas nao exercita o corte da previa (%d)", len([]rune(text)), preview.DefaultLimit)
	}

	transcript, _ := item["transcript"].(string)
	if transcript != fala {
		t.Fatalf("transcript nao e a fala completa: len=%d, want %d", len([]rune(transcript)), len([]rune(fala)))
	}
	if !strings.Contains(transcript, "FIM-DA-FALA") {
		t.Fatalf("transcript truncado antes do fim da fala: %q", transcript)
	}
	if len([]rune(transcript)) <= preview.DefaultLimit {
		t.Fatalf("transcript com %d runas nao exercita o corte da previa (%d)", len([]rune(transcript)), preview.DefaultLimit)
	}

	// A previa da lista continua curta: include_text nao muda a coluna.
	prev, _ := item["preview"].(string)
	if len([]rune(prev)) > preview.DefaultLimit+1 {
		t.Fatalf("preview = %d runas, want <= %d", len([]rune(prev)), preview.DefaultLimit+1)
	}
	if prev == text {
		t.Fatalf("preview deveria ser a versao curta, nao o corpo inteiro")
	}
}
