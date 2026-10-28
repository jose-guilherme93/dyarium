import {
  createMeterTrack,
  levelFromTrack,
  smoothMetering,
  trackMeter,
  WAVE_MIN,
  waveformBars,
  type MeterTrack,
} from '@/core/waveform';

const SEGMENTS = [
  { start_ms: 0, end_ms: 5_000, text: 'bom dia' },
  { start_ms: 12_000, end_ms: 16_000, text: 'ate logo' },
];

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

describe('waveformBars', () => {
  it('desenha a mesma onda para a mesma referencia do audio', () => {
    const first = waveformBars('local:audio-1.aac', 40, 20_000, SEGMENTS);
    const second = waveformBars('local:audio-1.aac', 40, 20_000, SEGMENTS);
    const other = waveformBars('attachment:at_2', 40, 20_000, SEGMENTS);

    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
  });

  it('mantem as barras entre o minimo e o topo', () => {
    const levels = waveformBars('audio', 64, 90_000, SEGMENTS);

    expect(levels).toHaveLength(64);
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(WAVE_MIN);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it('fica mais alta na fala do que nas pausas', () => {
    const levels = waveformBars('audio', 40, 20_000, [SEGMENTS[0]]);

    // Os primeiros 8 tiros caem nos 5 s com fala; os ultimos 8, no silencio.
    expect(average(levels.slice(0, 8))).toBeGreaterThan(average(levels.slice(32)) + 0.15);
  });

  it('deixa a pausa quase apagada e a fala perto do topo', () => {
    const levels = waveformBars('audio', 40, 20_000, [SEGMENTS[0]]);

    // Contraste alto, como a waveform da gravacao: a fala ocupa a altura e a
    // pausa fica no traco minimo, sem o vizinho levantar o silencio.
    expect(average(levels.slice(0, 6))).toBeGreaterThan(0.7);
    expect(average(levels.slice(34))).toBeLessThan(0.1);
  });

  it('usa 88 barras por padrao, a mesma densidade da gravacao', () => {
    expect(waveformBars('audio')).toHaveLength(88);
  });

  it('desenha a onda sem transcricao', () => {
    const levels = waveformBars('audio', 32);

    expect(levels).toHaveLength(32);
    expect(new Set(levels).size).toBeGreaterThan(8);
  });

  it('nao desenha barras quando o numero e zero', () => {
    expect(waveformBars('audio', 0)).toEqual([]);
  });
});

/** Repete uma leitura, como o medidor entregando o mesmo valor. */
function repeat(db: number, times: number): number[] {
  return new Array(times).fill(db);
}

/** Alimenta a faixa com uma sequencia de leituras e devolve o estado final. */
function feed(values: number[], stepMs = 35): MeterTrack {
  let track = createMeterTrack(values[0]);
  for (const db of values) track = trackMeter(track, db, stepMs);
  return track;
}

describe('faixa do medidor', () => {
  it('coloca a fala no topo mesmo num aparelho que mede baixo', () => {
    // Silencio em -70 dB e fala em -45: numa escala fixa a fala ficava com um
    // terco da altura. Com a faixa observada, ela chega ao topo.
    const track = feed([...repeat(-70, 20), ...repeat(-45, 10)]);

    expect(levelFromTrack(track, -45)).toBeGreaterThan(0.9);
    expect(levelFromTrack(track, -70)).toBe(0);
  });

  it('nao deixa a fala baixa depois de uma pausa longa', () => {
    const track = feed([...repeat(-20, 10), ...repeat(-55, 286)]);

    expect(levelFromTrack(track, -55)).toBe(0);
    // A fala seguinte volta ao topo (o piso nao subiu junto com o silencio).
    expect(levelFromTrack(trackMeter(track, -20, 35), -20)).toBeGreaterThan(0.9);
  });

  it('nao transforma ruido constante em barra', () => {
    const track = feed(repeat(-30, 200));

    expect(levelFromTrack(track, -30)).toBe(0);
  });

  it('limita a faixa para um estouro nao achatar a gravacao', () => {
    let track = createMeterTrack(-55);
    track = trackMeter(track, -2, 35);
    for (const db of repeat(-30, 10)) track = trackMeter(track, db, 35);

    expect(levelFromTrack(track, -30)).toBeGreaterThan(0.7);
  });

  it('comeca no silencio e ignora leitura invalida', () => {
    const track = createMeterTrack();

    expect(levelFromTrack(track, -160)).toBe(0);
    expect(trackMeter(track, Number.NaN, 35)).toBe(track);
    expect(trackMeter(track, -160, 35)).toBe(track);
    expect(levelFromTrack(track, Number.NaN)).toBe(0);
  });

  it('nao deixa o -160 do inicio virar piso falso', () => {
    // O expo-audio devolve -160 enquanto nao ha sinal; se ele virasse piso, o
    // ruido de fundo seguinte apareceria como fala.
    let track = createMeterTrack(-160);
    track = trackMeter(track, -50, 35);

    expect(levelFromTrack(track, -50)).toBe(0);
    expect(levelFromTrack(trackMeter(track, -25, 35), -25)).toBeGreaterThan(0.9);
  });
});

describe('smoothMetering', () => {
  it('sobe na hora quando o som aparece', () => {
    expect(smoothMetering(-160, -20, 50)).toBe(-20);
  });

  it('desce devagar quando o som para, para a onda nao virar ruido', () => {
    // 36 dB por segundo: em 500 ms a cauda cai 18 dB.
    expect(smoothMetering(-10, -60, 500)).toBe(-28);
  });

  it('nao desce abaixo do nivel atual', () => {
    expect(smoothMetering(-10, -12, 100)).toBe(-12);
  });

  it('ignora uma leitura invalida e mantem o envelope', () => {
    expect(smoothMetering(-10, Number.NaN, 500)).toBe(-10);
  });
});
