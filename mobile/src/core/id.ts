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
