package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/analyze"
	"github.com/joseti/dyarium/internal/config"
	"github.com/joseti/dyarium/internal/events"
	"github.com/joseti/dyarium/internal/id"
	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/review"
	"github.com/joseti/dyarium/internal/store"
	"github.com/joseti/dyarium/internal/transcribe"
)

func TestExtractText(t *testing.T) {
	doc := `[{"type":"paragraph","content":[{"type":"text","text":"primeira linha"}]},` +
		`{"type":"paragraph","content":[{"type":"text","text":"segunda linha"}]}]`
	if got := extractText(doc); got != "primeira linha segunda linha" {
		t.Fatalf("extractText = %q", got)
	}
	if got := extractText("nao e json"); got != "" {
		t.Fatalf("esperava vazio para entrada invalida, got %q", got)
	}
	if got := extractText(`[{"type":"paragraph","content":[]}]`); got != "" {
		t.Fatalf("esperava vazio para documento sem texto, got %q", got)
	}
}

// A analise de uma nota escrita le o markdown (o corpo canonico), nao o JSON
// legado do BlockNote — que deixou de ser gravado na rodada do markdown.
func TestAnalysisInputReadsWrittenMarkdown(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := id.New()
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "escrita", Status: store.EntryReady, Source: "text",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateNote(ctx, store.Note{
		ID: id.New(), EntryID: entryID,
		ContentMarkdown: "## Primeiro\n\nO **texto** escrito.",
		Document:        `[{"type":"paragraph","content":[{"type":"text","text":"lixo legado"}]}]`,
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	sections := input.analysisSections()
	if len(sections) != 1 {
		t.Fatalf("secoes = %d, queria 1: %v", len(sections), sections)
	}
	if sections[0].Heading != "Primeiro" {
		t.Fatalf("titulo da secao = %q", sections[0].Heading)
	}
	if !strings.Contains(sections[0].Text, "O texto escrito.") {
		t.Fatalf("texto da secao = %q", sections[0].Text)
	}
	if strings.Contains(sections[0].Text, "lixo legado") {
		t.Fatalf("leu o JSON legado: %q", sections[0].Text)
	}
	if input.Language != "" {
		t.Fatalf("language = %q, want vazio", input.Language)
	}
	if input.TextChars == 0 || input.TranscriptChars != 0 {
		t.Fatalf("chars = texto %d, fala %d", input.TextChars, input.TranscriptChars)
	}
}

// Nota antiga, ainda sem markdown (nunca reescrita depois da migracao): a
// analise continua lendo o documento legado, em vez de dizer que nao ha texto.
func TestAnalysisInputFallsBackToLegacyDocument(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := id.New()
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "antiga", Status: store.EntryReady, Source: "upload",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateNote(ctx, store.Note{
		ID: id.New(), EntryID: entryID,
		Document:  `[{"type":"paragraph","content":[{"type":"text","text":"texto antigo"}]}]`,
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	sections := input.analysisSections()
	if len(sections) != 1 || !strings.Contains(sections[0].Text, "texto antigo") {
		t.Fatalf("secoes = %v", sections)
	}
}

// Erro transitorio ainda tem tentativa; chave/modelo errados falham na hora.
func TestShouldGiveUpAnalysis(t *testing.T) {
	permanent := errors.New("analyze: status 400: modelo invalido")
	transient := errors.New("analyze: request: dial tcp: connection refused")

	if !shouldGiveUpAnalysis(0, 5, permanent) {
		t.Fatal("erro permanente deveria falhar na primeira tentativa")
	}
	if shouldGiveUpAnalysis(0, 5, transient) {
		t.Fatal("erro transitorio com tentativas restantes nao deveria falhar")
	}
	if !shouldGiveUpAnalysis(4, 5, transient) {
		t.Fatal("ultima tentativa deveria marcar falha")
	}
}

// A analise recebe tudo o que a nota tem: texto escrito, transcricao de audio,
// imagem (legenda/arquivo) e links.
func TestAnalysisInputCombinesEveryKindOfContent(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := id.New()
	otherID := id.New()
	for _, entry := range []store.Entry{
		{ID: entryID, Title: "nota", Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now},
		{ID: otherID, Title: "outra nota", Status: store.EntryReady, Source: "text", CreatedAt: now, UpdatedAt: now},
	} {
		if err := st.CreateEntry(ctx, entry); err != nil {
			t.Fatalf("create entry: %v", err)
		}
	}
	if err := st.CreateNote(ctx, store.Note{
		ID: id.New(), EntryID: entryID,
		ContentMarkdown: "texto escrito\n\n![foto](attachment:abc)\n\n[site](https://exemplo.com)",
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	attachment := store.Attachment{
		ID: id.New(), EntryID: entryID, Kind: store.AttachmentOriginal,
		StorageKey: "key", Cipher: "aes-256-gcm", CreatedAt: now,
	}
	if err := st.CreateAttachment(ctx, attachment); err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	if err := st.CreateAttachment(ctx, store.Attachment{
		ID: id.New(), EntryID: entryID, Kind: "image",
		StorageKey: "image-key", Cipher: "aes-256-gcm", CreatedAt: now,
	}); err != nil {
		t.Fatalf("create image attachment: %v", err)
	}
	if err := st.SaveTranscript(ctx, store.Transcript{
		ID: id.New(), EntryID: entryID, AttachmentID: attachment.ID,
		Model: "teste", Language: "pt", Text: "fala do audio", CreatedAt: now,
	}, nil); err != nil {
		t.Fatalf("save transcript: %v", err)
	}
	if err := st.CreateLink(ctx, store.Link{
		ID: id.New(), FromEntryID: entryID, ToEntryID: otherID, CreatedAt: now,
	}); err != nil {
		t.Fatalf("create link: %v", err)
	}

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	sections := input.analysisSections()
	// Texto escrito, transcricao e links como secoes separadas: cada uma tem a
	// sua propria leitura, em vez de tudo num blob so.
	if len(sections) != 3 {
		t.Fatalf("secoes = %d, queria 3: %v", len(sections), sections)
	}
	joined := ""
	for _, section := range sections {
		joined += section.Heading + "\n" + section.Text + "\n"
	}
	for _, want := range []string{
		"texto escrito", "imagem: foto", "https://exemplo.com",
		"Transcrição do áudio", "fala do audio", "Links", "outra nota",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("faltou %q em:\n%s", want, joined)
		}
	}
	if input.Language != "pt" {
		t.Fatalf("language = %q, want pt", input.Language)
	}
	if input.TextChars == 0 || input.TranscriptChars == 0 || input.Images != 1 {
		t.Fatalf("medidas = texto %d, fala %d, imagens %d", input.TextChars, input.TranscriptChars, input.Images)
	}
}

// Nota so com imagem: a legenda/arquivo entra na analise (o conteudo visual
// exigiria um modelo com visao).
func TestAnalysisInputWithOnlyAnImage(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := id.New()
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "foto", Status: store.EntryReady, Source: "text",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateNote(ctx, store.Note{
		ID: id.New(), EntryID: entryID, ContentMarkdown: "![1000315674.jpg](attachment:abc)",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	sections := input.analysisSections()
	if len(sections) != 1 || !strings.Contains(sections[0].Text, "imagem: 1000315674.jpg") {
		t.Fatalf("secoes = %v", sections)
	}
}

func openWriterStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return st
}

// O job de transcricao pode falhar depois de o aparelho ja ter enviado o texto
// (PUT /transcript). A falha do worker nao pode marcar a nota como "falhou":
// o texto esta salvo e visivel no dashboard.
func TestTranscribeFailureKeepsDeviceTranscript(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := "entry_device_transcript"
	if err := st.CreateEntry(ctx, store.Entry{
		ID:        entryID,
		Title:     "audio do aparelho",
		Status:    store.EntryQueued,
		Source:    "audio",
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	attachmentID := "att_device_transcript"
	if err := st.CreateAttachment(ctx, store.Attachment{
		ID:          attachmentID,
		EntryID:     entryID,
		Kind:        store.AttachmentOriginal,
		StorageKey:  "audio",
		ContentType: "audio/wav",
		Cipher:      "aes-256-gcm",
		CreatedAt:   now,
	}); err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	if err := st.SaveTranscript(ctx, store.Transcript{
		ID:           "tr_device_transcript",
		EntryID:      entryID,
		AttachmentID: attachmentID,
		Model:        "local",
		Text:         "texto transcrito no aparelho",
		CreatedAt:    now,
	}, nil); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	deps := transcribe.Deps{
		Decrypt: func(context.Context, store.Attachment) (string, error) {
			return "", errors.New("ffmpeg nao instalado")
		},
	}
	pipeline := transcribe.NewPipeline(st, deps, t.TempDir(), "modelo")
	handler := transcribeHandler(st, config.Config{}, pipeline, jobs.NewQueue(st.DB()),
		events.NewBus(), slog.New(slog.NewTextHandler(io.Discard, nil)))

	payload, err := json.Marshal(jobs.TranscribePayload{EntryID: entryID, AttachmentID: attachmentID})
	if err != nil {
		t.Fatalf("payload: %v", err)
	}
	err = handler(ctx, &jobs.Job{Payload: payload, Attempts: 2, MaxAttempts: 3}, func() error { return nil })
	if err == nil {
		t.Fatal("esperava erro do pipeline")
	}
	entry, err := st.GetEntry(ctx, entryID)
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	if entry.Status != store.EntryTranscribed {
		t.Fatalf("status = %q, want %q", entry.Status, store.EntryTranscribed)
	}
}

// A revisao grava um derivado por trecho, aplica o texto aceito na entrada da
// analise e nao roda de novo quando ja esta atual.
func TestReviseTranscriptStoresAndReusesCurrentRevision(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := "entry_revision"
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "sede do pt", Status: store.EntryTranscribed, Source: "audio",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateAttachment(ctx, store.Attachment{
		ID: "att_revision", EntryID: entryID, Kind: store.AttachmentOriginal,
		StorageKey: "audio", ContentType: "audio/wav", Cipher: "aes-256-gcm", CreatedAt: now,
	}); err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	if err := st.SaveTranscript(ctx, store.Transcript{
		ID: "tr_revision", EntryID: entryID, AttachmentID: "att_revision",
		Model: "whisper", Text: "a sede do pt fica em sao paulo", CreatedAt: now,
	}, []store.Segment{
		{ID: "seg1", StartMS: 0, EndMS: 1000, Text: "a sede do pt fica em sao paulo", CreatedAt: now},
		{ID: "seg2", StartMS: 1000, EndMS: 2000, Text: "foram 3 pessoas", UserEdited: true, CreatedAt: now},
	}); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		content := `{"comprehension":81,"segments":[` +
			`"A sede do PT (Partido dos Trabalhadores) fica em São Paulo.",` +
			`"Foram 3 pessoas."]}`
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": content}}},
		})
	}))
	defer provider.Close()
	client := analyze.New(analyze.Config{Enabled: true, BaseURL: provider.URL, Model: "llm"})

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	metrics := analysisMetrics{Comprehension: -1}
	if err := reviseTranscript(ctx, st, client, "llm", entryID, &input, false, &metrics, events.NewBus()); err != nil {
		t.Fatalf("reviseTranscript: %v", err)
	}
	if metrics.Source != "review" || metrics.Comprehension != 81 {
		t.Fatalf("metricas = %+v", metrics)
	}
	if metrics.RevisedSegments != 1 {
		t.Fatalf("trechos revisados = %d, queria 1", metrics.RevisedSegments)
	}
	if !strings.Contains(input.Segments[0].Text, "Partido dos Trabalhadores") {
		t.Fatalf("analise nao recebeu o texto revisado: %q", input.Segments[0].Text)
	}
	if input.Segments[1].Text != "foram 3 pessoas" {
		t.Fatalf("trecho editado a mao foi alterado: %q", input.Segments[1].Text)
	}
	transcript, err := st.LatestTranscript(ctx, entryID)
	if err != nil {
		t.Fatalf("latest transcript: %v", err)
	}
	if transcript.RevisedPromptVersion != review.PromptVersion || transcript.RevisedComprehension != 81 {
		t.Fatalf("transcript sem revisao: %+v", transcript)
	}

	// Segunda rodada: o derivado esta atual, nada e enviado ao provedor.
	again, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput 2: %v", err)
	}
	if err := reviseTranscript(ctx, st, client, "llm", entryID, &again, false, &metrics, events.NewBus()); err != nil {
		t.Fatalf("reviseTranscript 2: %v", err)
	}
	if calls != 1 {
		t.Fatalf("chamadas ao provedor = %d, queria 1", calls)
	}
	if metrics.Comprehension != 81 {
		t.Fatalf("compreensao reaproveitada = %d", metrics.Comprehension)
	}
}

// Com a revisao gravada, a analise le o texto revisado e mantem os tempos.
func TestAnalysisInputReadsRevisedTranscript(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := "entry_revised_input"
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "revisada", Status: store.EntryTranscribed, Source: "audio",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateAttachment(ctx, store.Attachment{
		ID: "att_revised", EntryID: entryID, Kind: store.AttachmentOriginal,
		StorageKey: "audio", ContentType: "audio/wav", Cipher: "aes-256-gcm", CreatedAt: now,
	}); err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	if err := st.SaveTranscript(ctx, store.Transcript{
		ID: "tr_revised", EntryID: entryID, AttachmentID: "att_revised",
		Model: "whisper", Text: "a sede do pt", CreatedAt: now,
	}, []store.Segment{
		{ID: "seg_rev", StartMS: 500, EndMS: 1500, Text: "a sede do pt", CreatedAt: now},
	}); err != nil {
		t.Fatalf("save transcript: %v", err)
	}
	if err := st.SaveRevisions(ctx, "tr_revised", []store.TranscriptRevision{{
		SegmentID: "seg_rev", Text: "A sede do PT.", Model: "llm", PromptVersion: review.PromptVersion,
		CreatedAt: now,
	}}, 77, 0, 1, "llm", review.PromptVersion, false); err != nil {
		t.Fatalf("save revisions: %v", err)
	}

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	if len(input.Segments) != 1 || input.Segments[0].Text != "A sede do PT." {
		t.Fatalf("analise nao leu o revisado: %+v", input.Segments)
	}
	if input.Segments[0].StartMS != 500 || input.Segments[0].EndMS != 1500 {
		t.Fatalf("tempos perdidos: %+v", input.Segments[0])
	}
	sections := input.analysisSections()
	if len(sections) == 0 || !strings.Contains(sections[len(sections)-1].Text, "[00:00] A sede do PT.") {
		t.Fatalf("secao da transcricao sem horario: %+v", sections)
	}
	if input.Speech.Hesitation != 0 {
		t.Fatalf("fala contada sobre o revisado: %+v", input.Speech)
	}
}

// A revisao e publicada janela a janela, com os trechos alterados: e o que
// permite ao app e ao dashboard mostrarem o texto se montando em vez de esperar
// a transcricao inteira.
func TestReviseTranscriptPublishesEachWindow(t *testing.T) {
	ctx := context.Background()
	st := openWriterStore(t)
	now := time.Now().UTC()
	entryID := "entry_stream"
	if err := st.CreateEntry(ctx, store.Entry{
		ID: entryID, Title: "streaming", Status: store.EntryTranscribed, Source: "audio",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := st.CreateAttachment(ctx, store.Attachment{
		ID: "att_stream", EntryID: entryID, Kind: store.AttachmentOriginal,
		StorageKey: "audio", ContentType: "audio/wav", Cipher: "aes-256-gcm", CreatedAt: now,
	}); err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	segs := make([]store.Segment, 0, 12)
	lines := make([]string, 0, 12)
	for i := 0; i < 12; i++ {
		line := fmt.Sprintf("fala numero %d ne", i+1)
		lines = append(lines, line)
		segs = append(segs, store.Segment{ID: fmt.Sprintf("seg_stream_%d", i), StartMS: int64(i * 1000), EndMS: int64(i*1000 + 900), Text: line, CreatedAt: now})
	}
	if err := st.SaveTranscript(ctx, store.Transcript{
		ID: "tr_stream", EntryID: entryID, AttachmentID: "att_stream",
		Model: "whisper", Text: strings.Join(lines, "\n"), CreatedAt: now,
	}, segs); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("corpo: %v", err)
			return
		}
		var payload struct {
			Trechos []string `json:"trechos"`
		}
		if err := json.Unmarshal([]byte(body.Messages[len(body.Messages)-1].Content), &payload); err != nil {
			t.Errorf("payload: %v", err)
			return
		}
		out := make([]string, len(payload.Trechos))
		for i, trecho := range payload.Trechos {
			out[i] = strings.Replace(trecho, "ne", "ne?", 1)
		}
		content, _ := json.Marshal(map[string]any{"comprehension": 84, "segments": out})
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": string(content)}}},
		})
	}))
	defer provider.Close()
	client := analyze.New(analyze.Config{Enabled: true, BaseURL: provider.URL, Model: "llm"})

	input, err := analysisInput(ctx, st, entryID)
	if err != nil {
		t.Fatalf("analysisInput: %v", err)
	}
	bus := events.NewBus()
	metrics := analysisMetrics{Comprehension: -1}
	if err := reviseTranscript(ctx, st, client, "llm", entryID, &input, false, &metrics, bus); err != nil {
		t.Fatalf("reviseTranscript: %v", err)
	}

	var windows []map[string]any
	for _, ev := range bus.Since(0) {
		if ev.Name != "transcript.revised" {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal(ev.Data, &payload); err != nil {
			t.Fatalf("evento invalido: %v", err)
		}
		windows = append(windows, payload)
	}
	if len(windows) != 2 {
		t.Fatalf("janelas publicadas = %d, queria 2", len(windows))
	}
	if windows[0]["total"].(float64) != 2 || windows[0]["done"].(float64) != 1 {
		t.Fatalf("progresso da primeira janela = %+v", windows[0])
	}
	if windows[1]["done"].(float64) != 2 {
		t.Fatalf("progresso da segunda janela = %+v", windows[1])
	}
	if got := len(windows[0]["segments"].([]any)); got != 10 {
		t.Fatalf("trechos alterados na primeira janela = %d, queria 10", got)
	}
	if got := len(windows[1]["segments"].([]any)); got != 2 {
		t.Fatalf("trechos alterados na segunda janela = %d, queria 2", got)
	}
	if windows[0]["attachment_id"] != "att_stream" {
		t.Fatalf("audio do evento = %v", windows[0]["attachment_id"])
	}

	transcript, err := st.LatestTranscript(ctx, entryID)
	if err != nil {
		t.Fatalf("latest transcript: %v", err)
	}
	if transcript.RevisedRejected != 0 || transcript.RevisedPromptVersion != review.PromptVersion {
		t.Fatalf("revisao final = %+v", transcript)
	}
}
