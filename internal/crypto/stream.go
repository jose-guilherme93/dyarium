package crypto

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"io"
)

// recordSize bounds how much plaintext is sealed into a single AES-GCM record.
const recordSize = 1 << 20 // 1 MiB

// NewPrefix returns a fresh random 8-byte nonce prefix.
func NewPrefix() ([8]byte, error) {
	var p [8]byte
	if _, err := rand.Read(p[:]); err != nil {
		return p, err
	}
	return p, nil
}

// WriteHeader writes the magic marker and the nonce prefix at the start of a
// ciphertext stream.
func WriteHeader(w io.Writer, prefix [8]byte) error {
	if _, err := w.Write([]byte(magic)); err != nil {
		return err
	}
	_, err := w.Write(prefix[:])
	return err
}

// ReadHeader reads and validates the magic marker, returning the nonce prefix
// and leaving r positioned at the first record.
func ReadHeader(r io.Reader) ([8]byte, error) {
	var raw [len(magic) + prefixLen]byte
	if _, err := io.ReadFull(r, raw[:]); err != nil {
		return [8]byte{}, ErrMalformed
	}
	if string(raw[:len(magic)]) != magic {
		return [8]byte{}, ErrMalformed
	}
	var prefix [8]byte
	copy(prefix[:], raw[len(magic):])
	return prefix, nil
}

// Append encrypts everything read from src and appends length-prefixed records
// to w (opened for append), continuing the nonce counter from startCounter. It
// returns the next counter and the number of plaintext bytes processed. This is
// what makes resumable uploads possible: each call appends independent records.
func Append(w io.Writer, key []byte, prefix [8]byte, startCounter uint32, src io.Reader) (uint32, int64, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return startCounter, 0, err
	}
	buf := make([]byte, recordSize)
	var lenBuf [4]byte
	counter := startCounter
	var total int64
	for {
		n, readErr := io.ReadFull(src, buf)
		if n > 0 {
			sealed := aead.Seal(nil, newNonce(prefix, counter), buf[:n], nil)
			counter++
			binary.BigEndian.PutUint32(lenBuf[:], uint32(len(sealed)))
			if _, err := w.Write(lenBuf[:]); err != nil {
				return counter, total, err
			}
			if _, err := w.Write(sealed); err != nil {
				return counter, total, err
			}
			total += int64(n)
		}
		if readErr == io.EOF || readErr == io.ErrUnexpectedEOF {
			return counter, total, nil
		}
		if readErr != nil {
			return counter, total, readErr
		}
	}
}

// Decrypt reads a ciphertext stream (header plus records) and writes the
// plaintext to dst, returning the number of plaintext bytes produced.
func Decrypt(r io.Reader, key []byte, dst io.Writer) (int64, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return 0, err
	}
	prefix, err := ReadHeader(r)
	if err != nil {
		return 0, err
	}
	var counter uint32
	var total int64
	var lenBuf [4]byte
	for {
		if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
			if err == io.EOF {
				return total, nil
			}
			return total, ErrMalformed
		}
		n := binary.BigEndian.Uint32(lenBuf[:])
		sealed := make([]byte, n)
		if _, err := io.ReadFull(r, sealed); err != nil {
			return total, ErrMalformed
		}
		plain, err := aead.Open(nil, newNonce(prefix, counter), sealed, nil)
		if err != nil {
			return total, err
		}
		counter++
		if _, err := dst.Write(plain); err != nil {
			return total, err
		}
		total += int64(len(plain))
	}
}

// DecryptRange decrypts the inclusive plaintext window [start, end] of a
// ciphertext stream into dst. Records are independent, so it only seeks past
// the record headers before start (without decrypting them) and stops as soon
// as the window is covered. It is what makes HTTP Range requests cheap instead
// of decrypting the whole object.
func DecryptRange(r io.ReadSeeker, key []byte, start, end int64, dst io.Writer) (int64, error) {
	if start < 0 || end < start {
		return 0, ErrMalformed
	}
	aead, err := newAEAD(key)
	if err != nil {
		return 0, err
	}
	prefix, err := ReadHeader(r)
	if err != nil {
		return 0, err
	}
	overhead := int64(aead.Overhead())
	var counter uint32
	var pos int64 // first plaintext byte of the next record
	var lenBuf [4]byte
	for {
		if pos > start {
			// The caller asked for an offset before the first record.
			return 0, ErrMalformed
		}
		recordStart, err := r.Seek(0, io.SeekCurrent)
		if err != nil {
			return 0, err
		}
		if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
			// start == total plaintext size: an empty window at EOF is valid,
			// but a window that begins past the stream is not.
			if err == io.EOF && start == pos {
				return 0, nil
			}
			return 0, ErrMalformed
		}
		n := int64(binary.BigEndian.Uint32(lenBuf[:]))
		plainLen := n - overhead
		if plainLen < 0 {
			return 0, ErrMalformed
		}
		if pos+plainLen <= start {
			// Whole record is before the window: skip its ciphertext.
			pos += plainLen
			counter++
			if _, err := r.Seek(recordStart+4+n, io.SeekStart); err != nil {
				return 0, err
			}
			continue
		}
		// This record contains the first requested byte: rewind and decrypt
		// from here until the window is covered.
		if _, err := r.Seek(recordStart, io.SeekStart); err != nil {
			return 0, err
		}
		break
	}

	var wrote int64
	for pos <= end {
		if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
			if err == io.EOF {
				return wrote, nil
			}
			return wrote, ErrMalformed
		}
		n := int64(binary.BigEndian.Uint32(lenBuf[:]))
		sealed := make([]byte, n)
		if _, err := io.ReadFull(r, sealed); err != nil {
			return wrote, ErrMalformed
		}
		plain, err := aead.Open(nil, newNonce(prefix, counter), sealed, nil)
		if err != nil {
			return wrote, err
		}
		counter++
		recordEnd := pos + int64(len(plain)) - 1
		lo := pos
		if start > lo {
			lo = start
		}
		hi := recordEnd
		if end < hi {
			hi = end
		}
		if lo <= hi {
			chunk := plain[lo-pos : hi-pos+1]
			if _, err := dst.Write(chunk); err != nil {
				return wrote, err
			}
			wrote += int64(len(chunk))
		}
		pos = recordEnd + 1
	}
	return wrote, nil
}

// DecryptHash decrypts r and returns the plaintext size and its SHA-256, so that
// an upload can be validated without ever writing plaintext to disk.
func DecryptHash(r io.Reader, key []byte) (int64, [32]byte, error) {
	h := sha256.New()
	n, err := Decrypt(r, key, h)
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return n, sum, err
}

func newNonce(prefix [8]byte, counter uint32) []byte {
	nonce := make([]byte, nonceLen)
	copy(nonce, prefix[:])
	binary.BigEndian.PutUint32(nonce[prefixLen:], counter)
	return nonce
}
