package store

import (
	"context"
	"testing"
	"time"
)

// saveRevisionTranscript grava uma transcricao de tres trechos e devolve o id.
func saveRevisionTranscript(t *testing.T, s *Store) string {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	if err := s.CreateEntry(ctx, Entry{
		ID: "e_rev", Title: "revisao", Status: EntryTranscribed, Source: "audio",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	transcript := Transcript{ID: "t_rev", EntryID: "e_rev", Model: "whisper", Text: "a b c", CreatedAt: now}
	segs := []Segment{
		{ID: "s1", StartMS: 0, EndMS: 1000, Text: "a", CreatedAt: now},
		{ID: "s2", StartMS: 1000, EndMS: 2000, Text: "b", CreatedAt: now},
		{ID: "s3", StartMS: 2000, EndMS: 3000, Text: "c", CreatedAt: now},
	}
	if err := s.SaveTranscript(ctx, transcript, segs); err != nil {
		t.Fatalf("save transcript: %v", err)
	}
	return transcript.ID
}

func TestSaveRevisionsReadsRevisedText(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	transcriptID := saveRevisionTranscript(t, s)

	revs := []TranscriptRevision{
		{SegmentID: "s1", Text: "A, revisado.", Model: "llm", PromptVersion: 1, CreatedAt: time.Now().UTC()},
		{SegmentID: "s2", Text: "b", Model: "llm", PromptVersion: 1, CreatedAt: time.Now().UTC()},
		{SegmentID: "s3", Text: "c", Model: "llm", PromptVersion: 1, CreatedAt: time.Now().UTC()},
	}
	if err := s.SaveRevisions(ctx, transcriptID, revs, 82, 0, 3, "llm", 1, false); err != nil {
		t.Fatalf("save revisions: %v", err)
	}

	transcript, segments, err := s.GetTranscript(ctx, "e_rev")
	if err != nil {
		t.Fatalf("get transcript: %v", err)
	}
	if transcript.RevisedText != "A, revisado.\nb\nc" {
		t.Fatalf("revised_text = %q", transcript.RevisedText)
	}
	if transcript.RevisedComprehension != 82 || transcript.RevisedModel != "llm" || transcript.RevisedPromptVersion != 1 {
		t.Fatalf("metadados da revisao = %+v", transcript)
	}
	if segments[0].Revised != "A, revisado." || segments[0].Text != "a" {
		t.Fatalf("original sobrescrito: %+v", segments[0])
	}
	if segments[1].Revised != "b" {
		t.Fatalf("trecho sem mudanca deveria continuar marcado como revisado: %+v", segments[1])
	}
}

// Um novo sync do aparelho (mesmo texto) nao pode apagar a revisao.
func TestSaveTranscriptKeepsRevisionsWhenTextIsUnchanged(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	transcriptID := saveRevisionTranscript(t, s)
	now := time.Now().UTC()
	if err := s.SaveRevisions(ctx, transcriptID, []TranscriptRevision{
		{SegmentID: "s1", Text: "A, revisado.", Model: "llm", PromptVersion: 1, CreatedAt: now},
		{SegmentID: "s2", Text: "b", Model: "llm", PromptVersion: 1, CreatedAt: now},
		{SegmentID: "s3", Text: "c", Model: "llm", PromptVersion: 1, CreatedAt: now},
	}, 82, 0, 3, "llm", 1, false); err != nil {
		t.Fatalf("save revisions: %v", err)
	}

	// O app reenvia a transcricao inteira com ids novos, sem editar nada.
	if err := s.SaveTranscript(ctx, Transcript{
		ID: "t_rev2", EntryID: "e_rev", Model: "whisper", Text: "a b c", CreatedAt: now,
	}, []Segment{
		{ID: "n1", StartMS: 0, EndMS: 1000, Text: "a", CreatedAt: now},
		{ID: "n2", StartMS: 1000, EndMS: 2000, Text: "b", CreatedAt: now},
		{ID: "n3", StartMS: 2000, EndMS: 3000, Text: "c", CreatedAt: now},
	}); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	transcript, segments, err := s.GetTranscript(ctx, "e_rev")
	if err != nil {
		t.Fatalf("get transcript: %v", err)
	}
	if transcript.RevisedText != "A, revisado.\nb\nc" {
		t.Fatalf("revisao perdida no resync: %q", transcript.RevisedText)
	}
	if segments[0].Revised != "A, revisado." {
		t.Fatalf("trecho revisado perdido: %+v", segments[0])
	}
	if transcript.RevisedComprehension != 82 {
		t.Fatalf("compreensao perdida no resync: %d", transcript.RevisedComprehension)
	}
	if !transcript.RevisedFinished || transcript.RevisedThrough != 3 {
		t.Fatalf("estado da passada perdido: through=%d finished=%v",
			transcript.RevisedThrough, transcript.RevisedFinished)
	}
}

// Retranscrever de verdade (texto diferente) comeca uma passada nova: a
// compreensao antiga nao pode ser reaproveitada para outro texto.
func TestSaveTranscriptResetsRevisionStateWhenTextChanges(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	transcriptID := saveRevisionTranscript(t, s)
	now := time.Now().UTC()
	if err := s.SaveRevisions(ctx, transcriptID, []TranscriptRevision{
		{SegmentID: "s1", Text: "A, revisado.", Model: "llm", PromptVersion: 1, CreatedAt: now},
		{SegmentID: "s2", Text: "b", Model: "llm", PromptVersion: 1, CreatedAt: now},
		{SegmentID: "s3", Text: "c", Model: "llm", PromptVersion: 1, CreatedAt: now},
	}, 82, 0, 3, "llm", 1, false); err != nil {
		t.Fatalf("save revisions: %v", err)
	}

	if err := s.SaveTranscript(ctx, Transcript{
		ID: "t_rev4", EntryID: "e_rev", Model: "whisper", Text: "a b c diferente", CreatedAt: now,
	}, []Segment{
		{ID: "d1", StartMS: 0, EndMS: 1000, Text: "a", CreatedAt: now},
		{ID: "d2", StartMS: 1000, EndMS: 2000, Text: "b", CreatedAt: now},
		{ID: "d3", StartMS: 2000, EndMS: 3000, Text: "c diferente", CreatedAt: now},
	}); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	transcript, _, err := s.GetTranscript(ctx, "e_rev")
	if err != nil {
		t.Fatalf("get transcript: %v", err)
	}
	if transcript.RevisedComprehension != -1 || transcript.RevisedFinished || transcript.RevisedThrough != 0 {
		t.Fatalf("passada antiga reaproveitada: %+v", transcript)
	}
}

// Editar um trecho a mao descarta so a revisao dele: a escrita do usuario vence.
func TestSaveTranscriptDropsRevisionOfEditedSegment(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	transcriptID := saveRevisionTranscript(t, s)
	now := time.Now().UTC()
	if err := s.SaveRevisions(ctx, transcriptID, []TranscriptRevision{
		{SegmentID: "s1", Text: "A, revisado.", Model: "llm", PromptVersion: 1, CreatedAt: now},
		{SegmentID: "s2", Text: "b", Model: "llm", PromptVersion: 1, CreatedAt: now},
		{SegmentID: "s3", Text: "c", Model: "llm", PromptVersion: 1, CreatedAt: now},
	}, 82, 0, 3, "llm", 1, false); err != nil {
		t.Fatalf("save revisions: %v", err)
	}

	if err := s.SaveTranscript(ctx, Transcript{
		ID: "t_rev3", EntryID: "e_rev", Model: "whisper", Text: "a b c", CreatedAt: now,
	}, []Segment{
		{ID: "m1", StartMS: 0, EndMS: 1000, Text: "a", CreatedAt: now},
		{ID: "m2", StartMS: 1000, EndMS: 2000, Text: "b editado por mim", UserEdited: true, CreatedAt: now},
		{ID: "m3", StartMS: 2000, EndMS: 3000, Text: "c", CreatedAt: now},
	}); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	transcript, segments, err := s.GetTranscript(ctx, "e_rev")
	if err != nil {
		t.Fatalf("get transcript: %v", err)
	}
	if transcript.RevisedText != "A, revisado.\nb editado por mim\nc" {
		t.Fatalf("revised_text = %q", transcript.RevisedText)
	}
	if segments[1].Revised != "" {
		t.Fatalf("trecho editado nao deveria manter revisao: %+v", segments[1])
	}
	if transcript.RevisedComprehension != 82 || !transcript.RevisedFinished || transcript.RevisedThrough != 3 {
		t.Fatalf("editar um trecho apagou a passada: %+v", transcript)
	}
	if !segments[1].UserEdited {
		t.Fatalf("flag de edicao perdida: %+v", segments[1])
	}
	if segments[2].Revised != "c" {
		t.Fatalf("revisao dos outros trechos perdida: %+v", segments[2])
	}
}

// Transcricao salva antes do audio existir fica solta; o boot liga ao unico
// audio da nota para o dashboard voltar a mostrar o texto.
func TestLinkLooseTranscriptsAttachesSingleAudio(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if err := s.CreateEntry(ctx, Entry{
		ID: "e_loose", Title: "solta", Status: EntryTranscribed, Source: "upload",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if err := s.CreateAttachment(ctx, Attachment{
		ID: "a_loose", EntryID: "e_loose", Kind: AttachmentOriginal, StorageKey: "audio",
		ContentType: "audio/aac", SizeBytes: 10, Cipher: "aes-256-gcm", CreatedAt: now,
	}); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	if err := s.SaveTranscript(ctx, Transcript{
		ID: "t_loose", EntryID: "e_loose", Model: "local", Text: "texto do aparelho", CreatedAt: now,
	}, []Segment{{ID: "s_loose", StartMS: 0, EndMS: 1000, Text: "texto do aparelho", CreatedAt: now}}); err != nil {
		t.Fatalf("save transcript: %v", err)
	}

	linked, err := s.LinkLooseTranscripts(ctx)
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if linked != 1 {
		t.Fatalf("ligadas = %d, queria 1", linked)
	}
	transcript, segments, err := s.GetTranscriptByAttachment(ctx, "a_loose")
	if err != nil {
		t.Fatalf("transcript do audio: %v", err)
	}
	if transcript.Text != "texto do aparelho" || len(segments) != 1 {
		t.Fatalf("transcript = %+v, segments = %d", transcript, len(segments))
	}
}

// Com mais de um audio o vinculo e ambiguo: nada muda.
func TestLinkLooseTranscriptsIgnoresMultipleAudios(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if err := s.CreateEntry(ctx, Entry{
		ID: "e_multi", Title: "varios", Status: EntryTranscribed, Source: "upload",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create entry: %v", err)
	}
	for _, id := range []string{"a1", "a2"} {
		if err := s.CreateAttachment(ctx, Attachment{
			ID: id, EntryID: "e_multi", Kind: AttachmentOriginal, StorageKey: id,
			ContentType: "audio/aac", SizeBytes: 10, Cipher: "aes-256-gcm", CreatedAt: now,
		}); err != nil {
			t.Fatalf("attachment %s: %v", id, err)
		}
	}
	if err := s.SaveTranscript(ctx, Transcript{
		ID: "t_multi", EntryID: "e_multi", Model: "local", Text: "texto", CreatedAt: now,
	}, nil); err != nil {
		t.Fatalf("save transcript: %v", err)
	}
	linked, err := s.LinkLooseTranscripts(ctx)
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if linked != 0 {
		t.Fatalf("ligadas = %d, queria 0", linked)
	}
}

// A revisao chega por janela: cada janela grava e o leitor ve o texto crescer
// antes de a passada inteira terminar. Um trecho sem linha ainda nao foi
// revisado, e o recusado tem que sobreviver ao restart.
func TestSaveRevisionWindowStreamsBeforeThePassEnds(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	transcriptID := saveRevisionTranscript(t, s)
	now := time.Now().UTC()

	if err := s.BeginRevision(ctx, transcriptID); err != nil {
		t.Fatalf("begin revision: %v", err)
	}
	if err := s.SaveRevisionWindow(ctx, transcriptID, []TranscriptRevision{
		{SegmentID: "s1", Text: "A, revisado.", Model: "llm", PromptVersion: 1, CreatedAt: now},
		{SegmentID: "s2", Text: "b", Model: "llm", PromptVersion: 1, CreatedAt: now},
	}, 0, 2); err != nil {
		t.Fatalf("save window: %v", err)
	}

	transcript, segments, err := s.GetTranscript(ctx, "e_rev")
	if err != nil {
		t.Fatalf("get transcript: %v", err)
	}
	if segments[0].Revised != "A, revisado." {
		t.Fatalf("primeiro trecho = %q", segments[0].Revised)
	}
	if segments[2].Revised != "" {
		t.Fatalf("terceiro trecho ainda nao foi revisado: %q", segments[2].Revised)
	}
	if transcript.RevisedPromptVersion != 1 || transcript.RevisedModel != "llm" {
		t.Fatalf("revisao nao marcada: %+v", transcript)
	}
	if transcript.RevisedText != "A, revisado.\nb\nc" {
		t.Fatalf("texto derivado = %q", transcript.RevisedText)
	}

	if err := s.SaveRevisionWindow(ctx, transcriptID, []TranscriptRevision{
		{SegmentID: "s3", Text: "c", Model: "llm", PromptVersion: 1, CreatedAt: now},
	}, 1, 3); err != nil {
		t.Fatalf("save window 2: %v", err)
	}
	if err := s.FinishRevision(ctx, transcriptID, 82, 1, 3, "llm", 1, false); err != nil {
		t.Fatalf("finish revision: %v", err)
	}
	transcript, _, err = s.GetTranscript(ctx, "e_rev")
	if err != nil {
		t.Fatalf("get transcript 2: %v", err)
	}
	if transcript.RevisedComprehension != 82 {
		t.Fatalf("compreensao = %d", transcript.RevisedComprehension)
	}
	if transcript.RevisedRejected != 1 {
		t.Fatalf("recusados = %d, queria 1", transcript.RevisedRejected)
	}
}

// Comecar uma passada nova descarta a anterior: a revisao velha era de outro
// modelo, prompt ou modo e nao pode se misturar com a nova.
func TestBeginRevisionClearsThePreviousPass(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	transcriptID := saveRevisionTranscript(t, s)
	now := time.Now().UTC()
	if err := s.SaveRevisions(ctx, transcriptID, []TranscriptRevision{
		{SegmentID: "s1", Text: "A, revisado.", Model: "llm", PromptVersion: 1, CreatedAt: now},
	}, 82, 0, 3, "llm", 1, false); err != nil {
		t.Fatalf("save revisions: %v", err)
	}

	if err := s.BeginRevision(ctx, transcriptID); err != nil {
		t.Fatalf("begin revision: %v", err)
	}
	transcript, segments, err := s.GetTranscript(ctx, "e_rev")
	if err != nil {
		t.Fatalf("get transcript: %v", err)
	}
	if transcript.RevisedPromptVersion != 0 || transcript.RevisedText != "" {
		t.Fatalf("revisao antiga sobreviveu: %+v", transcript)
	}
	if transcript.RevisedRejected != 0 || transcript.RevisedComprehension != -1 {
		t.Fatalf("contadores antigos sobreviveram: %+v", transcript)
	}
	for _, seg := range segments {
		if seg.Revised != "" {
			t.Fatalf("trecho ainda revisado: %+v", seg)
		}
	}
}
