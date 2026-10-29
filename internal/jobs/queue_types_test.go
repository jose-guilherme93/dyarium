package jobs_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/jobs"
)

func TestClaimTypesFiltersJobs(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	if _, err := q.Enqueue(ctx, jobs.TypeCleanup, "cleanup:en1", jobs.CleanupPayload{EntryID: "en1"}); err != nil {
		t.Fatalf("enqueue cleanup: %v", err)
	}
	if _, err := q.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:en2", jobs.TranscribePayload{EntryID: "en2"}); err != nil {
		t.Fatalf("enqueue transcribe: %v", err)
	}

	job, err := q.ClaimTypes(ctx, "browser-1", time.Minute, []string{jobs.TypeTranscribe, jobs.TypeAnalyze})
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if job == nil || job.Type != jobs.TypeTranscribe {
		t.Fatalf("browser claimed %+v, want a transcribe job", job)
	}

	job, err = q.ClaimTypes(ctx, "browser-1", time.Minute, []string{jobs.TypeTranscribe, jobs.TypeAnalyze})
	if err != nil {
		t.Fatalf("claim 2: %v", err)
	}
	if job != nil {
		t.Fatalf("browser should not see cleanup, got %+v", job)
	}

	// The server keeps cleanup even while the browser holds the heavy types.
	job, err = q.ClaimTypes(ctx, "worker-1", time.Minute, []string{jobs.TypeCleanup})
	if err != nil {
		t.Fatalf("claim cleanup: %v", err)
	}
	if job == nil || job.Type != jobs.TypeCleanup {
		t.Fatalf("server claimed %+v, want cleanup", job)
	}
}

func TestOwnedOperationsRejectOtherWorker(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	if _, err := q.Enqueue(ctx, jobs.TypeAnalyze, "analyze:en1", jobs.AnalyzePayload{EntryID: "en1"}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	job, err := q.Claim(ctx, "worker-a", time.Minute)
	if err != nil || job == nil {
		t.Fatalf("claim: %v %+v", err, job)
	}

	ok, err := q.HeartbeatOwned(ctx, job.ID, "worker-b", time.Minute)
	if err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	if ok {
		t.Fatal("another worker renewed the lease")
	}
	ok, err = q.CompleteOwned(ctx, job.ID, "worker-b")
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if ok {
		t.Fatal("another worker completed the job")
	}
	ok, err = q.FailOwned(ctx, job.ID, "worker-b", errors.New("x"), time.Millisecond)
	if err != nil {
		t.Fatalf("fail: %v", err)
	}
	if ok {
		t.Fatal("another worker failed the job")
	}

	ok, err = q.HeartbeatOwned(ctx, job.ID, "worker-a", time.Minute)
	if err != nil || !ok {
		t.Fatalf("owner heartbeat = %v, %v", ok, err)
	}
	ok, err = q.CompleteOwned(ctx, job.ID, "worker-a")
	if err != nil || !ok {
		t.Fatalf("owner complete = %v, %v", ok, err)
	}
	stored, err := q.Get(ctx, job.ID)
	if err != nil || stored == nil {
		t.Fatalf("get: %v %+v", err, stored)
	}
	if stored.Status != jobs.StatusDone {
		t.Fatalf("status = %s, want done", stored.Status)
	}
}

func TestOwnedOperationsLoseExpiredLease(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	if _, err := q.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:en1", jobs.TranscribePayload{EntryID: "en1"}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	job, err := q.Claim(ctx, "worker-a", time.Millisecond)
	if err != nil || job == nil {
		t.Fatalf("claim: %v %+v", err, job)
	}
	time.Sleep(5 * time.Millisecond)
	if err := q.RequeueExpired(ctx); err != nil {
		t.Fatalf("requeue: %v", err)
	}
	ok, err := q.CompleteOwned(ctx, job.ID, "worker-a")
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if ok {
		t.Fatal("expired lease should not complete")
	}
	stored, err := q.Get(ctx, job.ID)
	if err != nil || stored == nil {
		t.Fatalf("get: %v %+v", err, stored)
	}
	if stored.Status != jobs.StatusQueued {
		t.Fatalf("status = %s, want queued", stored.Status)
	}
}

func TestClaimEntryNeverPicksAnotherNote(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	if _, err := q.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-a"), jobs.AnalyzePayload{EntryID: "entry-a"}); err != nil {
		t.Fatalf("enqueue a: %v", err)
	}

	// A nota que o usuario pediu ainda nao entrou na fila: o claim nao pode
	// aproveitar a viagem para pegar o trabalho de outra nota.
	job, err := q.ClaimEntry(ctx, "browser-1", time.Minute, nil, "entry-b")
	if err != nil {
		t.Fatalf("claim entry b: %v", err)
	}
	if job != nil {
		t.Fatalf("claim entry b returned %+v, want nothing", job)
	}

	// O job de entry-a continua disponivel para quem pedir.
	job, err = q.ClaimEntry(ctx, "browser-1", time.Minute, nil, "entry-a")
	if err != nil || job == nil {
		t.Fatalf("claim entry a: %v %+v", err, job)
	}
	var payload jobs.AnalyzePayload
	if err := jobs.DecodePayload(job, &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.EntryID != "entry-a" {
		t.Fatalf("entry = %q, want entry-a", payload.EntryID)
	}
}

func TestClaimForPrefersEntry(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	if _, err := q.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-a"), jobs.AnalyzePayload{EntryID: "entry-a"}); err != nil {
		t.Fatalf("enqueue a: %v", err)
	}
	if _, err := q.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-b"), jobs.AnalyzePayload{EntryID: "entry-b"}); err != nil {
		t.Fatalf("enqueue b: %v", err)
	}

	job, err := q.ClaimFor(ctx, "browser-1", time.Minute, nil, "entry-b")
	if err != nil || job == nil {
		t.Fatalf("claim preferred: %v %+v", err, job)
	}
	var payload jobs.AnalyzePayload
	if err := jobs.DecodePayload(job, &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.EntryID != "entry-b" {
		t.Fatalf("preferred entry = %q, want entry-b", payload.EntryID)
	}

	// Sem o job preferido, o worker volta para a ordem normal da fila.
	job, err = q.ClaimFor(ctx, "browser-1", time.Minute, nil, "entry-b")
	if err != nil || job == nil {
		t.Fatalf("claim fallback: %v %+v", err, job)
	}
	if err := jobs.DecodePayload(job, &payload); err != nil {
		t.Fatalf("decode fallback: %v", err)
	}
	if payload.EntryID != "entry-a" {
		t.Fatalf("fallback entry = %q, want entry-a", payload.EntryID)
	}
}
