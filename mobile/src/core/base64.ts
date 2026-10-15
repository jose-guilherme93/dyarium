/**
 * Codificacao base64 de bytes, sem dependencia nativa. Necessaria para injetar
 * imagens no editor (WebView) sem expor a URL autenticada. Puro e testavel.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;

    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += has1 ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += has2 ? CHARS[b2 & 63] : '=';
  }
  return out;
}
