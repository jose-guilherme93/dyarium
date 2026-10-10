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
