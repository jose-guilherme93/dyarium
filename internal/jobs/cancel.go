package jobs

import (
	"context"
	"sync"
)

// Canceller tracks the cancel function of running jobs so the API can stop a
// transcription or analysis in progress.
type Canceller struct {
	mu    sync.Mutex
	funcs map[string]context.CancelFunc
}

// NewCanceller builds an empty Canceller.
func NewCanceller() *Canceller {
	return &Canceller{funcs: map[string]context.CancelFunc{}}
}

// Register associates a cancel function with a job id.
func (c *Canceller) Register(jobID string, cancel context.CancelFunc) {
	c.mu.Lock()
	c.funcs[jobID] = cancel
	c.mu.Unlock()
}

// Unregister removes a job id.
func (c *Canceller) Unregister(jobID string) {
	c.mu.Lock()
	delete(c.funcs, jobID)
	c.mu.Unlock()
}

// Cancel stops a running job; it reports whether the job was running.
func (c *Canceller) Cancel(jobID string) bool {
	c.mu.Lock()
	cancel, ok := c.funcs[jobID]
	c.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}
