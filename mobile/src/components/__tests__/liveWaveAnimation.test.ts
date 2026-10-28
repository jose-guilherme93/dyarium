import {
  BAR_MS,
  MAX_FRAME_MS,
  MIN_BAR,
  MIN_LEVEL,
  stepLiveWave,
  wavePath,
} from '@/components/liveWaveAnimation';

function makeState(options: {
  running?: boolean;
  level?: number;
  seq?: number;
  consumed?: number;
  tape?: number[];
} = {}) {
  return {
    tape: { value: options.tape ?? new Array(4).fill(MIN_LEVEL) },
    pending: { value: { level: options.level ?? MIN_LEVEL, seq: options.seq ?? 0 } },
    consumedSeq: { value: options.consumed ?? 0 },
    shift: { value: 0 },
    running: { value: options.running ?? true },
  };
}

describe('stepLiveWave', () => {
  it('nao mexe na onda com a gravacao parada', () => {
    const state = makeState({ running: false, level: 0.5, seq: 1 });

    stepLiveWave(state, BAR_MS);

    expect(state.shift.value).toBe(0);
    expect(state.consumedSeq.value).toBe(0);
  });

  it('desloca a fita continuamente entre as amostras', () => {
    const state = makeState({ level: 0.5, seq: 1 });

    stepLiveWave(state, BAR_MS / 2);

    expect(state.shift.value).toBe(0.5);
    // A amostra so entra quando o deslocamento completa uma barra.
    expect(state.tape.value).toEqual(new Array(4).fill(MIN_LEVEL));
    expect(state.consumedSeq.value).toBe(0);
  });

  it('ao completar uma barra, a amostra entra na ponta', () => {
    const state = makeState({ level: 0.9, seq: 1 });

    stepLiveWave(state, BAR_MS);

    expect(state.tape.value).toEqual([MIN_LEVEL, MIN_LEVEL, MIN_LEVEL, 0.9]);
    expect(state.shift.value).toBe(0);
    expect(state.consumedSeq.value).toBe(1);
  });

  it('espera no limite quando o JS ainda nao entregou amostra', () => {
    const state = makeState({ seq: 0, consumed: 0 });

    stepLiveWave(state, BAR_MS * 2);

    expect(state.shift.value).toBe(1);
    expect(state.tape.value).toEqual(new Array(4).fill(MIN_LEVEL));
  });

  it('nao repete a mesma amostra em duas barras', () => {
    const state = makeState({ level: 0.8, seq: 1 });

    stepLiveWave(state, BAR_MS);
    stepLiveWave(state, BAR_MS);

    expect(state.tape.value).toEqual([MIN_LEVEL, MIN_LEVEL, MIN_LEVEL, 0.8]);
    expect(state.consumedSeq.value).toBe(1);
    // A segunda barra espera a proxima amostra.
    expect(state.shift.value).toBe(1);
  });

  it('usa a amostra mais nova num quadro atrasado, sem atrasar a onda', () => {
    const state = makeState({ level: 0.6, seq: 3, consumed: 2 });

    stepLiveWave(state, BAR_MS * 3);

    expect(state.tape.value).toEqual([MIN_LEVEL, MIN_LEVEL, MIN_LEVEL, 0.6]);
    expect(state.consumedSeq.value).toBe(3);
    expect(state.shift.value).toBe(1);
  });

  it('limita um quadro gigante (app volta do segundo plano)', () => {
    const state = makeState({ level: 0.4, seq: 1 });

    stepLiveWave(state, 10_000);

    // No maximo tres intervalos por quadro: a fita nao anda um minuto de uma vez.
    expect(MAX_FRAME_MS).toBe(BAR_MS * 3);
    expect(state.tape.value).toEqual([MIN_LEVEL, MIN_LEVEL, MIN_LEVEL, 0.4]);
    expect(state.shift.value).toBe(1);
  });
});

describe('wavePath', () => {
  it('desenha uma barra por nivel, centrada na altura', () => {
    const d = wavePath([0, 1, 1], 10, 100, 90);

    // Tres barras: x = 5, 15 e 25.
    expect(d.match(/M/g)).toHaveLength(3);
    expect(d).toContain('M5 48.8V51.3');
    expect(d).toContain('M15 5V95');
    expect(d).toContain('M25 5V95');
  });

  it('trata nivel zero como o traco minimo, nunca como barra vazia', () => {
    const d = wavePath([0], 10, 100, 90);

    expect(d).toContain('M5 48.8V51.3');
    expect(MIN_BAR).toBe(2.5);
  });

  it('posiciona as barras uma por passo', () => {
    const d = wavePath([0, 0, 0], 10, 100, 90);

    expect(d).toContain('M5 48.8V51.3');
    expect(d).toContain('M15 48.8V51.3');
    expect(d).toContain('M25 48.8V51.3');
  });
});
