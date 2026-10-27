package api

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

func TestEntryDetailIncludesAudios(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	seedPlainEntry(t, srv, "e1")
	now := time.Now().UTC()
	for _, id := range []string{"a1", "a2"} {
		if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
			ID: id, EntryID: "e1", Kind: store.AttachmentOriginal, StorageKey: "objects/" + id,
			ContentType: "audio/wav", SizeBytes: 10, Cipher: "aes-256-gcm", DurationSeconds: 12, CreatedAt: now,
		}); err != nil {
			t.Fatalf("attachment %s: %v", id, err)
		}
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t1", EntryID: "e1", AttachmentID: "a1", Model: "m", Text: "oi", CreatedAt: now,
	}, nil); err != nil {
		t.Fatalf("transcript: %v", err)
	}

	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries/e1", nil)
	audios, _ := body["audios"].([]any)
	if len(audios) != 2 {
		t.Fatalf("audios = %+v", body["audios"])
	}
	first := audios[0].(map[string]any)
	if first["id"] != "a1" {
		t.Fatalf("primeiro audio = %v", first)
	}
	if _, ok := first["transcript"]; !ok {
		t.Fatalf("a1 deveria ter transcricao: %v", first)
	}
	if _, ok := audios[1].(map[string]any)["transcript"]; ok {
		t.Fatalf("a2 nao deveria ter transcricao")
	}
}

func TestUploadAddsAudioToExistingEntry(t *testing.T) {
	srv := newTestServer(t)
	_, created := doJSON(t, srv, http.MethodPost, "/api/v1/entries", strings.NewReader(`{"title":""}`))
	entryID, _ := created["id"].(string)
	if entryID == "" {
		t.Fatalf("entry id ausente: %v", created)
	}

	data := []byte("audio-bytes")
	rec, up := doJSON(t, srv, http.MethodPost, "/api/v1/uploads",
		strings.NewReader(fmt.Sprintf(`{"filename":"a.wav","content_type":"audio/wav","size_bytes":%d,"entry_id":%q}`, len(data), entryID)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create upload: %d %v", rec.Code, up)
	}
	uploadID, _ := up["id"].(string)

	putReq := authedRequest(http.MethodPut, "/api/v1/uploads/"+uploadID, bytes.NewReader(data))
	putReq.Header.Set("X-Upload-Offset", "0")
	putRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(putRec, putReq)
	if putRec.Code != http.StatusOK {
		t.Fatalf("put: %d %s", putRec.Code, putRec.Body.String())
	}

	compRec, comp := doJSON(t, srv, http.MethodPost, "/api/v1/uploads/"+uploadID+"/complete", nil)
	if compRec.Code != http.StatusCreated {
		t.Fatalf("complete: %d %v", compRec.Code, comp)
	}
	if comp["entry_id"] != entryID {
		t.Fatalf("entry_id = %v, want %v", comp["entry_id"], entryID)
	}

	_, body := doJSON(t, srv, http.MethodGet, "/api/v1/entries/"+entryID, nil)
	audios, _ := body["audios"].([]any)
	if len(audios) != 1 {
		t.Fatalf("audios = %+v", body["audios"])
	}
}

// Apagar um audio e uma remocao de verdade: o anexo, a transcricao e os
// segmentos saem, e a duracao da nota passa a somar so o que sobrou. Antes so o
// marcador saia do corpo e o audio reaparecia na pilha do dashboard.
func TestDeleteAudioRemovesTranscriptAndUpdatesDuration(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	seedPlainEntry(t, srv, "e1")
	now := time.Now().UTC()
	for _, audio := range []struct {
		id       string
		duration float64
	}{{"a1", 19}, {"a2", 52}} {
		if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
			ID: audio.id, EntryID: "e1", Kind: store.AttachmentOriginal, StorageKey: "objects/" + audio.id,
			ContentType: "audio/wav", SizeBytes: 10, Cipher: "aes-256-gcm",
			DurationSeconds: audio.duration, CreatedAt: now,
		}); err != nil {
			t.Fatalf("attachment %s: %v", audio.id, err)
		}
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t1", EntryID: "e1", AttachmentID: "a1", Model: "m", Text: "fala", CreatedAt: now,
	}, []store.Segment{{StartMS: 0, EndMS: 1000, Text: "fala"}}); err != nil {
		t.Fatalf("transcript: %v", err)
	}

	rec, _ := doJSON(t, srv, http.MethodDelete, "/api/v1/attachments/a1", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete audio: %d %s", rec.Code, rec.Body.String())
	}

	entry, err := srv.deps.Store.GetEntry(ctx, "e1")
	if err != nil {
		t.Fatalf("entry: %v", err)
	}
	if entry.DurationSeconds != 52 {
		t.Fatalf("duracao = %v, queria 52", entry.DurationSeconds)
	}
	audios, err := srv.deps.Store.ListAudios(ctx, "e1")
	if err != nil || len(audios) != 1 || audios[0].ID != "a2" {
		t.Fatalf("audios = %+v (%v)", audios, err)
	}
	if _, _, err := srv.deps.Store.GetTranscript(ctx, "t1"); err == nil {
		t.Fatal("a transcricao do audio apagado deveria sair junto")
	}
}
