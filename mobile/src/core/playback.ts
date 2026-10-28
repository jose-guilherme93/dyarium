/**
 * Regras puras de reproducao de audio. Testaveis sem player.
 */

/** Segundos de folga para considerar que a reproducao chegou ao fim. */
export const PLAYBACK_END_EPSILON = 0.25;

/**
 * Verdadeiro quando a reproducao ja chegou (ou passou) do fim. Depois do fim o
 * player nao reinicia sozinho: e preciso voltar ao inicio antes de tocar.
 */
export function isPlaybackFinished(currentTime: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (!Number.isFinite(currentTime) || currentTime <= 0) return false;
  return currentTime >= duration - PLAYBACK_END_EPSILON;
}
