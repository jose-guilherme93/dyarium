package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/store"
)

// Nota gravada no app: o corpo e so o marcador do audio. A lista precisa mostrar
// a transcricao como previa, senao todos os audios aparecem sem texto.
func TestListPreviewFallsBackToTranscript(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	now := time.Now().UTC()
	seedPlainEntry(t, srv, "e_preview")
	if err := srv.deps.Store.CreateAttachment(ctx, store.Attachment{
		ID: "a_preview", EntryID: "e_preview", Kind: store.AttachmentOriginal,
		StorageKey: "objects/a_preview", ContentType: "audio/aac", SizeBytes: 10,
		Cipher: "aes-256-gcm", DurationSeconds: 883, CreatedAt: now,
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	if err := srv.deps.Store.CreateNote(ctx, store.Note{
		ID: "n_preview", EntryID: "e_preview",
		ContentMarkdown: "!audio[attachment:a_preview]{d=883.617}\n",
		CreatedAt:       now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("note: %v", err)
	}
	if err := srv.deps.Store.SaveTranscript(ctx, store.Transcript{
		ID: "t_preview", EntryID: "e_preview", AttachmentID: "a_preview",
		Model: "local", Text: "hoje eu falei sobre o dia 25 e sobre o que aconteceu",
		CreatedAt: now,
	}, []store.Segment{{ID: "s_preview", StartMS: 0, EndMS: 1000,
		Text: "hoje eu falei sobre o dia 25 e sobre o que aconteceu", CreatedAt: now}}); err != nil {
		t.Fatalf("transcript: %v", err)
	}

	rec, list := doJSON(t, srv, http.MethodGet, "/api/v1/entries?limit=10", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}
	entries := list["entries"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %d", len(entries))
	}
	preview, _ := entries[0].(map[string]any)["preview"].(string)
	if !strings.Contains(preview, "hoje eu falei sobre o dia 25") {
		t.Fatalf("preview = %q", preview)
	}
}
