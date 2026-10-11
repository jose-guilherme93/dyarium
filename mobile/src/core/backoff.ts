/**
 * Backoff exponencial com teto. Sem jitter para manter o comportamento
 * deterministico e testavel; o jitter pode ser adicionado depois se necessario.
 */

export const BASE_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 5 * 60_000;

/**
 * Atraso (em ms) antes da proxima tentativa, dado o numero de tentativas ja
 * feitas. attempts=1 -> base; attempts=2 -> 2x base; etc., limitado ao teto.
 */
export function nextAttemptDelayMs(
  attempts: number,
  baseMs: number = BASE_DELAY_MS,
  maxMs: number = MAX_DELAY_MS,
): number {
  const n = Math.max(1, Math.floor(attempts));
  const delay = baseMs * 2 ** (n - 1);
  return Math.min(maxMs, delay);
}
