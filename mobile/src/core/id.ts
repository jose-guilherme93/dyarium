/**
 * Geracao de ids locais. Nao precisa ser criptograficamente forte; precisa ser
 * unico o suficiente dentro do aparelho e estavel como chave.
 */

export function newId(prefix = ''): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}${time}${rand}`;
}

/** Chave de idempotencia enviada ao servidor em cada gravacao. */
export function newClientKey(): string {
  return newId('ck_');
}
