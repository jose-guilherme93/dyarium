import { bytesToBase64 } from '../base64';

function bytes(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('bytesToBase64', () => {
  it('codifica sem preenchimento (multiplo de 3)', () => {
    expect(bytesToBase64(bytes([0x4d, 0x61, 0x6e]))).toBe('TWFu');
  });

  it('usa um sinal de igual com 1 byte sobrando', () => {
    expect(bytesToBase64(bytes([0x4d, 0x61]))).toBe('TWE=');
  });

  it('usa dois sinais de igual com 2 bytes sobrando', () => {
    expect(bytesToBase64(bytes([0x4d]))).toBe('TQ==');
  });

  it('codifica vazio como string vazia', () => {
    expect(bytesToBase64(bytes([]))).toBe('');
  });

  it('codifica binario arbitrario', () => {
    expect(bytesToBase64(bytes([0x00, 0xff, 0x10, 0x80]))).toBe('AP8QgA==');
  });
});
