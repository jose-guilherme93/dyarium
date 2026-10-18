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

func TestDecryptRange(t *testing.T) {
	key := newTestKey(t)
	prefix, err := NewPrefix()
	if err != nil {
		t.Fatalf("prefix: %v", err)
	}
	plain := make([]byte, recordSize*2+4321)
	for i := range plain {
		plain[i] = byte(i % 251)
	}
	var buf bytes.Buffer
	if err := WriteHeader(&buf, prefix); err != nil {
		t.Fatalf("header: %v", err)
	}
	// Uneven appends create short records in the middle, which is the hard
	// case for seeking: the next record offset cannot be computed arithmetically.
	counter := uint32(0)
	offsets := []int{0, 1000, recordSize, recordSize + 17, len(plain)}
	for i := 0; i < len(offsets)-1; i++ {
		counter, _, err = Append(&buf, key, prefix, counter, bytes.NewReader(plain[offsets[i]:offsets[i+1]]))
		if err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
	}

	ranges := [][2]int64{
		{0, 0},
		{0, 999},
		{1000, 1000},
		{1023, 1024},
		{recordSize - 1, recordSize},
		{recordSize, recordSize + 3},
		{recordSize + 16, recordSize + 18},
		{int64(len(plain)) - 1, int64(len(plain)) - 1},
		{int64(len(plain)), int64(len(plain))},
	}
	for _, rg := range ranges {
		var out bytes.Buffer
		n, err := DecryptRange(bytes.NewReader(buf.Bytes()), key, rg[0], rg[1], &out)
		if err != nil {
			t.Fatalf("range %v: %v", rg, err)
		}
		want := plain[rg[0]:min64(rg[1]+1, int64(len(plain)))]
		if n != int64(len(want)) || !bytes.Equal(out.Bytes(), want) {
			t.Fatalf("range %v: got %d bytes, want %d", rg, n, len(want))
		}
	}
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func TestDecryptRangeRejectsOffsetPastEnd(t *testing.T) {
	key := newTestKey(t)
	prefix, _ := NewPrefix()
	var buf bytes.Buffer
	if err := WriteHeader(&buf, prefix); err != nil {
		t.Fatalf("header: %v", err)
	}
	if _, _, err := Append(&buf, key, prefix, 0, bytes.NewReader([]byte("abc"))); err != nil {
		t.Fatalf("append: %v", err)
	}
	var out bytes.Buffer
	if _, err := DecryptRange(bytes.NewReader(buf.Bytes()), key, 4, 5, &out); err == nil {
		t.Fatal("esperava erro para offset depois do fim")
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
