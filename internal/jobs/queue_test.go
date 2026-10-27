package jobs_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
)

func newQueue(t *testing.T) *jobs.Queue {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "diary.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return jobs.NewQueue(st.DB())
}

func TestEnqueueIsIdempotent(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	id1, err := q.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:en1", jobs.TranscribePayload{EntryID: "en1"})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	id2, err := q.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:en1", jobs.TranscribePayload{EntryID: "en1"})
	if err != nil {
		t.Fatalf("enqueue 2: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("ids diferentes: %s != %s", id1, id2)
	}
	n, _ := q.CountByStatus(ctx, jobs.StatusQueued)
	if n != 1 {
		t.Fatalf("queued = %d, want 1", n)
	}
}

func TestClaimLeaseAndBackoff(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	if _, err := q.Enqueue(ctx, jobs.TypeTranscribe, "k1", jobs.TranscribePayload{EntryID: "en1"}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	job, err := q.Claim(ctx, "worker-1", time.Minute)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if job == nil {
		t.Fatal("claim retornou nil")
	}
	if job.WorkerID != "worker-1" || job.Status != jobs.StatusRunning {
		t.Fatalf("job inesperado: %+v", job)
	}

	// No other job is available.
	if again, _ := q.Claim(ctx, "worker-2", time.Minute); again != nil {
		t.Fatal("claim deveria retornar nil sem trabalho")
	}

	if err := q.Heartbeat(ctx, job.ID, "worker-1", time.Minute); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}

	// Fail once: it becomes retrying with a future availability.
	if err := q.Fail(ctx, job.ID, errTest, time.Second); err != nil {
		t.Fatalf("fail: %v", err)
	}
	retrying, _ := q.CountByStatus(ctx, jobs.StatusRetrying)
	if retrying != 1 {
		t.Fatalf("retrying = %d, want 1", retrying)
	}
	// Not claimable immediately.
	if again, _ := q.Claim(ctx, "worker-3", time.Minute); again != nil {
		t.Fatal("job em backoff nao deveria ser reivindicado")
	}

	// Exhaust attempts.
	for i := 0; i < 4; i++ {
		_ = q.Fail(ctx, job.ID, errTest, time.Second)
	}
	dead, _ := q.CountByStatus(ctx, jobs.StatusDead)
	if dead != 1 {
		t.Fatalf("dead = %d, want 1", dead)
	}
}

func TestRetryingJobIsClaimedAfterBackoff(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	id, err := q.Enqueue(ctx, jobs.TypeTranscribe, "retry-1", jobs.TranscribePayload{EntryID: "en1"})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	job, err := q.Claim(ctx, "worker-1", time.Minute)
	if err != nil || job == nil {
		t.Fatalf("claim: job=%v err=%v", job, err)
	}
	// Falha com backoff curto: o job fica "retrying" e indisponivel na hora.
	if err := q.Fail(ctx, id, errTest, 300*time.Millisecond); err != nil {
		t.Fatalf("fail: %v", err)
	}
	if again, _ := q.Claim(ctx, "worker-1", time.Minute); again != nil {
		t.Fatal("job em backoff nao deveria ser reivindicado")
	}

	// backoff(300ms, 1) soma ate 75ms de jitter: espere alem do pior caso.
	time.Sleep(450 * time.Millisecond)

	again, err := q.Claim(ctx, "worker-1", time.Minute)
	if err != nil {
		t.Fatalf("claim depois do backoff: %v", err)
	}
	if again == nil {
		t.Fatal("job em retrying nao foi reivindicado de novo")
	}
	if again.ID != id || again.Attempts != 1 {
		t.Fatalf("job = %+v, want id %s com 1 tentativa", again, id)
	}
}

func TestRequeueExpiredLease(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	if _, err := q.Enqueue(ctx, jobs.TypeTranscribe, "k2", jobs.TranscribePayload{EntryID: "en2"}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	job, err := q.Claim(ctx, "worker-1", time.Millisecond)
	if err != nil || job == nil {
		t.Fatalf("claim: %v %v", job, err)
	}
	time.Sleep(10 * time.Millisecond)
	if err := q.RequeueExpired(ctx); err != nil {
		t.Fatalf("requeue: %v", err)
	}
	queued, _ := q.CountByStatus(ctx, jobs.StatusQueued)
	if queued != 1 {
		t.Fatalf("queued = %d, want 1 apos requeue", queued)
	}
}

type testError struct{}

func (testError) Error() string { return "falha de teste" }

var errTest = testError{}

func TestCancelEntry(t *testing.T) {
	q := newQueue(t)
	ctx := context.Background()
	// As chaves reais: a transcricao usa o id do audio, a analise leva o modelo.
	if _, err := q.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:att-9", jobs.TranscribePayload{EntryID: "en1", AttachmentID: "att-9"}); err != nil {
		t.Fatalf("enqueue transcribe: %v", err)
	}
	if _, err := q.Enqueue(ctx, jobs.TypeAnalyze, "analyze:en1:modelo", jobs.AnalyzePayload{EntryID: "en1"}); err != nil {
		t.Fatalf("enqueue analyze: %v", err)
	}
	ids, err := q.CancelEntry(ctx, "en1")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("cancelou %d jobs, esperava 2", len(ids))
	}
	dead, _ := q.CountByStatus(ctx, jobs.StatusDead)
	if dead != 2 {
		t.Fatalf("dead = %d, esperava 2", dead)
	}
	queued, _ := q.CountByStatus(ctx, jobs.StatusQueued)
	if queued != 0 {
		t.Fatalf("queued = %d, esperava 0", queued)
	}
}

// A analise automatica e o clique manual precisam usar a mesma chave: uma
// chave diferente abria duas passadas concorrentes na mesma nota.
func TestAnalyzeKeyIsTheSameForAutomaticAndManualRuns(t *testing.T) {
	if got := jobs.AnalyzeKey("en1"); got != "analyze:en1" {
		t.Fatalf("AnalyzeKey = %q", got)
	}
}
