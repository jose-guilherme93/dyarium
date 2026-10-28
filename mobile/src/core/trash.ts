/**
 * Janela da lixeira: apagar uma nota e reversivel por 7 dias.
 *
 * Puro para testar sem SQLite nem sistema de arquivos. A data de exclusao e a
 * mesma que o app mostra na lixeira; o servidor usa a mesma janela padrao.
 */

export const TRASH_RETENTION_DAYS = 7;

export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Instante em que a nota deixa de ser recuperavel. */
export function trashExpiresAt(deletedAt: string): number {
  return Date.parse(deletedAt) + TRASH_RETENTION_MS;
}

export function isTrashExpired(deletedAt: string, now = Date.now()): boolean {
  const expires = trashExpiresAt(deletedAt);
  return !Number.isNaN(expires) && expires <= now;
}

/**
 * Quantos dias inteiros ainda restam (1 a 7). Uma nota apagada ha menos de um
 * dia ainda mostra "7", que e o espaco que o usuario tem pela frente.
 */
export function trashDaysLeft(deletedAt: string, now = Date.now()): number {
  const expires = trashExpiresAt(deletedAt);
  if (Number.isNaN(expires)) return TRASH_RETENTION_DAYS;
  const left = expires - now;
  if (left <= 0) return 0;
  return Math.max(1, Math.min(TRASH_RETENTION_DAYS, Math.ceil(left / (24 * 60 * 60 * 1000))));
}
