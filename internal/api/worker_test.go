package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/joseti/dyarium/internal/jobs"
)

func workerRequest(t *testing.T, srv *Server, method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer token-de-teste")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	var decoded map[string]any
	if rec.Body.Len() > 0 {
		_ = json.Unmarshal(rec.Body.Bytes(), &decoded)
	}
	return rec, decoded
}

func TestWorkerRegisterAndPresence(t *testing.T) {
	srv := newTestServer(t)
	rec, body := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id":     "tab-12345678",
		"kind":          "browser",
		"tier":          3,
		"prefer_client": false,
		"models":        []string{"whisper-small"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("register status = %d: %s", rec.Code, rec.Body.String())
	}
	if body["ttl_seconds"] == nil {
		t.Fatal("register should announce the presence TTL")
	}

	rec, body = workerRequest(t, srv, http.MethodGet, "/api/v1/worker/status", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body["preferred"] != false {
		t.Fatal("a downloading worker cannot pause the server")
	}
	workers, _ := body["workers"].([]any)
	if len(workers) != 1 {
		t.Fatalf("workers = %v, want 1", body["workers"])
	}

	// A worker that has not claimed the queue cannot take jobs.
	rec, _ = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id": "tab-12345678",
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("claim while downloading = %d, want 409", rec.Code)
	}
}

func TestWorkerClaimCompleteAndQueueAnalysis(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	if _, err := srv.deps.Queue.Enqueue(ctx, jobs.TypeTranscribe, "transcribe:entry-1",
		jobs.TranscribePayload{EntryID: "entry-1", AttachmentID: "att-1"}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	// Cleanup must never be offered to a browser.
	if _, err := srv.deps.Queue.Enqueue(ctx, jobs.TypeCleanup, "cleanup:entry-2",
		jobs.CleanupPayload{EntryID: "entry-2"}); err != nil {
		t.Fatalf("enqueue cleanup: %v", err)
	}

	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id":     "tab-12345678",
		"tier":          2,
		"prefer_client": true,
	})

	rec, body := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id":     "tab-12345678",
		"lease_seconds": 120,
		"types":         []string{"transcribe", "analyze"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("claim = %d: %s", rec.Code, rec.Body.String())
	}
	job, _ := body["job"].(map[string]any)
	if job == nil {
		t.Fatalf("claim returned no job: %s", rec.Body.String())
	}
	if job["type"] != jobs.TypeTranscribe {
		t.Fatalf("type = %v, want transcribe", job["type"])
	}
	payload, _ := job["payload"].(map[string]any)
	if payload["entry_id"] != "entry-1" || payload["attachment_id"] != "att-1" {
		t.Fatalf("payload = %v", payload)
	}
	jobID, _ := job["id"].(string)

	rec, body = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/heartbeat", map[string]any{
		"worker_id": "tab-12345678",
		"job_id":    jobID,
	})
	if rec.Code != http.StatusOK || body["lost"] != false {
		t.Fatalf("heartbeat = %d %v", rec.Code, body)
	}

	rec, body = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/complete", map[string]any{
		"worker_id": "tab-12345678",
		"job_id":    jobID,
	})
	if rec.Code != http.StatusOK || body["ok"] != true {
		t.Fatalf("complete = %d %v", rec.Code, body)
	}

	// Completing a transcription queues the analysis for the same worker,
	// without asking the server provider to answer anything.
	next, err := srv.deps.Queue.ClaimTypes(ctx, "probe", 0, []string{jobs.TypeAnalyze})
	if err != nil {
		t.Fatalf("claim analyze: %v", err)
	}
	if next == nil || next.Type != jobs.TypeAnalyze {
		t.Fatalf("analysis not queued after browser transcription: %+v", next)
	}
}

func TestWorkerClaimOnlyEntry(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	if _, err := srv.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-other"),
		jobs.AnalyzePayload{EntryID: "entry-other"}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id":     "tab-12345678",
		"tier":          2,
		"prefer_client": true,
	})

	rec, body := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id":     "tab-12345678",
		"lease_seconds": 120,
		"types":         []string{"transcribe", "analyze"},
		"entry_id":      "entry-wanted",
		"only_entry":    true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("claim = %d: %s", rec.Code, rec.Body.String())
	}
	if body["job"] != nil {
		t.Fatalf("only_entry claimed another note: %s", rec.Body.String())
	}

	// only_entry sem entry_id nao pode virar uma reserva global.
	rec, _ = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id":     "tab-12345678",
		"lease_seconds": 120,
		"types":         []string{"transcribe", "analyze"},
		"only_entry":    true,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("only_entry sem entry_id = %d, want 400", rec.Code)
	}

	// The requested note, once queued, is the one that comes back.
	if _, err := srv.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-wanted"),
		jobs.AnalyzePayload{EntryID: "entry-wanted"}); err != nil {
		t.Fatalf("enqueue wanted: %v", err)
	}
	rec, body = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id":     "tab-12345678",
		"lease_seconds": 120,
		"types":         []string{"transcribe", "analyze"},
		"entry_id":      "entry-wanted",
		"only_entry":    true,
	})
	job, _ := body["job"].(map[string]any)
	if rec.Code != http.StatusOK || job == nil {
		t.Fatalf("claim wanted = %d %s", rec.Code, rec.Body.String())
	}
	payload, _ := job["payload"].(map[string]any)
	if payload["entry_id"] != "entry-wanted" {
		t.Fatalf("entry = %v, want entry-wanted", payload["entry_id"])
	}
}

func TestWorkerCannotCompleteAnotherWorkersJob(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	if _, err := srv.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-1"),
		jobs.AnalyzePayload{EntryID: "entry-1"}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id": "tab-12345678", "prefer_client": true,
	})
	rec, body := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id": "tab-12345678",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("claim = %d", rec.Code)
	}
	job, _ := body["job"].(map[string]any)
	jobID, _ := job["id"].(string)

	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id": "tab-other-99", "prefer_client": true,
	})
	rec, body = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/complete", map[string]any{
		"worker_id": "tab-other-99",
		"job_id":    jobID,
	})
	if rec.Code != http.StatusConflict || body["lost"] != true {
		t.Fatalf("foreign complete = %d %v", rec.Code, body)
	}

	// Cleanup of the second worker does not affect the owner.
	rec, body = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/complete", map[string]any{
		"worker_id": "tab-12345678",
		"job_id":    jobID,
	})
	if rec.Code != http.StatusOK || body["ok"] != true {
		t.Fatalf("owner complete = %d %v", rec.Code, body)
	}
}

func TestWorkerFailMarksDeadJob(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	jobID, err := srv.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-1"),
		jobs.AnalyzePayload{EntryID: "entry-1"})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id": "tab-12345678", "prefer_client": true,
	})
	rec, _ := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id": "tab-12345678",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("claim = %d", rec.Code)
	}
	rec, body := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/fail", map[string]any{
		"worker_id": "tab-12345678",
		"job_id":    jobID,
		"error":     "memoria insuficiente",
	})
	if rec.Code != http.StatusOK || body["ok"] != true {
		t.Fatalf("fail = %d %v", rec.Code, body)
	}
	if body["final"] != false {
		t.Fatal("first failure should retry")
	}
	stored, err := srv.deps.Queue.Get(ctx, jobID)
	if err != nil || stored == nil {
		t.Fatalf("get: %v", err)
	}
	if stored.Attempts != 1 {
		t.Fatalf("attempts = %d, want 1", stored.Attempts)
	}
}

func TestWorkerUnregisterReleasesQueue(t *testing.T) {
	srv := newTestServer(t)
	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id": "tab-12345678", "prefer_client": true,
	})
	rec, _ := workerRequest(t, srv, http.MethodGet, "/api/v1/worker/status", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/unregister", map[string]any{
		"worker_id": "tab-12345678",
	})
	_, body := workerRequest(t, srv, http.MethodGet, "/api/v1/worker/status", nil)
	if body["preferred"] != false {
		t.Fatal("unregister kept the queue paused")
	}
	if workers, _ := body["workers"].([]any); len(workers) != 0 {
		t.Fatalf("workers after unregister = %v", workers)
	}
}

func TestWorkerRejectsInvalidID(t *testing.T) {
	srv := newTestServer(t)
	rec, _ := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id": "id com espaco",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestWorkerReleaseHandsJobBack(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	jobID, err := srv.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-1"),
		jobs.AnalyzePayload{EntryID: "entry-1"})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id": "tab-12345678", "prefer_client": true,
	})
	rec, body := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id": "tab-12345678",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("claim = %d", rec.Code)
	}
	job, _ := body["job"].(map[string]any)
	if job == nil {
		t.Fatalf("claim returned no job: %s", rec.Body.String())
	}

	rec, body = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/release", map[string]any{
		"worker_id": "tab-12345678",
		"job_id":    jobID,
	})
	if rec.Code != http.StatusOK || body["ok"] != true {
		t.Fatalf("release = %d %v", rec.Code, body)
	}

	// O servidor pega o job na hora, sem esperar o lease nem contar tentativa.
	reclaimed, err := srv.deps.Queue.Claim(ctx, "worker-1", time.Minute)
	if err != nil {
		t.Fatalf("claim server: %v", err)
	}
	if reclaimed == nil || reclaimed.ID != jobID {
		t.Fatalf("job nao voltou para a fila: %+v", reclaimed)
	}
	if reclaimed.Attempts != 0 {
		t.Fatalf("attempts = %d, want 0", reclaimed.Attempts)
	}

	rec, body = workerRequest(t, srv, http.MethodPost, "/api/v1/worker/release", map[string]any{
		"worker_id": "tab-12345678",
		"job_id":    jobID,
	})
	if rec.Code != http.StatusConflict || body["lost"] != true {
		t.Fatalf("release perdido = %d %v", rec.Code, body)
	}
}

func TestWorkerUnregisterReleasesRunningJob(t *testing.T) {
	srv := newTestServer(t)
	ctx := context.Background()
	jobID, err := srv.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey("entry-1"),
		jobs.AnalyzePayload{EntryID: "entry-1"})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/register", map[string]any{
		"worker_id": "tab-12345678", "prefer_client": true,
	})
	rec, body := workerRequest(t, srv, http.MethodPost, "/api/v1/worker/claim", map[string]any{
		"worker_id": "tab-12345678",
	})
	job, _ := body["job"].(map[string]any)
	if rec.Code != http.StatusOK || job == nil {
		t.Fatalf("claim = %d %s", rec.Code, rec.Body.String())
	}

	workerRequest(t, srv, http.MethodPost, "/api/v1/worker/unregister", map[string]any{
		"worker_id": "tab-12345678",
	})
	reclaimed, err := srv.deps.Queue.Claim(ctx, "worker-1", time.Minute)
	if err != nil {
		t.Fatalf("claim server: %v", err)
	}
	if reclaimed == nil || reclaimed.ID != jobID {
		t.Fatalf("aba fechada nao devolveu o job: %+v", reclaimed)
	}
}
