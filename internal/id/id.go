// Package id generates opaque identifiers for entities.
package id

import (
	"crypto/rand"
	"encoding/hex"
)

// New returns a random 128-bit identifier as a 32-character hex string.
func New() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("id: entropy source failed: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// Valid reports whether s is a safe identifier supplied by a client. Clients
// that work offline generate their own time-ordered ids (ULIDs), so the server
// accepts them when they look safe. Deliberately narrow: letters, digits, "_"
// and "-", up to 64 characters.
func Valid(s string) bool {
	if len(s) == 0 || len(s) > 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z',
			c >= 'A' && c <= 'Z',
			c >= '0' && c <= '9',
			c == '_',
			c == '-':
		default:
			return false
		}
	}
	return true
}
