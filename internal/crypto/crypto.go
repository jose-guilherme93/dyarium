// Package crypto provides authenticated encryption at rest using AES-256-GCM.
//
// Files are encrypted as a stream so that a whole audio file never has to be
// buffered in memory. The on-disk format is:
//
//	"DYAx" (4 bytes) | prefix (8 bytes) | record*
//
// Each record is a 4-byte big-endian length followed by the GCM ciphertext
// (including the authentication tag). The 12-byte nonce for a record is the
// 8-byte random prefix concatenated with a 4-byte big-endian record counter.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

const (
	magic     = "DYA1"
	prefixLen = 8
	nonceLen  = 12
	chunkSize = 64 * 1024
)

// ErrInvalidKey is returned when a key is not 32 bytes long.
var ErrInvalidKey = errors.New("crypto: key must be 32 bytes")

// ErrMalformed is returned when the ciphertext stream cannot be parsed.
var ErrMalformed = errors.New("crypto: malformed ciphertext stream")

// ParseKey accepts a 32-byte key encoded as hex (64 chars), base64 (standard
// encoding) or as a raw 32-byte string, and returns the raw key bytes.
func ParseKey(s string) ([]byte, error) {
	if s == "" {
		return nil, ErrInvalidKey
	}
	if len(s) == 64 {
		if b, err := hex.DecodeString(s); err == nil {
			return b, nil
		}
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	if len(s) == 32 {
		return []byte(s), nil
	}
	return nil, ErrInvalidKey
}

func newAEAD(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, ErrInvalidKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// EncryptStream encrypts everything read from src into dst.
func EncryptStream(dst io.Writer, src io.Reader, key []byte) error {
	aead, err := newAEAD(key)
	if err != nil {
		return err
	}
	prefix := make([]byte, prefixLen)
	if _, err := rand.Read(prefix); err != nil {
		return err
	}
	if _, err := dst.Write([]byte(magic)); err != nil {
		return err
	}
	if _, err := dst.Write(prefix); err != nil {
		return err
	}

	buf := make([]byte, chunkSize)
	nonce := make([]byte, nonceLen)
	copy(nonce, prefix)
	var counter uint32
	var lenBuf [4]byte
	for {
		n, readErr := io.ReadFull(src, buf)
		if n > 0 {
			binary.BigEndian.PutUint32(nonce[prefixLen:], counter)
			counter++
			sealed := aead.Seal(nil, nonce, buf[:n], nil)
			binary.BigEndian.PutUint32(lenBuf[:], uint32(len(sealed)))
			if _, err := dst.Write(lenBuf[:]); err != nil {
				return err
			}
			if _, err := dst.Write(sealed); err != nil {
				return err
			}
		}
		if readErr == io.EOF || readErr == io.ErrUnexpectedEOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

// DecryptStream decrypts a stream produced by EncryptStream from src into dst.
func DecryptStream(dst io.Writer, src io.Reader, key []byte) error {
	aead, err := newAEAD(key)
	if err != nil {
		return err
	}
	header := make([]byte, len(magic)+prefixLen)
	if _, err := io.ReadFull(src, header); err != nil {
		return ErrMalformed
	}
	if string(header[:len(magic)]) != magic {
		return ErrMalformed
	}
	prefix := header[len(magic):]
	nonce := make([]byte, nonceLen)
	copy(nonce, prefix)

	var counter uint32
	var lenBuf [4]byte
	for {
		if _, err := io.ReadFull(src, lenBuf[:]); err != nil {
			if err == io.EOF {
				return nil
			}
			return ErrMalformed
		}
		n := binary.BigEndian.Uint32(lenBuf[:])
		sealed := make([]byte, n)
		if _, err := io.ReadFull(src, sealed); err != nil {
			return ErrMalformed
		}
		binary.BigEndian.PutUint32(nonce[prefixLen:], counter)
		counter++
		plain, err := aead.Open(nil, nonce, sealed, nil)
		if err != nil {
			return fmt.Errorf("crypto: authentication failed: %w", err)
		}
		if _, err := dst.Write(plain); err != nil {
			return err
		}
	}
}
