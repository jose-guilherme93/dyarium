package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// seedTranscriptAudio cria a entrada com um audio e grava a transcricao crua.
func seedTranscriptAudio(t *testing.T, srv *Server) {
	t.Helper()
	ctx := context.Background()
	seedPlainEntry(t, srv, "e1")
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
		ID: "a1", EntryID: "e1", Kind: store.AttachmentOriginal, StorageKey: "objects/a1",
		ContentType: "audio/wav", SizeBytes: 10, Cipher: "aes-256-gcm", DurationSeconds: 12, CreatedAt: now,
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	body := `{"attachment_id":"a1","language":"pt","text":"a sede do pt fica em sao paulo\nforam 3 pessoas",
		"segments":[{"start_ms":0,"end_ms":1000,"text":"a sede do pt fica em sao paulo"},
		            {"start_ms":1000,"end_ms":2000,"text":"foram 3 pessoas"}]}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put transcript: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPutTranscriptRevisionsShowsRevisedAndKeepsOriginal(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	body := `{"attachment_id":"a1","model":"llm","prompt_version":1,"literal":false,
		"comprehension":73,
		"segments":[{"idx":0,"text":"A sede do PT (Partido dos Trabalhadores) fica em São Paulo."},
		            {"idx":1,"text":"Foram 3 pessoas."}]}`
	rec, resp := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript/revisions", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put revisions: %d %s", rec.Code, rec.Body.String())
	}
	if got := resp["revised_segments"].(float64); got != 2 {
		t.Fatalf("revised_segments = %v, queria 2", resp["revised_segments"])
	}

	rec, transcript := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/transcript", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get transcript: %d", rec.Code)
	}
	text := transcript["text"].(string)
	if !strings.Contains(text, "Partido dos Trabalhadores") {
		t.Fatalf("texto visivel sem revisao: %q", text)
	}
	segments := transcript["segments"].([]any)
	first := segments[0].(map[string]any)
	if first["text"] != "a sede do pt fica em sao paulo" {
		t.Fatalf("original perdido: %+v", first)
	}
	if first["revised"] != "A sede do PT (Partido dos Trabalhadores) fica em São Paulo." {
		t.Fatalf("revisao ausente: %+v", first)
	}
	if first["idx"].(float64) != 0 {
		t.Fatalf("idx ausente: %+v", first)
	}
}

// O servidor nao confia no cliente: uma revisao que troca numeros e descartada.
func TestPutTranscriptRevisionsRejectsChangedNumbers(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	body := `{"attachment_id":"a1","model":"llm","prompt_version":1,
		"segments":[{"idx":1,"text":"Foram 9 pessoas."}]}`
	rec, resp := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript/revisions", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put revisions: %d %s", rec.Code, rec.Body.String())
	}
	if resp["revised_segments"].(float64) != 0 {
		t.Fatalf("aceitou numero trocado: %v", resp)
	}
	// A trava recusou a resposta do modelo: o trecho nao foi revisado e o painel
	// precisa saber disso, senao "nao mudou nada" esconde a recusa.
	if resp["rejected"].(float64) != 1 {
		t.Fatalf("recusados = %v, queria 1", resp["rejected"])
	}
}

// A escrita do usuario vence: trecho editado a mao nao recebe revisao.
func TestPutTranscriptRevisionsSkipsUserEditedSegment(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	body := `{"attachment_id":"a1","language":"pt","text":"a sede do pt fica em sao paulo\nforam 3 pessoas",
		"segments":[{"start_ms":0,"end_ms":1000,"text":"a sede do pt fica em sao paulo"},
		            {"start_ms":1000,"end_ms":2000,"text":"foram 3 pessoas","edited":true}]}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put transcript: %d %s", rec.Code, rec.Body.String())
	}

	revisions := `{"attachment_id":"a1","model":"llm","prompt_version":1,
		"segments":[{"idx":1,"text":"Foram 3 pessoas."}]}`
	rec, resp := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript/revisions", strings.NewReader(revisions))
	if rec.Code != http.StatusOK {
		t.Fatalf("put revisions: %d %s", rec.Code, rec.Body.String())
	}
	if resp["revised_segments"].(float64) != 0 {
		t.Fatalf("revisou trecho editado: %v", resp)
	}
}

func TestAnalysisExposesComprehensionAndDisfluency(t *testing.T) {
	srv := newTestServer(t)
	now := time.Now().UTC()
	seedPlainEntry(t, srv, "e1")
	if err := srv.deps.Store.SaveAnalysis(context.Background(), store.Analysis{
		ID: "an1", EntryID: "e1", Model: "llm", Sentiment: 0.2, SentimentLabel: "positivo",
		Summary: "resumo", Comprehension: 71, ComprehensionSource: "review",
		StutterRate: 1.5, HesitationRate: 3.2, RevisedSegments: 4, CreatedAt: now,
	}); err != nil {
		t.Fatalf("save analysis: %v", err)
	}

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/analysis", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body["comprehension"].(float64) != 71 {
		t.Fatalf("comprehension = %v", body["comprehension"])
	}
	if body["comprehension_source"] != "review" {
		t.Fatalf("comprehension_source = %v", body["comprehension_source"])
	}
	if body["stutter_rate"].(float64) != 1.5 || body["hesitation_rate"].(float64) != 3.2 {
		t.Fatalf("taxas = %v / %v", body["stutter_rate"], body["hesitation_rate"])
	}
}

// O dashboard le a transcricao pelo payload da entrada (audios[].transcript).
// Se ela nao aparecer aqui, o painel do audio fica vazio mesmo com o texto no
// banco — foi o sintoma de uma nota transcrita no app.
func TestEntryShowsDeviceTranscriptInAudios(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	rec, entry := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get entry: %d", rec.Code)
	}
	audios, ok := entry["audios"].([]any)
	if !ok || len(audios) == 0 {
		t.Fatalf("audios ausentes: %+v", entry)
	}
	transcript, ok := audios[0].(map[string]any)["transcript"].(map[string]any)
	if !ok {
		t.Fatalf("transcricao ausente no audio: %+v", audios[0])
	}
	if transcript["text"] != "a sede do pt fica em sao paulo\nforam 3 pessoas" {
		t.Fatalf("texto = %v", transcript["text"])
	}
}

// A nota transcrita no app antes do audio subir guarda a transcricao solta. O
// painel precisa mostrar esse texto no unico audio da nota.
func TestEntryShowsLooseTranscriptInSingleAudio(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e_loose")
	ctx := context.Background()
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
		ID: "a_loose", EntryID: "e_loose", Kind: store.AttachmentOriginal, StorageKey: "objects/a_loose",
		ContentType: "audio/aac", SizeBytes: 10, Cipher: "aes-256-gcm", DurationSeconds: 14, CreatedAt: now,
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	// Sem attachment_id: a transcricao fica solta, como quando o app envia
	// antes de o audio existir.
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t_loose", EntryID: "e_loose", Model: "local", Text: "texto do aparelho", CreatedAt: now,
	}, []store.Segment{{ID: "s_loose", StartMS: 0, EndMS: 1000, Text: "texto do aparelho", CreatedAt: now}}); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	rec, entry := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e_loose", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get entry: %d", rec.Code)
	}
	audios := entry["audios"].([]any)
	transcript, ok := audios[0].(map[string]any)["transcript"].(map[string]any)
	if !ok {
		t.Fatalf("transcricao solta nao apareceu no audio: %+v", audios[0])
	}
	if transcript["text"] != "texto do aparelho" {
		t.Fatalf("texto = %v", transcript["text"])
	}
}

// A revisao chega por janela: o que a passada ainda nao alcancou continua cru e
// nao conta como "revisado". O painel le revised_changed e revised_rejected do
// payload para separar "mudou", "nada a mudar" e "nao revisado".
func TestPutTranscriptRevisionsMarksWhatWasReached(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	body := `{"attachment_id":"a1","model":"llm","prompt_version":1,"comprehension":70,
		"rejected":2,"reviewed_through":1,
		"segments":[{"idx":0,"text":"A sede do PT fica em São Paulo."},
		            {"idx":1,"text":"Foram 9 pessoas."}]}`
	rec, resp := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript/revisions", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put revisions: %d %s", rec.Code, rec.Body.String())
	}
	if resp["revised_segments"].(float64) != 1 {
		t.Fatalf("revisados = %v, queria 1", resp["revised_segments"])
	}
	if resp["rejected"].(float64) != 2 {
		t.Fatalf("recusados = %v, queria 2", resp["rejected"])
	}

	rec, transcript := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/transcript", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get transcript: %d", rec.Code)
	}
	if transcript["revised_changed"].(float64) != 1 {
		t.Fatalf("revised_changed = %v", transcript["revised_changed"])
	}
	if transcript["revised_rejected"].(float64) != 2 {
		t.Fatalf("revised_rejected = %v", transcript["revised_rejected"])
	}
	if transcript["revised_pending"].(float64) != 1 {
		t.Fatalf("revised_pending = %v, queria 1 (o segundo trecho nao foi alcancado)", transcript["revised_pending"])
	}
	if transcript["revised_finished"] != false {
		t.Fatalf("passada parcial marcada como terminada: %+v", transcript)
	}
	segments := transcript["segments"].([]any)
	second := segments[1].(map[string]any)
	if _, ok := second["revised"]; ok {
		t.Fatalf("trecho fora da janela revisado: %+v", second)
	}
}

// Revisar e nao achar nada a corrigir e um resultado valido: o payload precisa
// dizer que a revisao rodou (revised), que nada mudou (revised_changed 0) e que
// nada foi recusado (revised_rejected 0). Era esse estado que se confundia com
// "nunca revisou".
func TestTranscriptPayloadDistinguishesNothingToFix(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	body := `{"attachment_id":"a1","model":"llm","prompt_version":1,"comprehension":88,
		"segments":[{"idx":0,"text":"a sede do pt fica em sao paulo"},
		            {"idx":1,"text":"foram 3 pessoas"}]}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript/revisions", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put revisions: %d %s", rec.Code, rec.Body.String())
	}

	rec, transcript := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/transcript", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get transcript: %d", rec.Code)
	}
	if transcript["revised"] != true {
		t.Fatalf("revisao nao marcada: %+v", transcript)
	}
	if transcript["revised_changed"].(float64) != 0 {
		t.Fatalf("revised_changed = %v, queria 0", transcript["revised_changed"])
	}
	if transcript["revised_rejected"].(float64) != 0 {
		t.Fatalf("revised_rejected = %v, queria 0", transcript["revised_rejected"])
	}
	if transcript["revised_pending"].(float64) != 0 || transcript["revised_finished"] != true {
		t.Fatalf("passada completa mal marcada: pending=%v finished=%v",
			transcript["revised_pending"], transcript["revised_finished"])
	}
	if transcript["text"] != "a sede do pt fica em sao paulo\nforam 3 pessoas" {
		t.Fatalf("texto = %q", transcript["text"])
	}
}

// O app reenvia a transcricao toda vez que abre a nota. Numa nota ja analisada
// isso nao pode rebaixar o estado: "pronto" virando "transcrito" escondia a
// analise no painel.
func TestPutTranscriptKeepsAnalyzedEntryReady(t *testing.T) {
	srv := newTestServer(t)
	seedPlainEntry(t, srv, "e_ready")
	ctx := context.Background()
	if err := srv.deps.Store.UpdateEntryStatus(ctx, "e_ready", store.EntryReady); err != nil {
		t.Fatalf("status: %v", err)
	}
	body := `{"language":"pt","text":"um trecho","segments":[{"start_ms":0,"end_ms":1000,"text":"um trecho"}]}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e_ready/transcript", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put transcript: %d %s", rec.Code, rec.Body.String())
	}
	entry, err := srv.deps.Store.GetEntry(ctx, "e_ready")
	if err != nil {
		t.Fatalf("entry: %v", err)
	}
	if entry.Status != store.EntryReady {
		t.Fatalf("status = %s, queria ready", entry.Status)
	}
}

// Reenviar a mesma transcricao nao pode apagar a revisao da nota: as linhas por
// trecho ja eram preservadas, mas a compreensao e o estado da passada sumiam e
// o painel passava a dizer "sem revisao" numa nota revisada.
func TestPutTranscriptKeepsRevisionMetadataWhenTextIsUnchanged(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	body := `{"attachment_id":"a1","model":"llm","prompt_version":1,"literal":false,
		"comprehension":81,
		"segments":[{"idx":0,"text":"A sede do PT fica em São Paulo."},
		            {"idx":1,"text":"Foram 3 pessoas."}]}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript/revisions", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put revisions: %d %s", rec.Code, rec.Body.String())
	}

	again := `{"attachment_id":"a1","language":"pt",
		"text":"a sede do pt fica em sao paulo\nforam 3 pessoas",
		"segments":[{"start_ms":0,"end_ms":1000,"text":"a sede do pt fica em sao paulo"},
		            {"start_ms":1000,"end_ms":2000,"text":"foram 3 pessoas"}]}`
	rec, _ = doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript", strings.NewReader(again))
	if rec.Code != http.StatusOK {
		t.Fatalf("resync: %d %s", rec.Code, rec.Body.String())
	}

	rec, transcript := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/transcript", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get transcript: %d", rec.Code)
	}
	if transcript["revised"] != true {
		t.Fatalf("revisao perdida no resync: %+v", transcript)
	}
	if transcript["revised_comprehension"].(float64) != 81 {
		t.Fatalf("compreensao perdida no resync: %v", transcript["revised_comprehension"])
	}
	if transcript["revised_finished"] != true || transcript["revised_pending"].(float64) != 0 {
		t.Fatalf("estado perdido no resync: %+v", transcript)
	}
}

// O payload da entrada (sem segmentos) tambem precisa do estado honesto: e ele
// que alimenta o chip do dashboard.
func TestEntryTranscriptSummaryCarriesRevisionState(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	body := `{"attachment_id":"a1","model":"llm","prompt_version":1,"comprehension":75,
		"segments":[{"idx":0,"text":"A sede do PT fica em São Paulo."},
		            {"idx":1,"text":"Foram 3 pessoas."}]}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript/revisions", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put revisions: %d %s", rec.Code, rec.Body.String())
	}

	rec, entry := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get entry: %d", rec.Code)
	}
	audios := entry["audios"].([]any)
	transcript := audios[0].(map[string]any)["transcript"].(map[string]any)
	if transcript["revised_pending"].(float64) != 0 || transcript["revised_changed"].(float64) != 2 {
		t.Fatalf("resumo sem estado da revisao: %+v", transcript)
	}
	if transcript["revised_comprehension"].(float64) != 75 {
		t.Fatalf("compreensao ausente no resumo: %+v", transcript)
	}
}

// Uma passada que recusou todos os trechos nao tem linha de revisao, mas rodou.
// O payload precisa mostrar os recusados, nao "nunca revisou".
func TestTranscriptPayloadShowsRejectedPassWithoutRows(t *testing.T) {
	srv := newTestServer(t)
	seedTranscriptAudio(t, srv)

	body := `{"attachment_id":"a1","model":"llm","prompt_version":1,"comprehension":40,
		"rejected":0,"reviewed_through":2,
		"segments":[{"idx":0,"text":"texto com 999"},
		            {"idx":1,"text":"foram 4 pessoas"}]}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript/revisions", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put revisions: %d %s", rec.Code, rec.Body.String())
	}

	rec, transcript := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1/transcript", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get transcript: %d", rec.Code)
	}
	if transcript["revised"] != true {
		t.Fatalf("passada recusada sumiu do payload: %+v", transcript)
	}
	if transcript["revised_changed"].(float64) != 0 || transcript["revised_rejected"].(float64) != 2 {
		t.Fatalf("contagens = changed %v, rejected %v",
			transcript["revised_changed"], transcript["revised_rejected"])
	}
	if transcript["revised_pending"].(float64) != 0 || transcript["revised_finished"] != true {
		t.Fatalf("passada completa mal marcada: %+v", transcript)
	}
}
