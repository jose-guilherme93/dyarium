// Package hlc implements a hybrid logical clock: a version stamp that keeps
// wall-clock readability but never goes backwards, and that can be advanced by
// a stamp received from another environment.
//
// The clock is the ordering rule for concurrent edits. A client that reads a
// stamp at T and edits afterwards gets a stamp greater than T even when its own
// clock is behind, because the edit is stamped after the received value. Two
// edits that never saw each other are ordered by (physical, counter, node): the
// physical part keeps the familiar "latest wins", the counter orders writes in
// the same millisecond and the node breaks the remaining ties, so every
// environment reaches the same decision without a dialog.
package hlc

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Layout is the textual form of a stamp. Fixed width for the physical and
// counter parts makes plain string comparison agree with semantic order, and
// the trailing node keeps two environments from ever producing the same stamp.
const (
	physicalDigits = 15
	counterDigits  = 6
)

// Timestamp is one version stamp.
type Timestamp struct {
	// Physical is the wall clock in Unix milliseconds.
	Physical int64
	// Counter orders stamps produced in the same physical millisecond.
	Counter uint32
	// Node identifies who issued the stamp (an environment or a device).
	Node string
}

// String renders the stamp. It is stable and safe to store or send as an opaque
// version token.
func (t Timestamp) String() string {
	return fmt.Sprintf("%0*d-%0*d-%s", physicalDigits, t.Physical, counterDigits, t.Counter, t.Node)
}

// Parse reads a stamp written by this package. Legacy versions are RFC3339
// timestamps from before the hybrid clock; they parse as a physical stamp with
// counter zero and no node, which keeps old data comparable instead of
// invalidating it.
func Parse(s string) (Timestamp, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Timestamp{}, false
	}
	if parts := strings.SplitN(s, "-", 3); len(parts) == 3 {
		physical, errP := strconv.ParseInt(parts[0], 10, 64)
		counter, errC := strconv.ParseUint(parts[1], 10, 32)
		if errP == nil && errC == nil && len(parts[0]) == physicalDigits && len(parts[1]) == counterDigits {
			return Timestamp{Physical: physical, Counter: uint32(counter), Node: parts[2]}, true
		}
	}
	if at, err := time.Parse(time.RFC3339, s); err == nil {
		return Timestamp{Physical: at.UnixMilli()}, true
	}
	return Timestamp{}, false
}

// Compare orders two stamps. It returns -1 when a is older than b, 1 when it is
// newer and 0 when they are the same stamp.
func Compare(a, b Timestamp) int {
	switch {
	case a.Physical != b.Physical:
		if a.Physical < b.Physical {
			return -1
		}
		return 1
	case a.Counter != b.Counter:
		if a.Counter < b.Counter {
			return -1
		}
		return 1
	case a.Node != b.Node:
		if a.Node < b.Node {
			return -1
		}
		return 1
	}
	return 0
}

// After reports whether a is strictly newer than b. A stamp that fails to parse
// is treated as unknown and never wins, which matches the old version rule.
func After(a, b string) bool {
	left, okLeft := Parse(a)
	right, okRight := Parse(b)
	if !okLeft || !okRight {
		return false
	}
	return Compare(left, right) > 0
}

// Clock issues stamps for one environment. It is safe for concurrent use.
type Clock struct {
	mu   sync.Mutex
	last Timestamp
	node string
	wall func() time.Time
}

// NewClock creates a clock for the given node. An empty node is fine for tests;
// real environments pass the stable instance identity.
func NewClock(node string) *Clock {
	return &Clock{node: node, wall: time.Now}
}

// Now issues the next stamp. The physical part follows the wall clock while it
// moves forward; when it stands still or steps back, the counter advances so the
// stamp is still strictly newer than the previous one.
func (c *Clock) Now() Timestamp {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.wall().UnixMilli()
	if now > c.last.Physical {
		c.last.Physical = now
		c.last.Counter = 0
	} else {
		c.last.Counter++
	}
	c.last.Node = c.node
	return c.last
}

// Observe advances the clock with a stamp received from another environment, so
// the next local write is ordered after what the caller has seen.
func (c *Clock) Observe(t Timestamp) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if Compare(t, c.last) > 0 {
		c.last = Timestamp{Physical: t.Physical, Counter: t.Counter}
	}
}

// ObserveToken is Observe for a token that may be empty, legacy or malformed;
// anything unreadable is ignored.
func (c *Clock) ObserveToken(token string) {
	if t, ok := Parse(token); ok {
		c.Observe(t)
	}
}

// Last returns the last issued or observed stamp.
func (c *Clock) Last() Timestamp {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.last
}

// SetNode changes the identity stamped on new versions. Used once at startup,
// after the environment identity is known.
func (c *Clock) SetNode(node string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.node = strings.TrimSpace(node)
}

// Node is the identity stamped on new versions.
func (c *Clock) Node() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.node
}
