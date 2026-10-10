package crypto

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"testing"
)

func newTestKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return key
}

func TestRoundTrip(t *testing.T) {
	key := newTestKey(t)
	sizes := []int{0, 1, chunkSize - 1, chunkSize, chunkSize + 1, chunkSize*3 + 7}
	for _, size := range sizes {
		plain := make([]byte, size)
		if _, err := rand.Read(plain); err != nil {
			t.Fatalf("rand: %v", err)
		}

		var enc bytes.Buffer
		if err := EncryptStream(&enc, bytes.NewReader(plain), key); err != nil {
			t.Fatalf("size %d: encrypt: %v", size, err)
		}
		if bytes.Contains(enc.Bytes(), plain) && size >= chunkSize {
			t.Fatalf("size %d: ciphertext contains plaintext", size)
		}

		var dec bytes.Buffer
		if err := DecryptStream(&dec, bytes.NewReader(enc.Bytes()), key); err != nil {
			t.Fatalf("size %d: decrypt: %v", size, err)
		}
		if !bytes.Equal(plain, dec.Bytes()) {
			t.Fatalf("size %d: round trip mismatch", size)
		}
	}
}

func TestDecryptWithWrongKeyFails(t *testing.T) {
	key := newTestKey(t)
	other := newTestKey(t)
	plain := []byte("audio secreto")

	var enc bytes.Buffer
	if err := EncryptStream(&enc, bytes.NewReader(plain), key); err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	var dec bytes.Buffer
	if err := DecryptStream(&dec, bytes.NewReader(enc.Bytes()), other); err == nil {
		t.Fatal("expected authentication error with wrong key")
	}
}

func TestDecryptTamperedFails(t *testing.T) {
	key := newTestKey(t)
	plain := bytes.Repeat([]byte("x"), 10)

	var enc bytes.Buffer
	if err := EncryptStream(&enc, bytes.NewReader(plain), key); err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	data := enc.Bytes()
	data[len(data)-1] ^= 0xff
	var dec bytes.Buffer
	if err := DecryptStream(&dec, bytes.NewReader(data), key); err == nil {
		t.Fatal("expected error on tampered ciphertext")
	}
}

func TestParseKey(t *testing.T) {
	raw := newTestKey(t)

	if _, err := ParseKey(hex.EncodeToString(raw)); err != nil {
		t.Fatalf("hex: %v", err)
	}
	if _, err := ParseKey(base64.StdEncoding.EncodeToString(raw)); err != nil {
		t.Fatalf("base64: %v", err)
	}
	if _, err := ParseKey(string(raw)); err != nil {
		t.Fatalf("raw: %v", err)
	}
	if _, err := ParseKey("curta"); err == nil {
		t.Fatal("expected error for invalid key")
	}
}
