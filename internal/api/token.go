package api

import "sync"

// TokenSource holds the current bearer token. It starts in setup mode when the
// instance has not been claimed yet; Claim switches it to the operator-chosen
// token without a restart.
type TokenSource struct {
	mu      sync.RWMutex
	token   string
	pending bool
}

// NewTokenSource builds a TokenSource. pending is true while the operator has
// not completed the first-run setup.
func NewTokenSource(token string, pending bool) *TokenSource {
	return &TokenSource{token: token, pending: pending}
}

// Get returns the token currently in use.
func (t *TokenSource) Get() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.token
}

// SetupPending reports whether the first-run setup is still open.
func (t *TokenSource) SetupPending() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.pending
}

// Claim replaces the token and closes the setup window.
func (t *TokenSource) Claim(token string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.token = token
	t.pending = false
}
