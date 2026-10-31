/**
 * Geracao de ids locais. Ordenavel por tempo (ULID) para que a posicao de uma
 * nota dependa do horario em que foi criada, e nao da ordem de sincronizacao.
 * Nao precisa ser criptograficamente forte; precisa ser unico e estavel.
 */

import { newUlid } from './ulid';

/** Id local ordenavel por tempo, com prefixo opcional (ex.: "note_"). */
export function newId(prefix = ''): string {
  return `${prefix}${newUlid()}`;
}

/** Chave de idempotencia enviada ao servidor em cada gravacao. */
export function newClientKey(): string {
  return newId('ck_');
}

/**
 * Id portatil de anexo, derivado do dono e do nome local do arquivo. Diferente
 * do ULID, e deterministico: o mesmo arquivo da mesma nota recebe o mesmo id em
 * qualquer ambiente, mesmo depois de um retry ou de um reenvio para outro
 * servidor. O corpo da nota que o referencia fica identico em todos eles.
 */
export function stableAttachmentId(scope: string, name: string): string {
  return `att_${hash53(`${scope}:${name}`)}`;
}

/** Hash de 53 bits (cyrb53), so para gerar um id estavel e compacto. */
function hash53(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(36);
}
