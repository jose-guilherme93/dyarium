package crypto

import (
	"bytes"
	"crypto/sha256"
	"testing"
)

func TestAppendResume(t *testing.T) {
	key := newTestKey(t)
	prefix, err := NewPrefix()
	if err != nil {
		t.Fatalf("prefix: %v", err)
	}

	plain := make([]byte, recordSize*2+1234)
	for i := range plain {
		plain[i] = byte(i % 251)
	}

	var buf bytes.Buffer
	if err := WriteHeader(&buf, prefix); err != nil {
		t.Fatalf("header: %v", err)
	}

	// Append in uneven pieces, as a resumable upload would.
	counter := uint32(0)
	offsets := []int{0, 1000, recordSize, recordSize + 17, len(plain)}
	for i := 0; i < len(offsets)-1; i++ {
		counter, _, err = Append(&buf, key, prefix, counter, bytes.NewReader(plain[offsets[i]:offsets[i+1]]))
		if err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
	}

	var out bytes.Buffer
	n, err := Decrypt(bytes.NewReader(buf.Bytes()), key, &out)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if n != int64(len(plain)) {
		t.Fatalf("size = %d, want %d", n, len(plain))
	}
	if !bytes.Equal(plain, out.Bytes()) {
		t.Fatal("round trip mismatch after resumable append")
	}
}

func TestDecryptHash(t *testing.T) {
	key := newTestKey(t)
	prefix, _ := NewPrefix()
	var buf bytes.Buffer
	if err := WriteHeader(&buf, prefix); err != nil {
		t.Fatalf("header: %v", err)
	}
	plain := []byte("conteudo do audio")
	if _, _, err := Append(&buf, key, prefix, 0, bytes.NewReader(plain)); err != nil {
		t.Fatalf("append: %v", err)
	}

	n, sum, err := DecryptHash(bytes.NewReader(buf.Bytes()), key)
	if err != nil {
		t.Fatalf("decrypt hash: %v", err)
	}
	if n != int64(len(plain)) {
		t.Fatalf("size = %d, want %d", n, len(plain))
	}
	if got := sha256.Sum256(plain); sum != got {
		t.Fatal("sha256 mismatch")
	}
}
