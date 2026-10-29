package jobs

import (
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"time"
)

// WorkerKindBrowser identifies a worker running inside the dashboard. The
// server worker never registers here: it exists for as long as the process.
const WorkerKindBrowser = "browser"

// WorkerTTL is how long a browser worker is considered present after its last
// heartbeat. The dashboard beats every 20 s, so a closed tab frees the queue in
// under a minute and the server runner resumes on its own.
const WorkerTTL = 60 * time.Second

// WorkerInfo is the presence of one optional browser worker.
type WorkerInfo struct {
	ID           string          `json:"id"`
	Kind         string          `json:"kind"`
	Tier         int             `json:"tier"`
	PreferClient bool            `json:"prefer_client"`
	Models       []string        `json:"models"`
	CurrentJob   string          `json:"current_job"`
	Caps         json.RawMessage `json:"caps,omitempty"`
	LastSeen     time.Time       `json:"last_seen"`
}

func (w WorkerInfo) active(now time.Time, ttl time.Duration) bool {
	return now.Sub(w.LastSeen) < ttl
}

// Presence tracks the optional browser workers in memory. Presence is
// ephemeral by design: a restart of the server forgets the dashboards, they
// re-register on the next heartbeat, and no durable row can keep a dead tab
// holding the queue.
type Presence struct {
	mu      sync.Mutex
	ttl     time.Duration
	workers map[string]WorkerInfo
	now     func() time.Time
}

// NewPresence builds an empty registry.
func NewPresence(ttl time.Duration) *Presence {
	if ttl <= 0 {
		ttl = WorkerTTL
	}
	return &Presence{ttl: ttl, workers: map[string]WorkerInfo{}, now: time.Now}
}

// Register inserts or refreshes a worker. The id is the only identity: a tab
// that reloads keeps the same id and does not become a second worker.
func (p *Presence) Register(info WorkerInfo) WorkerInfo {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now().UTC()
	info.ID = strings.TrimSpace(info.ID)
	info.Kind = strings.TrimSpace(info.Kind)
	if info.Kind == "" {
		info.Kind = WorkerKindBrowser
	}
	if info.Models == nil {
		info.Models = []string{}
	}
	info.LastSeen = now
	if previous, ok := p.workers[info.ID]; ok && info.CurrentJob == "" {
		info.CurrentJob = previous.CurrentJob
	}
	p.workers[info.ID] = info
	return info
}

// Touch renews a worker's presence and returns the stored record. It reports
// false when the worker was never registered (the dashboard must register
// again before claiming anything).
func (p *Presence) Touch(id string) (WorkerInfo, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	info, ok := p.workers[id]
	if !ok {
		return WorkerInfo{}, false
	}
	info.LastSeen = p.now().UTC()
	p.workers[id] = info
	return info, true
}

// SetJob records the job the worker is running. An empty id clears it.
func (p *Presence) SetJob(id, jobID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	info, ok := p.workers[id]
	if !ok {
		return
	}
	info.CurrentJob = jobID
	info.LastSeen = p.now().UTC()
	p.workers[id] = info
}

// Unregister removes a worker immediately.
func (p *Presence) Unregister(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.workers, id)
}

// Take removes a worker and returns its last record, so the caller can hand
// back the job it was running.
func (p *Presence) Take(id string) (WorkerInfo, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	info, ok := p.workers[id]
	delete(p.workers, id)
	return info, ok
}

// List returns the active workers, oldest heartbeat last. Expired records are
// dropped on the way.
func (p *Presence) List() []WorkerInfo {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now().UTC()
	out := make([]WorkerInfo, 0, len(p.workers))
	for id, info := range p.workers {
		if !info.active(now, p.ttl) {
			delete(p.workers, id)
			continue
		}
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeen.After(out[j].LastSeen) })
	return out
}

// Preferred reports whether at least one browser worker is present and asked to
// process the queue. While it is true the server runner leaves transcribe and
// analyze alone; cleanup stays with the server.
func (p *Presence) Preferred() bool {
	for _, info := range p.List() {
		if info.Kind == WorkerKindBrowser && info.PreferClient {
			return true
		}
	}
	return false
}

// Any reports whether any worker is present, preferred or not.
func (p *Presence) Any() bool {
	return len(p.List()) > 0
}
