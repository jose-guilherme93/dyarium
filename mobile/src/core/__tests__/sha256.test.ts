import { createSha256, sha256Hex } from '../sha256';

const enc = new TextEncoder();

function bytesOf(s: string): Uint8Array {
  return enc.encode(s);
}

describe('sha256', () => {
  it('vetor vazio', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('vetor abc', () => {
    expect(sha256Hex(bytesOf('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('vetor abcdbcdec...', () => {
    expect(sha256Hex(bytesOf('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('vetor quick brown fox', () => {
    expect(sha256Hex(bytesOf('The quick brown fox jumps over the lazy dog'))).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });

  it('chunking em tamanhos variados produz o mesmo hex', () => {
    const full = bytesOf('The quick brown fox jumps over the lazy dog');
    const expected = sha256Hex(full);
    for (const size of [1, 2, 5, 7, 13]) {
      const h = createSha256();
      for (let i = 0; i < full.length; i += size) {
        h.update(full.subarray(i, i + size));
      }
      expect(h.hex()).toBe(expected);
    }
  });

  it('1.000.000 de a em pedacos', () => {
    const data = new Uint8Array(1_000_000);
    data.fill(97); // 'a'
    const h = createSha256();
    const chunk = 1000;
    for (let i = 0; i < data.length; i += chunk) {
      h.update(data.subarray(i, i + chunk));
    }
    expect(h.hex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('hex() e idempotente e update de 0 bytes nao muda', () => {
    const h = createSha256();
    h.update(bytesOf('abc'));
    const a = h.hex();
    const b = h.hex();
    expect(a).toBe(b);
    h.update(new Uint8Array(0));
    expect(h.hex()).toBe(a);
  });

  // Vetores fixos para mensagens de 'a' repetido nos tamanhos de borda.
  it('borda 55 bytes', () => {
    const data = new Uint8Array(55);
    data.fill(97);
    expect(sha256Hex(data)).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
  });

  it('borda 56 bytes', () => {
    const data = new Uint8Array(56);
    data.fill(97);
    expect(sha256Hex(data)).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
  });

  it('borda 63 bytes', () => {
    const data = new Uint8Array(63);
    data.fill(97);
    expect(sha256Hex(data)).toBe('7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34');
  });

  it('borda 64 bytes', () => {
    const data = new Uint8Array(64);
    data.fill(97);
    expect(sha256Hex(data)).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
  });

  it('chunking byte a byte', () => {
    const full = bytesOf('abc');
    const h = createSha256();
    for (const b of full) h.update(new Uint8Array([b]));
    expect(h.hex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
