// Ondas do no selecionado no mapa. A animacao roda numa camada propria e para
// sozinha: o grafo nao e redesenhado a cada frame.

const WAVE_MS = 4200;
const WAVE_GAP_MS = 780;
const WAVE_COUNT = 3;
const WAVE_SPREAD = 30;

/** Quanto tempo a rajada inteira dura, incluindo a ultima onda. */
export const RIPPLE_TOTAL_MS = (WAVE_COUNT - 1) * WAVE_GAP_MS + WAVE_MS;

/** Intervalo entre uma rajada e a seguinte enquanto ha bola selecionada. */
export const RIPPLE_INTERVAL_MS = 9000;

export interface RippleWave {
  radius: number;
  alpha: number;
  lineWidth: number;
}

/**
 * Ondas visiveis em `elapsed` milissegundos depois do clique. Cada onda nasce
 * no raio do no, expande rapido e desacelera, e some conforme cresce.
 */
export function rippleWaves(elapsed: number, baseRadius: number): RippleWave[] {
  const waves: RippleWave[] = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    const local = (elapsed - i * WAVE_GAP_MS) / WAVE_MS;
    if (local < 0 || local >= 1) continue;
    // easeOutQuad: sai do no e perde velocidade sem saltar.
    const eased = 1 - Math.pow(1 - local, 2);
    waves.push({
      radius: baseRadius + eased * WAVE_SPREAD,
      alpha: (1 - local) * 0.7,
      lineWidth: Math.max(1, 2.6 * (1 - local)),
    });
  }
  return waves;
}
