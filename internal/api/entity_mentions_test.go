package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestEntityMentionsReturnTranscriptAndTextExcerpts(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	entry := store.Entry{
		ID: "e-mentions", Title: "Dia no Recife", Status: store.EntryStored,
		Source: "upload", RecordedAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := srv.deps.Store.CreateEntry(ctx, entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := srv.deps.Store.SaveRichAnalysis(ctx, store.Analysis{
		ID: "a-mentions", EntryID: entry.ID, Model: "m", Sentiment: 0.5, SentimentLabel: "positivo",
		Data:      `{"reading":"Uma tarde no Recife com Maria.","summary":"resumo antigo"}`,
		CreatedAt: now,
	}, []store.EntityLink{
		{Kind: store.EntityPerson, Name: "Maria", Count: 2},
		{Kind: store.EntityPlace, Name: "Recife", Count: 2},
	}); err != nil {
		t.Fatalf("save analysis: %v", err)
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t-mentions", EntryID: entry.ID, Model: "whisper", Language: "pt",
		Text: "fui ao recife com maria", DurationSeconds: 30, CreatedAt: now,
	}, []store.Segment{
		{ID: "seg-1", TranscriptID: "t-mentions", StartMS: 0, EndMS: 2000, Text: "fui ao recife com maria"},
		{ID: "seg-2", TranscriptID: "t-mentions", StartMS: 2000, EndMS: 5000, Text: "voltei para casa"},
	}); err != nil {
		t.Fatalf("save transcript: %v", err)
	}
	if err := srv.deps.Store.CreateNote(ctx, store.Note{
		ID: "n-mentions", EntryID: entry.ID, Title: "Dia no Recife",
		ContentMarkdown: "Ontem encontrei Maria no Recife. Foi uma tarde boa.",
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create note: %v", err)
	}

	rec, body := doJSON(t, srv, http.MethodGet, "/api/v1/entities/person/Maria/mentions", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body %s", rec.Code, rec.Body.String())
	}
	mentions, _ := body["mentions"].([]any)
	if len(mentions) != 2 {
		t.Fatalf("mencoes = %+v", body["mentions"])
	}
	transcript, _ := mentions[0].(map[string]any)
	if transcript["source"] != "transcript" || transcript["text"] != "fui ao recife com maria" {
		t.Fatalf("trecho da transcricao = %+v", transcript)
	}
	if transcript["start_ms"].(float64) != 0 || transcript["term"] != "Maria" {
		t.Fatalf("tempo/termo = %+v", transcript)
	}
	if transcript["comment"] != "Uma tarde no Recife com Maria." {
		t.Fatalf("comentario = %q", transcript["comment"])
	}
	text, _ := mentions[1].(map[string]any)
	if text["source"] != "text" || !strings.Contains(text["text"].(string), "encontrei Maria no Recife") {
		t.Fatalf("trecho do texto = %+v", text)
	}
	if _, ok := text["start_ms"]; ok {
		t.Fatalf("trecho escrito nao tem tempo de audio: %+v", text)
	}

	rec, body = doJSON(t, srv, http.MethodGet, "/api/v1/entities/place/Recife/mentions", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("lugar status = %d", rec.Code)
	}
	mentions, _ = body["mentions"].([]any)
	if len(mentions) != 2 {
		t.Fatalf("mencoes do lugar = %+v", body["mentions"])
	}

	rec, _ = doJSON(t, srv, http.MethodGet, "/api/v1/entities/place/Ninguem/mentions", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("entidade inexistente: status = %d, want 404", rec.Code)
	}

	// Depois do rename, a transcricao continua com a grafia antiga; o alias
	// precisa encontrar o mesmo trecho e informar qual palavra casou.
	if _, err := srv.deps.Store.RenameEntity(ctx, store.EntityPerson, "Maria", "Marianna"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	rec, body = doJSON(t, srv, http.MethodGet, "/api/v1/entities/person/Marianna/mentions", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("alias status = %d body %s", rec.Code, rec.Body.String())
	}
	mentions, _ = body["mentions"].([]any)
	if len(mentions) != 2 {
		t.Fatalf("mencoes pelo alias = %+v", body["mentions"])
	}
	aliased, _ := mentions[0].(map[string]any)
	if aliased["term"] != "Maria" {
		t.Fatalf("grafia antiga = %+v", aliased)
	}
}
