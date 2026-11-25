// SHA-256 incremental em TypeScript puro, sem dependencia nativa.
// Permite hashear arquivos grandes em pedacos sem carregar tudo na memoria.

export interface Sha256 {
  update(bytes: Uint8Array): void;
  hex(): string;
}

// Constantes K do SHA-256 (primeiros 32 bits das raizes cubicas dos 64 primeiros primos).
const K: Uint32Array = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function processBlock(state: Uint32Array, block: Uint8Array, offset: number): void {
  const W = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    W[i] = ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
    const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
  }

  let a = state[0];
  let b = state[1];
  let c = state[2];
  let d = state[3];
  let e = state[4];
  let f = state[5];
  let g = state[6];
  let h = state[7];

  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
  state[4] = (state[4] + e) >>> 0;
  state[5] = (state[5] + f) >>> 0;
  state[6] = (state[6] + g) >>> 0;
  state[7] = (state[7] + h) >>> 0;
}

class Sha256Impl implements Sha256 {
  private readonly h: Uint32Array;
  private readonly buffer: Uint8Array;
  private bufferLen: number;
  // Comprimento total em bytes, em dois inteiros de 32 bits (big-endian no final).
  private totalBytesHigh: number;
  private totalBytesLow: number;

  constructor() {
    this.h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.buffer = new Uint8Array(64);
    this.bufferLen = 0;
    this.totalBytesHigh = 0;
    this.totalBytesLow = 0;
  }

  update(bytes: Uint8Array): void {
    const len = bytes.length;
    // Atualiza o contador de bytes (64 bits, dois inteiros de 32 bits).
    const prevLow = this.totalBytesLow;
    this.totalBytesLow = (prevLow + len) >>> 0;
    this.totalBytesHigh = (this.totalBytesHigh + ((prevLow + len) / 0x100000000 >>> 0)) >>> 0;

    let i = 0;
    // Completa o buffer parcial existente.
    if (this.bufferLen > 0) {
      const space = 64 - this.bufferLen;
      const take = Math.min(space, len);
      this.buffer.set(bytes.subarray(0, take), this.bufferLen);
      this.bufferLen += take;
      i += take;
      if (this.bufferLen === 64) {
        processBlock(this.h, this.buffer, 0);
        this.bufferLen = 0;
      }
    }
    // Processa blocos completos diretamente da entrada.
    while (i + 64 <= len) {
      processBlock(this.h, bytes, i);
      i += 64;
    }
    // Guarda o restante no buffer parcial.
    const rem = len - i;
    if (rem > 0) {
      this.buffer.set(bytes.subarray(i, i + rem), 0);
      this.bufferLen = rem;
    }
  }

  hex(): string {
    // Trabalha em copias para nao alterar o estado (chamadas repetidas sao idempotentes).
    const h = new Uint32Array(this.h);
    const bl = this.bufferLen;

    // Tamanho do sufixo de padding (inclui 0x80, zeros e os 8 bytes de comprimento).
    const tailLen = bl <= 55 ? 64 - bl : 128 - bl;
    const finalBytes = new Uint8Array(bl + tailLen);
    finalBytes.set(this.buffer.subarray(0, bl), 0);
    finalBytes[bl] = 0x80;

    // Comprimento em bits, big-endian, em 64 bits (dois inteiros de 32 bits).
    const highBits = ((this.totalBytesHigh << 3) | (this.totalBytesLow >>> 29)) >>> 0;
    const lowBits = (this.totalBytesLow << 3) >>> 0;
    const off = finalBytes.length - 8;
    finalBytes[off] = (highBits >>> 24) & 0xff;
    finalBytes[off + 1] = (highBits >>> 16) & 0xff;
    finalBytes[off + 2] = (highBits >>> 8) & 0xff;
    finalBytes[off + 3] = highBits & 0xff;
    finalBytes[off + 4] = (lowBits >>> 24) & 0xff;
    finalBytes[off + 5] = (lowBits >>> 16) & 0xff;
    finalBytes[off + 6] = (lowBits >>> 8) & 0xff;
    finalBytes[off + 7] = lowBits & 0xff;

    for (let i = 0; i < finalBytes.length; i += 64) {
      processBlock(h, finalBytes, i);
    }

    let out = "";
    for (let i = 0; i < 8; i++) {
      out += h[i].toString(16).padStart(8, "0");
    }
    return out;
  }
}

export function createSha256(): Sha256 {
  return new Sha256Impl();
}

export function sha256Hex(bytes: Uint8Array): string {
  const hasher = createSha256();
  hasher.update(bytes);
  return hasher.hex();
}
