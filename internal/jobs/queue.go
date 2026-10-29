// Package jobs implements the durable job queue with leases, heartbeat,
// retries with backoff and idempotency.
package jobs

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
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
	LeaseExpiresAt *time.Time
	WorkerID       string
	LastError      string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Queue persists jobs in SQLite.
type Queue struct {
	db *sql.DB
}

// NewQueue builds a Queue over the given database handle.
func NewQueue(db *sql.DB) *Queue { return &Queue{db: db} }

// AnalyzeKey is the idempotency key of an entry analysis. The automatic run
// after transcription and the manual "Analisar" click use the same key, so a
// click during the automatic pass cannot start a second analysis on the note.
func AnalyzeKey(entryID string) string {
	return "analyze:" + entryID
}

// Enqueue inserts a job available immediately. If a job with the same
// idempotency key already exists, it is left untouched and its id is returned.
func (q *Queue) Enqueue(ctx context.Context, jobType, idempotencyKey string, payload any) (string, error) {
	return q.EnqueueAfter(ctx, jobType, idempotencyKey, payload, 0)
}

// EnqueueAfter schedules a job to become available after `delay`. It differs
// from Enqueue in one point: when a job with the same key already exists, its
// availability is moved to the new time (the delay is part of the request), so
// a repeated call postpones the work instead of running it right away. A job
// that is already running or leased is never touched.
func (q *Queue) EnqueueAfter(ctx context.Context, jobType, idempotencyKey string, payload any, delay time.Duration) (string, error) {
	var raw []byte
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return "", fmt.Errorf("jobs: marshal payload: %w", err)
		}
		raw = b
	}
	if delay < 0 {
		delay = 0
	}
	now := time.Now().UTC()
	availableAt := ts(now.Add(delay))

	var existing string
	var existingStatus string
	err := q.db.QueryRowContext(ctx,
		`SELECT id, status FROM jobs WHERE idempotency_key = ?`, idempotencyKey).Scan(&existing, &existingStatus)
	if err == nil {
		// If the job is not currently running, (re)queue it so a manual trigger
		// takes effect immediately, even after a failure/backoff.
		if existingStatus != string(StatusRunning) && existingStatus != string(StatusLeased) {
			if _, uerr := q.db.ExecContext(ctx, `
				UPDATE jobs SET status = ?, attempts = 0, available_at = ?, last_error = '',
					worker_id = '', lease_expires_at = NULL, updated_at = ?
				WHERE id = ?`, string(StatusQueued), availableAt, ts(now), existing); uerr != nil {
				return "", fmt.Errorf("jobs: requeue: %w", uerr)
			}
		}
		return existing, nil
	}
	if err != sql.ErrNoRows {
		return "", fmt.Errorf("jobs: lookup: %w", err)
	}

	jobID := id.New()
	_, err = q.db.ExecContext(ctx, `
		INSERT INTO jobs (id, type, idempotency_key, payload, status, attempts, max_attempts,
			available_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
		jobID, jobType, idempotencyKey, raw, string(StatusQueued), 5,
		availableAt, ts(now), ts(now))
	if err != nil {
		return "", fmt.Errorf("jobs: insert: %w", err)
	}
	return jobID, nil
}

// Claim reserves the next available job for the worker, renewing expired leases
// first. It returns (nil, nil) when there is no work.
func (q *Queue) Claim(ctx context.Context, workerID string, lease time.Duration) (*Job, error) {
	return q.ClaimTypes(ctx, workerID, lease, nil)
}

// ClaimTypes is Claim restricted to the given job types. An empty list means
// every type, which is what the server runner uses. The browser worker passes
// only transcribe and analyze: cleanup is server work and must never leave the
// machine that owns the disk.
func (q *Queue) ClaimTypes(ctx context.Context, workerID string, lease time.Duration, types []string) (*Job, error) {
	return q.ClaimFor(ctx, workerID, lease, types, "")
}

// ClaimFor is ClaimTypes with a preferred entry: when the user asks to analyze
// one note on the PC, the worker picks that job before older queue work. The
// preference is only an ordering hint; the lease still guarantees exclusivity.
func (q *Queue) ClaimFor(ctx context.Context, workerID string, lease time.Duration, types []string, preferredEntryID string) (*Job, error) {
	return q.claimFor(ctx, workerID, lease, types, preferredEntryID, false)
}

// ClaimEntry claims only the job of one entry. The browser worker uses it so a
// local request never turns into automatic queue consumption: the worker sees
// the note the user asked for, or nothing at all.
func (q *Queue) ClaimEntry(ctx context.Context, workerID string, lease time.Duration, types []string, entryID string) (*Job, error) {
	if entryID == "" {
		return nil, nil
	}
	return q.claimFor(ctx, workerID, lease, types, entryID, true)
}

func (q *Queue) claimFor(ctx context.Context, workerID string, lease time.Duration, types []string, entryID string, exact bool) (*Job, error) {
	if err := q.RequeueExpired(ctx); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	var j Job
	var payload sql.NullString
	var availableAt, createdAt, updatedAt string
	var leaseExpires sql.NullString
	query := `
		SELECT id, type, idempotency_key, payload, status, attempts, max_attempts,
			available_at, lease_expires_at, COALESCE(worker_id,''), COALESCE(last_error,''),
			created_at, updated_at
		FROM jobs
		WHERE status IN (?, ?) AND available_at <= ?`
	args := []any{string(StatusQueued), string(StatusRetrying), ts(now)}
	if len(types) > 0 {
		placeholders := make([]string, len(types))
		for i, jobType := range types {
			placeholders[i] = "?"
			args = append(args, jobType)
		}
		query += " AND type IN (" + strings.Join(placeholders, ", ") + ")"
	}
	if exact {
		query += " AND json_extract(payload, '$.entry_id') = ? ORDER BY available_at ASC LIMIT 1"
		args = append(args, entryID)
	} else if entryID != "" {
		query += " ORDER BY CASE WHEN json_extract(payload, '$.entry_id') = ? THEN 0 ELSE 1 END, available_at ASC LIMIT 1"
		args = append(args, entryID)
	} else {
		query += " ORDER BY available_at ASC LIMIT 1"
	}
	err := q.db.QueryRowContext(ctx, query, args...).Scan(
		&j.ID, &j.Type, &j.IdempotencyKey, &payload, &j.Status, &j.Attempts, &j.MaxAttempts,
		&availableAt, &leaseExpires, &j.WorkerID, &j.LastError, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("jobs: claim select: %w", err)
	}

	expires := now.Add(lease)
	res, err := q.db.ExecContext(ctx, `
		UPDATE jobs SET status = ?, worker_id = ?, lease_expires_at = ?, updated_at = ?
		WHERE id = ? AND status IN (?, ?)`,
		string(StatusRunning), workerID, ts(expires), ts(now), j.ID,
		string(StatusQueued), string(StatusRetrying))
	if err != nil {
		return nil, fmt.Errorf("jobs: claim update: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, nil // lost the race
	}

	j.Status = StatusRunning
	j.WorkerID = workerID
	j.AvailableAt = parseTS(availableAt)
	j.CreatedAt = parseTS(createdAt)
	j.UpdatedAt = parseTS(updatedAt)
	j.LeaseExpiresAt = &expires
	if payload.Valid {
		j.Payload = []byte(payload.String)
	}
	return &j, nil
}

// Get returns a job by id.
func (q *Queue) Get(ctx context.Context, jobID string) (*Job, error) {
	var j Job
	var payload sql.NullString
	var availableAt, createdAt, updatedAt string
	var leaseExpires sql.NullString
	err := q.db.QueryRowContext(ctx, `
		SELECT id, type, idempotency_key, payload, status, attempts, max_attempts,
			available_at, lease_expires_at, COALESCE(worker_id,''), COALESCE(last_error,''),
			created_at, updated_at
		FROM jobs WHERE id = ?`, jobID).Scan(
		&j.ID, &j.Type, &j.IdempotencyKey, &payload, &j.Status, &j.Attempts, &j.MaxAttempts,
		&availableAt, &leaseExpires, &j.WorkerID, &j.LastError, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("jobs: get: %w", err)
	}
	j.AvailableAt = parseTS(availableAt)
	j.CreatedAt = parseTS(createdAt)
	j.UpdatedAt = parseTS(updatedAt)
	if leaseExpires.Valid {
		t := parseTS(leaseExpires.String)
		j.LeaseExpiresAt = &t
	}
	if payload.Valid {
		j.Payload = []byte(payload.String)
	}
	return &j, nil
}

// Heartbeat renews the lease of a running job. It reports false when the job is
// no longer leased to this worker: the worker must stop and discard the result,
// because another worker may already be redoing it.
func (q *Queue) HeartbeatOwned(ctx context.Context, jobID, workerID string, lease time.Duration) (bool, error) {
	expires := time.Now().UTC().Add(lease)
	res, err := q.db.ExecContext(ctx, `
		UPDATE jobs SET lease_expires_at = ?, updated_at = ?
		WHERE id = ? AND worker_id = ? AND status = ?`,
		ts(expires), ts(time.Now()), jobID, workerID, string(StatusRunning))
	if err != nil {
		return false, fmt.Errorf("jobs: heartbeat: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// Heartbeat renews the lease of a running job.
func (q *Queue) Heartbeat(ctx context.Context, jobID, workerID string, lease time.Duration) error {
	_, err := q.HeartbeatOwned(ctx, jobID, workerID, lease)
	return err
}

// CompleteOwned marks a job done only when the caller still owns the lease.
func (q *Queue) CompleteOwned(ctx context.Context, jobID, workerID string) (bool, error) {
	res, err := q.db.ExecContext(ctx, `
		UPDATE jobs SET status = ?, lease_expires_at = NULL, updated_at = ?
		WHERE id = ? AND worker_id = ? AND status = ?`,
		string(StatusDone), ts(time.Now()), jobID, workerID, string(StatusRunning))
	if err != nil {
		return false, fmt.Errorf("jobs: complete: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// FailOwned records a failed attempt only when the caller still owns the lease.
// cause must not carry note content or secrets: it is stored in the job row.
func (q *Queue) FailOwned(ctx context.Context, jobID, workerID string, cause error, baseDelay time.Duration) (bool, error) {
	owned, err := q.ownedBy(ctx, jobID, workerID)
	if err != nil || !owned {
		return false, err
	}
	if err := q.Fail(ctx, jobID, cause, baseDelay); err != nil {
		return false, err
	}
	return true, nil
}

func (q *Queue) ownedBy(ctx context.Context, jobID, workerID string) (bool, error) {
	var n int
	err := q.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM jobs WHERE id = ? AND worker_id = ? AND status = ?`,
		jobID, workerID, string(StatusRunning)).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("jobs: check owner: %w", err)
	}
	return n > 0, nil
}

// Complete marks a job as done.
func (q *Queue) Complete(ctx context.Context, jobID string) error {
	_, err := q.db.ExecContext(ctx,
		`UPDATE jobs SET status = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
		string(StatusDone), ts(time.Now()), jobID)
	if err != nil {
		return fmt.Errorf("jobs: complete: %w", err)
	}
	return nil
}

// ReleaseOwned hands a running job back to the queue immediately, without
// counting an attempt. The browser uses it when the user decides the note
// should be processed on the server instead of waiting in a slow tab.
func (q *Queue) ReleaseOwned(ctx context.Context, jobID, workerID string) (bool, error) {
	now := time.Now().UTC()
	res, err := q.db.ExecContext(ctx, `
		UPDATE jobs SET status = ?, worker_id = '', lease_expires_at = NULL,
			available_at = ?, updated_at = ?
		WHERE id = ? AND worker_id = ? AND status = ?`,
		string(StatusQueued), ts(now), ts(now), jobID, workerID, string(StatusRunning))
	if err != nil {
		return false, fmt.Errorf("jobs: release: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// Fail records a failed attempt. It reschedules the job with exponential backoff
// until max attempts are exhausted, then marks it dead.
func (q *Queue) Fail(ctx context.Context, jobID string, cause error, baseDelay time.Duration) error {
	var attempts, max int
	err := q.db.QueryRowContext(ctx, `SELECT attempts, max_attempts FROM jobs WHERE id = ?`, jobID).
		Scan(&attempts, &max)
	if err != nil {
		return fmt.Errorf("jobs: fail select: %w", err)
	}
	attempts++
	now := time.Now().UTC()
	status := StatusRetrying
	var available = now.Add(backoff(baseDelay, attempts))
	if attempts >= max {
		status = StatusDead
		available = now
	}
	var causeMsg any
	if cause != nil {
		causeMsg = cause.Error()
	}
	_, err = q.db.ExecContext(ctx, `
		UPDATE jobs SET status = ?, attempts = ?, available_at = ?, last_error = ?,
			lease_expires_at = NULL, worker_id = '', updated_at = ?
		WHERE id = ?`,
		string(status), attempts, ts(available), causeMsg, ts(now), jobID)
	if err != nil {
		return fmt.Errorf("jobs: fail update: %w", err)
	}
	return nil
}

// ExpireStaleRetries marks retries that have been waiting longer than maxAge as
// dead. Before the claim fix, a job that failed once stayed "retrying" forever;
// replaying every old failure right after an update would flood the worker (and
// any paid provider). Recent retries are left alone.
func (q *Queue) ExpireStaleRetries(ctx context.Context, maxAge time.Duration) (int, error) {
	cutoff := time.Now().UTC().Add(-maxAge)
	res, err := q.db.ExecContext(ctx, `
		UPDATE jobs SET status = ?, updated_at = ?,
			last_error = CASE WHEN COALESCE(last_error,'') = '' THEN 'retry expirado'
				ELSE last_error || ' (retry expirado)' END
		WHERE status = ? AND updated_at < ?`,
		string(StatusDead), ts(time.Now().UTC()), string(StatusRetrying), ts(cutoff))
	if err != nil {
		return 0, fmt.Errorf("jobs: expire stale retries: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// RequeueExpired returns jobs whose lease expired to the queue.
func (q *Queue) RequeueExpired(ctx context.Context) error {
	now := time.Now().UTC()
	_, err := q.db.ExecContext(ctx, `
		UPDATE jobs SET status = ?, worker_id = '', lease_expires_at = NULL, updated_at = ?
		WHERE status = ? AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
		string(StatusQueued), ts(now), string(StatusRunning), ts(now))
	if err != nil {
		return fmt.Errorf("jobs: requeue expired: %w", err)
	}
	return nil
}

// CountByStatus returns how many jobs are in the given status.
func (q *Queue) CountByStatus(ctx context.Context, status Status) (int, error) {
	var n int
	err := q.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM jobs WHERE status = ?`, string(status)).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("jobs: count: %w", err)
	}
	return n, nil
}

// CancelEntry marks the active jobs of an entry as cancelled and returns their
// ids so their running contexts can be cancelled.
func (q *Queue) CancelEntry(ctx context.Context, entryID string) ([]string, error) {
	// O payload diz a qual entrada o job pertence. As chaves de idempotencia
	// nao servem: a transcricao usa o id do audio e a analise leva o modelo no
	// fim, entao procurar por "transcribe:{entry}" nunca casava.
	rows, err := q.db.QueryContext(ctx, `
		SELECT id FROM jobs
		WHERE status IN (?, ?, ?, ?)
		  AND (json_extract(payload, '$.entry_id') = ?
		       OR idempotency_key IN (?, ?))`,
		string(StatusQueued), string(StatusLeased), string(StatusRunning), string(StatusRetrying),
		entryID, "transcribe:"+entryID, "analyze:"+entryID)
	if err != nil {
		return nil, fmt.Errorf("jobs: cancel select: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	now := ts(time.Now())
	for _, id := range ids {
		if _, err := q.db.ExecContext(ctx, `
			UPDATE jobs SET status = ?, last_error = ?, worker_id = '', lease_expires_at = NULL, updated_at = ?
			WHERE id = ?`, string(StatusDead), "cancelado", now, id); err != nil {
			return ids, fmt.Errorf("jobs: cancel update: %w", err)
		}
	}
	return ids, nil
}

func backoff(base time.Duration, attempt int) time.Duration {
	if base <= 0 {
		base = 2 * time.Second
	}
	d := base
	for i := 1; i < attempt && d < 5*time.Minute; i++ {
		d *= 2
	}
	if d > 5*time.Minute {
		d = 5 * time.Minute
	}
	jitter := time.Duration(rand.Int63n(int64(d/4) + 1))
	return d + jitter
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func parseTS(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
