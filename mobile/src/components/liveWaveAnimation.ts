/**
 * Passo e desenho da onda da gravacao.
 *
 * Separado do componente para o passo poder ser testado como funcao pura e para
 * a mutacao dos valores compartilhados ficar fora do escopo do componente (o
 * React Compiler trata valores usados em efeitos como imutaveis no render).
 *
 * A fita (`tape`) tem uma barra a mais que a area visivel. O deslocamento
 * (`shift`) anda de 0 a 1 barra; ao chegar em 1, a amostra mais nova entra na
 * ponta, a fita anda uma posicao e o deslocamento volta a 0 - tudo no mesmo
 * quadro, entao o desenho nao salta.
 *
 * O desenho nao usa uma view por barra: a onda inteira e um unico `Path` SVG.
 * A cada quadro muda um atributo (o `d`), e nao a altura de 88 views. E o que
 * segura os 60 fps mesmo com o JS ocupado gravando.
 */

/** De quanto em quanto tempo o JS entrega o nivel do microfone. */
export const SAMPLE_MS = 35;
/**
 * Tempo de uma barra na tela. Um pouco maior que o intervalo de amostragem de
 * proposito: sempre ha uma amostra nova pronta e a fita nao trava no limite
 * esperando o JS.
 */
export const BAR_MS = 60;
/** Um quadro perdido nao pode fazer a fita pular varios segundos. */
export const MAX_FRAME_MS = BAR_MS * 3;
/** Altura minima de uma barra (fracao da altura maxima). */
export const MIN_LEVEL = 0.03;
/** Altura minima de uma barra, em dp: no silencio fica um traco visivel. */
export const MIN_BAR = 2.5;
/** Respiro entre as barras, em dp. */
export const BAR_GAP = 3;

/**
 * Valor mutavel com `value`: o mesmo formato de um `SharedValue` do Reanimated.
 * A interface minima deixa o passo testavel sem o Reanimated.
 */
export interface WaveValue<T> {
  value: T;
}

export interface LiveWaveState {
  /** Fita da onda (mais antiga -> mais nova), uma barra a mais que a area. */
  tape: WaveValue<number[]>;
  /** Ultima amostra entregue pelo JS. O `seq` so muda com uma amostra nova. */
  pending: WaveValue<{ level: number; seq: number }>;
  /** Ultimo `seq` que a UI consumiu. */
  consumedSeq: WaveValue<number>;
  /** Deslocamento da fita, em barras (0..1). */
  shift: WaveValue<number>;
  /** Gravando e sem pausa. */
  running: WaveValue<boolean>;
}

/** Avanca a onda um quadro. Roda na thread de UI. */
export function stepLiveWave(state: LiveWaveState, elapsedMs: number): void {
  'worklet';
  if (!state.running.value) return;

  const elapsed = Math.min(Math.max(elapsedMs, 0), MAX_FRAME_MS);
  state.shift.value += elapsed / BAR_MS;

  while (state.shift.value >= 1) {
    const pending = state.pending.value;
    if (pending.seq === state.consumedSeq.value) {
      // Sem amostra nova: a fita espera no limite em vez de mostrar um vazio.
      state.shift.value = 1;
      break;
    }
    const nextTape = state.tape.value.slice(1);
    nextTape.push(pending.level);
    state.tape.value = nextTape;
    state.consumedSeq.value = pending.seq;
    state.shift.value -= 1;
  }
}

function round(value: number): number {
  'worklet';
  return Math.round(value * 10) / 10;
}

/**
 * `d` do SVG com a fita inteira, em dp. Cada barra e um traco vertical de ponta
 * arredondada (o `strokeLinecap` do path); a altura vem do nivel da amostra. O
 * deslocamento e do container (`translateX`), entao o path fica em posicoes
 * inteiras e so muda quando uma amostra entra.
 */
export function wavePath(
  levels: readonly number[],
  step: number,
  height: number,
  maxBar: number,
): string {
  'worklet';
  const middle = height / 2;
  let path = '';
  for (let index = 0; index < levels.length; index += 1) {
    const x = step / 2 + index * step;
    const bar = Math.max(MIN_BAR, Math.min(maxBar, levels[index] * maxBar));
    const half = bar / 2;
    path += `M${round(x)} ${round(middle - half)}V${round(middle + half)}`;
  }
  return path;
}
