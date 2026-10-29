package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/joseti/dyarium/internal/jobs"
	"github.com/joseti/dyarium/internal/store"
)

// workerLease is how long a browser worker owns a claimed job. The dashboard
// renews it every 20 s; a closed tab loses the job in at most this long.
// workerLease is how long a browser worker owns a job. The dashboard renews it
// every 20 s; a closed tab loses the job in about two minutes instead of
// stalling the queue for the whole transcription of a long note.
const workerLease = 120 * time.Second

// maxWorkerIDLen bounds the identifier stored in memory and echoed back.
const maxWorkerIDLen = 80

// validWorkerID accepts the identifier the dashboard generates locally. It must
// be stable across reloads of the same tab, so it is never derived from the
// note or from the token.
func validWorkerID(value string) bool {
	if value == "" || len(value) > maxWorkerIDLen {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_', r == '.', r == ':':
		default:
			return false
		}
	}
	return true
}

// workerKinds are the only job types a browser worker may claim. Cleanup
// deletes encrypted files and must run where the disk lives.
var workerKinds = map[string]bool{jobs.TypeTranscribe: true, jobs.TypeAnalyze: true}

type workerRegisterRequest struct {
	WorkerID     string          `json:"worker_id"`
	Kind         string          `json:"kind"`
	Tier         int             `json:"tier"`
	PreferClient bool            `json:"prefer_client"`
	Models       []string        `json:"models"`
	Caps         json.RawMessage `json:"caps"`
}

func (s *Server) handleWorkerRegister(w http.ResponseWriter, r *http.Request) {
	var req workerRegisterRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if !validWorkerID(req.WorkerID) {
		writeError(w, http.StatusBadRequest, "invalid_worker", "worker_id invalido")
		return
	}
	if req.Tier < 0 {
		req.Tier = 0
	}
	if len(req.Caps) > 8<<10 {
		writeError(w, http.StatusBadRequest, "invalid_caps", "caps grande demais")
		return
	}
	info := s.deps.Presence.Register(jobs.WorkerInfo{
		ID:           req.WorkerID,
		Kind:         jobs.WorkerKindBrowser,
		Tier:         req.Tier,
		PreferClient: req.PreferClient,
		Models:       req.Models,
		Caps:         req.Caps,
	})
	if s.deps.Logger != nil {
		s.deps.Logger.Info("worker: navegador registrado", "worker_id", info.ID, "tier", info.Tier, "prefer_client", info.PreferClient)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"worker":      info,
		"ttl_seconds": int(jobs.WorkerTTL / time.Second),
		"server_time": time.Now().UTC(),
	})
}

type workerHeartbeatRequest struct {
	WorkerID string `json:"worker_id"`
	JobID    string `json:"job_id"`
}

func (s *Server) handleWorkerHeartbeat(w http.ResponseWriter, r *http.Request) {
	var req workerHeartbeatRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if _, ok := s.deps.Presence.Touch(req.WorkerID); !ok {
		writeError(w, http.StatusConflict, "worker_unknown", "registre o worker antes")
		return
	}
	if req.JobID == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "lost": false})
		return
	}
	owned, err := s.deps.Queue.HeartbeatOwned(r.Context(), req.JobID, req.WorkerID, workerLease)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "nao foi possivel renovar o lease")
		return
	}
	if !owned {
		s.deps.Presence.SetJob(req.WorkerID, "")
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "lost": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "lost": false})
}

type workerClaimRequest struct {
	WorkerID  string   `json:"worker_id"`
	LeaseSecs int      `json:"lease_seconds"`
	Types     []string `json:"types"`
	// EntryID is an ordering hint: the note the user just asked to process
	// jumps ahead of older queue work.
	EntryID string `json:"entry_id"`
	// OnlyEntry restricts the claim to EntryID. The dashboard uses it when the
	// user clicks Analisar so activating the local mode never starts consuming
	// the queue on its own.
	OnlyEntry bool `json:"only_entry"`
}

type workerJobJSON struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
	Attempts    int             `json:"attempts"`
	MaxAttempts int             `json:"max_attempts"`
	LeaseSecs   int             `json:"lease_seconds"`
}

func jobJSON(job *jobs.Job, lease time.Duration) workerJobJSON {
	payload := job.Payload
	if len(payload) == 0 {
		payload = json.RawMessage("{}")
	}
	return workerJobJSON{
		ID:          job.ID,
		Type:        job.Type,
		Payload:     payload,
		Attempts:    job.Attempts,
		MaxAttempts: job.MaxAttempts,
		LeaseSecs:   int(lease / time.Second),
	}
}

func (s *Server) handleWorkerClaim(w http.ResponseWriter, r *http.Request) {
	var req workerClaimRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	info, ok := s.deps.Presence.Touch(req.WorkerID)
	if !ok {
		writeError(w, http.StatusConflict, "worker_unknown", "registre o worker antes")
		return
	}
	// A worker that is still downloading models must not stall the queue: it
	// registers with prefer_client false and only starts claiming when ready.
	if !info.PreferClient {
		writeError(w, http.StatusConflict, "worker_not_ready", "worker ainda nao assumiu a fila")
		return
	}
	lease := workerLease
	if req.LeaseSecs > 0 {
		lease = time.Duration(req.LeaseSecs) * time.Second
		if lease < time.Minute {
			lease = time.Minute
		}
		if lease > 30*time.Minute {
			lease = 30 * time.Minute
		}
	}
	types := make([]string, 0, len(req.Types))
	for _, jobType := range req.Types {
		if workerKinds[jobType] {
			types = append(types, jobType)
		}
	}
	if len(types) == 0 {
		types = []string{jobs.TypeTranscribe, jobs.TypeAnalyze}
	}
	if req.OnlyEntry && req.EntryID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "only_entry exige entry_id")
		return
	}
	var job *jobs.Job
	var err error
	if req.OnlyEntry && req.EntryID != "" {
		job, err = s.deps.Queue.ClaimEntry(r.Context(), req.WorkerID, lease, types, req.EntryID)
	} else {
		job, err = s.deps.Queue.ClaimFor(r.Context(), req.WorkerID, lease, types, req.EntryID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "nao foi possivel reservar um job")
		return
	}
	if job == nil {
		s.deps.Presence.SetJob(req.WorkerID, "")
		writeJSON(w, http.StatusOK, map[string]any{"job": nil})
		return
	}
	s.deps.Presence.SetJob(req.WorkerID, job.ID)
	s.markClaimedEntry(r, job)
	writeJSON(w, http.StatusOK, map[string]any{"job": jobJSON(job, lease)})
}

// markClaimedEntry publishes the same "in progress" state the server handler
// would, so the note list shows the work running on the PC instead of sitting
// in "na fila" until the upload arrives.
func (s *Server) markClaimedEntry(r *http.Request, job *jobs.Job) {
	ctx := r.Context()
	var entryID, status string
	switch job.Type {
	case jobs.TypeTranscribe:
		var payload jobs.TranscribePayload
		if jobs.DecodePayload(job, &payload) == nil {
			entryID, status = payload.EntryID, store.EntryTranscribing
		}
	case jobs.TypeAnalyze:
		var payload jobs.AnalyzePayload
		if jobs.DecodePayload(job, &payload) == nil {
			entryID, status = payload.EntryID, store.EntryAnalyzing
		}
	}
	if entryID == "" {
		return
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, entryID, status)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": entryID, "status": status})
}

type workerJobRequest struct {
	WorkerID string `json:"worker_id"`
	JobID    string `json:"job_id"`
	Error    string `json:"error"`
}

func (s *Server) handleWorkerComplete(w http.ResponseWriter, r *http.Request) {
	var req workerJobRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if !validWorkerID(req.WorkerID) || req.JobID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "worker_id ou job_id invalido")
		return
	}
	info, _ := s.deps.Presence.Touch(req.WorkerID)
	s.deps.Presence.SetJob(req.WorkerID, "")

	job, err := s.deps.Queue.Get(r.Context(), req.JobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "nao foi possivel ler o job")
		return
	}
	if job == nil || job.WorkerID != req.WorkerID {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "lost": true})
		return
	}
	owned, err := s.deps.Queue.CompleteOwned(r.Context(), req.JobID, req.WorkerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "nao foi possivel concluir o job")
		return
	}
	if !owned {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "lost": true})
		return
	}
	if job.Type == jobs.TypeTranscribe {
		s.afterBrowserTranscription(r.Context(), req.WorkerID, job)
	}
	if job.Type == jobs.TypeAnalyze {
		var payload jobs.AnalyzePayload
		if jobs.DecodePayload(job, &payload) == nil && payload.EntryID != "" {
			_ = s.deps.Store.UpdateEntryStatus(r.Context(), payload.EntryID, store.EntryReady)
			s.deps.Events.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryReady})
		}
	}
	if s.deps.Logger != nil {
		s.deps.Logger.Info("worker: job concluido no navegador", "worker_id", req.WorkerID, "tipo", job.Type, "tier", info.Tier)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "lost": false})
}

// afterBrowserTranscription mirrors what the server transcribe handler does
// after a successful pass: the analysis is queued for the same worker (or for
// the server, once the browser leaves), unless the note owns the stage.
func (s *Server) afterBrowserTranscription(ctx context.Context, workerID string, job *jobs.Job) {
	var payload jobs.TranscribePayload
	if err := jobs.DecodePayload(job, &payload); err != nil || payload.EntryID == "" {
		return
	}
	local, err := s.deps.Store.EntryLocalAnalysis(ctx, payload.EntryID)
	if err != nil {
		// Without knowing who owns the stage, do not queue work: the server
		// runner will pick it up when the browser goes away.
		return
	}
	if local {
		_ = s.deps.Store.UpdateEntryStatus(ctx, payload.EntryID, store.EntryReady)
		s.deps.Events.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryReady})
		return
	}
	if _, err := s.deps.Queue.Enqueue(ctx, jobs.TypeAnalyze, jobs.AnalyzeKey(payload.EntryID), jobs.AnalyzePayload{EntryID: payload.EntryID}); err != nil {
		if s.deps.Logger != nil {
			s.deps.Logger.Error("worker: enfileirar analise", "entry_id", payload.EntryID, "erro", err)
		}
		return
	}
	s.deps.Events.Publish("transcript.ready", map[string]string{"entry_id": payload.EntryID})
	_ = s.deps.Store.UpdateEntryStatus(ctx, payload.EntryID, store.EntryTranscribed)
	s.deps.Events.Publish("entry.status", map[string]string{"entry_id": payload.EntryID, "status": store.EntryTranscribed})
}

func (s *Server) handleWorkerFail(w http.ResponseWriter, r *http.Request) {
	var req workerJobRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if !validWorkerID(req.WorkerID) || req.JobID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "worker_id ou job_id invalido")
		return
	}
	s.deps.Presence.SetJob(req.WorkerID, "")
	job, err := s.deps.Queue.Get(r.Context(), req.JobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "nao foi possivel ler o job")
		return
	}
	if job == nil || job.WorkerID != req.WorkerID {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "lost": true})
		return
	}
	// The message is stored in the job row and shown in diagnostics: keep it
	// short and free of note content. The client already sends a generic code.
	message := strings.TrimSpace(req.Error)
	if len(message) > 300 {
		message = message[:300]
	}
	cause := errors.New(message)
	if message == "" {
		cause = errors.New("falha no navegador")
	}
	owned, err := s.deps.Queue.FailOwned(r.Context(), req.JobID, req.WorkerID, cause, 2*time.Second)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "nao foi possivel registrar a falha")
		return
	}
	if !owned {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "lost": true})
		return
	}
	final := job.Attempts+1 >= job.MaxAttempts
	if final {
		s.markJobEntryFailed(r.Context(), job)
	}
	if s.deps.Logger != nil {
		s.deps.Logger.Warn("worker: job falhou no navegador", "worker_id", req.WorkerID, "tipo", job.Type, "final", final)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "lost": false, "final": final})
}

// markJobEntryFailed marks the entry as failed only when the job has no more
// attempts. Transcribe and analyze share the payload shape.
func (s *Server) markJobEntryFailed(ctx context.Context, job *jobs.Job) {
	var entryID string
	switch job.Type {
	case jobs.TypeTranscribe:
		var payload jobs.TranscribePayload
		if jobs.DecodePayload(job, &payload) == nil {
			entryID = payload.EntryID
		}
	case jobs.TypeAnalyze:
		var payload jobs.AnalyzePayload
		if jobs.DecodePayload(job, &payload) == nil {
			entryID = payload.EntryID
		}
	}
	if entryID == "" {
		return
	}
	_ = s.deps.Store.UpdateEntryStatus(ctx, entryID, store.EntryFailed)
	s.deps.Events.Publish("entry.failed", map[string]string{"entry_id": entryID, "reason": "processamento no navegador falhou"})
}

// handleWorkerRelease hands the running job back to the queue so the server
// runner takes it. No attempt is counted: the user chose to move the note, the
// browser did not fail.
func (s *Server) handleWorkerRelease(w http.ResponseWriter, r *http.Request) {
	var req workerJobRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if !validWorkerID(req.WorkerID) || req.JobID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "worker_id ou job_id invalido")
		return
	}
	if _, ok := s.deps.Presence.Touch(req.WorkerID); !ok {
		writeError(w, http.StatusConflict, "worker_unknown", "registre o worker antes")
		return
	}
	s.deps.Presence.SetJob(req.WorkerID, "")
	owned, err := s.deps.Queue.ReleaseOwned(r.Context(), req.JobID, req.WorkerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "nao foi possivel devolver o job")
		return
	}
	if !owned {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "lost": true})
		return
	}
	if s.deps.Logger != nil {
		s.deps.Logger.Info("worker: job devolvido ao servidor", "worker_id", req.WorkerID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "lost": false})
}

func (s *Server) handleWorkerUnregister(w http.ResponseWriter, r *http.Request) {
	var req workerHeartbeatRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "corpo invalido")
		return
	}
	if req.WorkerID != "" {
		// A tab that closes or reloads gives its job back at once, instead of
		// holding the lease for two minutes while the server waits.
		if info, ok := s.deps.Presence.Take(req.WorkerID); ok && info.CurrentJob != "" {
			if _, err := s.deps.Queue.ReleaseOwned(r.Context(), info.CurrentJob, info.ID); err != nil && s.deps.Logger != nil {
				s.deps.Logger.Error("worker: devolver job ao sair", "worker_id", info.ID, "erro", err)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleWorkerStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	counts := map[string]int{}
	for _, status := range []jobs.Status{jobs.StatusQueued, jobs.StatusRetrying, jobs.StatusRunning, jobs.StatusDead} {
		n, err := s.deps.Queue.CountByStatus(ctx, status)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "nao foi possivel contar a fila")
			return
		}
		counts[string(status)] = n
	}
	workers := s.deps.Presence.List()
	if workers == nil {
		workers = []jobs.WorkerInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"workers":     workers,
		"preferred":   s.deps.Presence.Preferred(),
		"ttl_seconds": int(jobs.WorkerTTL / time.Second),
		"queue":       counts,
	})
}
