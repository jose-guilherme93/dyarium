/**
 * Tempos de animacao do app, num lugar so. O fator de velocidade encurta tudo em
 * 1/3 (50% mais rapido): os tempos nativos deixavam a interface com cara de lenta.
 */

/** Quanto mais rapido que a base. 1.5 = 50% mais rapido. */
export const MOTION_SPEED = 1.5;

/** Converte um tempo-base (ms) para o tempo acelerado do app. */
export function motionDuration(baseMs: number): number {
  return Math.round(baseMs / MOTION_SPEED);
}

/** Fade rapido dos menus e modais (o fade nativo do Android leva ~150 ms). */
export const MOTION_FAST = motionDuration(150);
