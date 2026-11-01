/**
 * Identificador opaco gerado no navegador para um objeto criado offline.
 *
 * O servidor aceita ids de cliente (letras, digitos, `_` e `-`, ate 64
 * caracteres). Manda-lo no POST torna a criacao idempotente: reenviar depois de
 * uma resposta perdida devolve o mesmo objeto em vez de criar outro.
 */
export function clientId(prefix: string): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === "function") {
    return `${prefix}_${source.randomUUID()}`;
  }
  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
