// Package jobs implements the durable job queue with leases, heartbeat,
// retries with backoff and idempotency. Only the queue primitive is implemented
// in this phase; the worker loop is completed in a later phase.
package jobs

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/joseti/dyarium/internal/id"
)

// Status enumerates job states.
type Status string

// Job states.
const (
	StatusQueued   Status = "queued"
	StatusLeased   Status = "leased"
	StatusRunning  Status = "running"
	StatusDone     Status = "done"
	StatusFailed   Status = "failed"
	StatusRetrying Status = "retrying"
	StatusDead     Status = "dead"
)

// Job types.
const (
	TypeTranscribe = "transcribe"
	TypeAnalyze    = "analyze"
	TypeCleanup    = "cleanup"
)

// Job is a unit of background work.
type Job struct {
	ID             string
	Type           string
	IdempotencyKey string
	Payload        []byte
	Status         Status
	Attempts       int
	MaxAttempts    int
	AvailableAt    time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Queue persists jobs in SQLite.
type Queue struct {
	db *sql.DB
}

// NewQueue builds a Queue over the given database handle.
func NewQueue(db *sql.DB) *Queue { return &Queue{db: db} }

// Enqueue inserts a job. If a job with the same idempotency key already exists,
// it is left untouched and its id is returned.
func (q *Queue) Enqueue(ctx context.Context, jobType, idempotencyKey string, payload any) (string, error) {
	var raw []byte
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return "", fmt.Errorf("jobs: marshal payload: %w", err)
		}
		raw = b
	}
	var existing string
	err := q.db.QueryRowContext(ctx,
		`SELECT id FROM jobs WHERE idempotency_key = ?`, idempotencyKey).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if err != sql.ErrNoRows {
		return "", fmt.Errorf("jobs: lookup: %w", err)
	}

	now := time.Now().UTC()
	jobID := id.New()
	_, err = q.db.ExecContext(ctx, `
		INSERT INTO jobs (id, type, idempotency_key, payload, status, attempts, max_attempts,
			available_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
		jobID, jobType, idempotencyKey, raw, string(StatusQueued), 5,
		now.Format(time.RFC3339), now.Format(time.RFC3339), now.Format(time.RFC3339))
	if err != nil {
		return "", fmt.Errorf("jobs: insert: %w", err)
	}
	return jobID, nil
}

// CountByStatus returns how many jobs are in the given status. It exists mainly
// for observability and tests.
func (q *Queue) CountByStatus(ctx context.Context, status Status) (int, error) {
	var n int
	err := q.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM jobs WHERE status = ?`, string(status)).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("jobs: count: %w", err)
	}
	return n, nil
}
