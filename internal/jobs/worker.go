package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// Handler runs a job. heartbeat renews the lease and should be checked for
// long-running work.
type Handler func(ctx context.Context, job *Job, heartbeat func() error) error

// TranscribePayload is the payload of a transcribe job.
type TranscribePayload struct {
	EntryID string `json:"entry_id"`
}

// AnalyzePayload is the payload of an analyze job.
type AnalyzePayload struct {
	EntryID string `json:"entry_id"`
}

// Runner claims and executes jobs for a single worker.
type Runner struct {
	queue     *Queue
	workerID  string
	lease     time.Duration
	baseDelay time.Duration
	logger    *slog.Logger
	handlers  map[string]Handler
	poll      time.Duration
}

// NewRunner builds a Runner.
func NewRunner(q *Queue, workerID string, lease, baseDelay time.Duration, logger *slog.Logger) *Runner {
	return &Runner{
		queue:     q,
		workerID:  workerID,
		lease:     lease,
		baseDelay: baseDelay,
		logger:    logger,
		handlers:  map[string]Handler{},
		poll:      500 * time.Millisecond,
	}
}

// Register associates a handler with a job type.
func (r *Runner) Register(jobType string, h Handler) { r.handlers[jobType] = h }

// Run loops until the context is cancelled, claiming and executing jobs.
func (r *Runner) Run(ctx context.Context) {
	ticker := time.NewTicker(r.poll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			job, err := r.queue.Claim(ctx, r.workerID, r.lease)
			if err != nil {
				r.logger.Error("fila: falha ao reservar job", "erro", err)
				continue
			}
			if job == nil {
				continue
			}
			r.execute(ctx, job)
		}
	}
}

func (r *Runner) execute(ctx context.Context, job *Job) {
	handler, ok := r.handlers[job.Type]
	if !ok {
		r.logger.Error("fila: sem handler para o tipo", "tipo", job.Type, "id", job.ID)
		_ = r.queue.Fail(ctx, job.ID, fmt.Errorf("sem handler para %q", job.Type), r.baseDelay)
		return
	}

	jobCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	hbErr := make(chan error, 1)
	go func() {
		t := time.NewTicker(r.lease / 3)
		defer t.Stop()
		for {
			select {
			case <-jobCtx.Done():
				return
			case <-t.C:
				if err := r.queue.Heartbeat(ctx, job.ID, r.workerID, r.lease); err != nil {
					hbErr <- err
					return
				}
			}
		}
	}()

	heartbeat := func() error {
		select {
		case err := <-hbErr:
			return err
		default:
			return nil
		}
	}

	if err := handler(jobCtx, job, heartbeat); err != nil {
		r.logger.Error("fila: job falhou", "id", job.ID, "tipo", job.Type, "erro", err)
		if ferr := r.queue.Fail(ctx, job.ID, err, r.baseDelay); ferr != nil {
			r.logger.Error("fila: falha ao registrar erro", "id", job.ID, "erro", ferr)
		}
		return
	}
	if err := r.queue.Complete(ctx, job.ID); err != nil {
		r.logger.Error("fila: falha ao concluir", "id", job.ID, "erro", err)
	}
}

// DecodePayload unmarshals a job payload, failing on invalid JSON.
func DecodePayload(job *Job, out any) error {
	if len(job.Payload) == 0 {
		return fmt.Errorf("payload vazio")
	}
	return json.Unmarshal(job.Payload, out)
}
