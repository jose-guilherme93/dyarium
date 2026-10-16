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

// Um upload marcado como transcricao local nao deve entrar na fila de
// transcricao do servidor (o cliente transcreve no aparelho).
func TestLocalTranscribeSkipsQueue(t *testing.T) {
	srv := newTestServer(t)

	data := []byte("audio-bytes")
	rec, up := doJSON(t, srv, http.MethodPost, "/api/v1/uploads",
		strings.NewReader(fmt.Sprintf(
			`{"filename":"a.wav","content_type":"audio/wav","size_bytes":%d,"local_transcribe":true}`,
			len(data),
		)))
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
	if comp["status"] == store.EntryQueued {
		t.Fatalf("nao deveria enfileirar transcricao: %v", comp)
	}
}

// O app empurra a transcricao feita no aparelho; o servidor guarda com origem
// local (model "local").
func TestPutTranscriptStoresLocal(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	seedPlainEntry(t, srv, "e1")
	now := time.Now().UTC()
	if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
		ID: "a1", EntryID: "e1", Kind: store.AttachmentOriginal, StorageKey: "objects/a1",
		ContentType: "audio/wav", SizeBytes: 10, Cipher: "aes-256-gcm", DurationSeconds: 12, CreatedAt: now,
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}

	body := `{"attachment_id":"a1","language":"pt","text":"ola mundo","segments":[{"start_ms":0,"end_ms":1000,"text":"ola mundo"}]}`
	rec, _ := doJSON(t, srv, http.MethodPut, "/api/v1/entries/e1/transcript", strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("put transcript: %d %s", rec.Code, rec.Body.String())
	}

	transcript, segments, err := srv.deps.Store.GetTranscript(ctx, "e1")
	if err != nil {
		t.Fatalf("get transcript: %v", err)
	}
	if transcript.Model != "local" || transcript.Text != "ola mundo" {
		t.Fatalf("transcript = %+v", transcript)
	}
	if len(segments) != 1 || segments[0].StartMS != 0 || segments[0].EndMS != 1000 {
		t.Fatalf("segments = %+v", segments)
	}
}
