/**
 * Desenho da onda de um audio.
 *
 * Duas ondas usam este modulo. A do audio ja gravado (no card da nota) nao vem
 * do sinal: como o app nao decodifica PCM, ela e montada a partir da densidade
 * de fala dos segmentos da transcricao mais um ruido estavel por audio. A da
 * gravacao ao vivo usa a faixa que a propria gravacao observa (`trackMeter` e
 * `levelFromTrack`): o piso e o ruido de fundo e o topo e o pico da fala.
 */

import type { TranscriptSegment } from './types';

/** Altura minima de uma barra (0..1): a onda nunca some por completo. */
export const WAVE_MIN = 0.06;
/** Barras da onda no transporte do audio. */
export const WAVE_BARS = 88;
/** Pausa curta antes da fala ainda aparece como som. */
const NEAR_MS = 700;

/** Quanto o piso (ruido) sobe por segundo quando o sinal fica acima dele. */
export const METER_FLOOR_RISE_DB_PER_S = 0.5;
/** Quanto o topo (fala) cai por segundo quando o sinal nao chega nele. */
export const METER_PEAK_FALL_DB_PER_S = 3;
/** Faixa minima entre piso e topo: sem ela, ruido constante viraria barra. */
export const METER_MIN_RANGE_DB = 10;
/** Faixa maxima: um estouro (tosse, porta) nao achata o resto da gravacao. */
export const METER_MAX_RANGE_DB = 36;
/** Margem acima do piso que ainda conta como silencio. */
export const METER_GATE_DB = 1;
/** Quanto o nivel cai por segundo quando o som para (cauda da barra). */
export const METER_RELEASE_DB_PER_S = 36;
/** Leitura de silencio absoluto do `expo-audio`. */
export const METER_SILENCE_DB = -160;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Faixa observada do microfone durante a gravacao.
 *
 * O dB do `expo-audio` nao tem a mesma escala em todo aparelho: ha telefone cuja
 * fala fica perto de -20 e outro em que ela mal passa de -45. Com uma escala
 * fixa, o segundo caso desenhava a fala com um terco da altura - o que parece
 * falta de sensibilidade. Aqui o piso e o ruido de fundo medido e o topo e o
 * pico da propria gravacao, entao a fala chega ao topo em qualquer aparelho e o
 * silencio continua no zero.
 */
export interface MeterTrack {
  /** Nivel mais baixo observado (ruido de fundo). */
  minDb: number;
  /** Nivel mais alto observado (fala). */
  maxDb: number;
}

/** Leitura de silencio absoluto (o `expo-audio` usa -160 quando nao ha sinal). */
function isSilence(metering: number): boolean {
  return !Number.isFinite(metering) || metering <= METER_SILENCE_DB + 1;
}

/**
 * Comeca a faixa no primeiro valor real. O -160 do inicio da gravacao nao
 * entra: ele viraria um piso falso e o ruido de fundo pareceria fala.
 */
export function createMeterTrack(metering?: number): MeterTrack {
  const db =
    metering !== undefined && !isSilence(metering) ? metering : METER_SILENCE_DB;
  return { minDb: db, maxDb: db };
}

/**
 * Atualiza a faixa com a leitura atual. O piso desce na hora e sobe devagar; o
 * topo sobe na hora e cai devagar. Assim uma pausa longa nao deixa a fala
 * seguinte baixa, e um ruido constante nao vira barra.
 */
export function trackMeter(track: MeterTrack, metering: number, deltaMs: number): MeterTrack {
  if (isSilence(metering)) return track;
  // Primeira leitura real depois do silencio inicial: a faixa comeca aqui.
  if (track.maxDb <= METER_SILENCE_DB + 1) return { minDb: metering, maxDb: metering };
  const seconds = Math.max(0, deltaMs) / 1000;
  const minDb = Math.min(metering, track.minDb + METER_FLOOR_RISE_DB_PER_S * seconds);
  const maxDb = Math.max(
    metering,
    track.maxDb - METER_PEAK_FALL_DB_PER_S * seconds,
    minDb + METER_MIN_RANGE_DB,
  );
  return { minDb, maxDb };
}

/** Nivel em 0..1 dentro da faixa observada, com curva perceptual. */
export function levelFromTrack(track: MeterTrack, metering: number): number {
  if (isSilence(metering)) return 0;
  const low = track.minDb + METER_GATE_DB;
  const range = clamp(track.maxDb - low, METER_MIN_RANGE_DB, METER_MAX_RANGE_DB);
  return clamp((metering - low) / range, 0, 1) ** 0.7;
}

/**
 * Envelope do medidor: ataque imediato (o valor do metering ja e o pico do
 * intervalo) e queda suave. Sem isso, cada amostra vira um degrau e a onda
 * parece ruido em vez de fala.
 */
export function smoothMetering(
  previousDb: number,
  currentDb: number,
  deltaMs: number,
): number {
  if (!Number.isFinite(currentDb)) return previousDb;
  if (currentDb >= previousDb) return currentDb;
  const release = METER_RELEASE_DB_PER_S * (Math.max(0, deltaMs) / 1000);
  return Math.max(currentDb, previousDb - release);
}

/** Hash estavel (FNV-1a de 32 bits) da semente textual. */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Ruido estavel em 0..1 para a barra `index` (mesma semente, mesma onda). */
function noise(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

/**
 * Quanto da janela [start, end) e fala. Anda com um cursor pelos segmentos
 * porque as barras sao pedidas em ordem: uma nota de horas nao relê a lista
 * inteira a cada barra.
 */
function speechDensity(
  segments: readonly TranscriptSegment[],
  cursor: { index: number },
  start: number,
  end: number,
): number {
  while (cursor.index < segments.length && segments[cursor.index].end_ms <= start) {
    cursor.index += 1;
  }
  let covered = 0;
  for (let index = cursor.index; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.start_ms >= end) break;
    covered += Math.max(0, Math.min(end, segment.end_ms) - Math.max(start, segment.start_ms));
  }
  return clamp(covered / Math.max(1, end - start), 0, 1);
}

/**
 * Alturas (0..1) das `bars` barras da onda, da esquerda para a direita.
 *
 * `durationMs` e os `segments` sao opcionais: sem eles a onda e so o desenho
 * deterministico da semente.
 */
export function waveformBars(
  seed: string,
  bars: number = WAVE_BARS,
  durationMs = 0,
  segments: readonly TranscriptSegment[] = [],
): number[] {
  if (bars <= 0) return [];
  const base = hashSeed(seed);
  const span = durationMs > 0 ? durationMs / bars : 0;
  const cursor = { index: 0 };
  const raw = new Array<number>(bars);

  for (let index = 0; index < bars; index += 1) {
    // Duas escalas: uma por barra (silaba) e outra por bloco de quatro barras
    // (frase). So uma delas deixaria a onda com cara de ruido uniforme.
    const syllable = noise(base, index);
    const phrase = 0.45 + 0.55 * noise(base ^ 0x5bd1e995, Math.floor(index / 4));
    // A maioria das barras e alta e as valas curtas marcam a separacao entre as
    // silabas. Sem elas a fala vira um bloco reto, sem o relevo do audio real.
    const valley = syllable < 0.12;
    const voice = valley
      ? 0.08
      : clamp(0.55 + 0.45 * ((syllable - 0.12) / 0.88) ** 0.8 * phrase, 0.5, 1);
    const shape = 0.14 + 0.86 * voice;
    if (span <= 0 || segments.length === 0) {
      // Sem transcricao nao ha como saber onde ha pausa: fica a textura de fala,
      // que ja mostra o contraste entre silaba forte e fraca.
      raw[index] = shape;
      continue;
    }
    const start = index * span;
    const density = speechDensity(segments, cursor, start, start + span);
    // Fala cheia, pausa quase apagada, e a transicao antes de um trecho aparece
    // como um som curto em vez de um corte seco.
    const near =
      density === 0 && segments[cursor.index]
        ? clamp(1 - (segments[cursor.index].start_ms - (start + span)) / NEAR_MS, 0, 1)
        : 0;
    const energy = Math.max(density, near * 0.35);
    // A pausa cai no traco minimo; a fala mantem o relevo das silabas. E esse
    // contraste que deixa a onda legivel de longe, como a da gravacao.
    raw[index] = energy <= 0 ? WAVE_MIN : shape * energy;
  }

  // Suaviza uma barra com as vizinhas: a onda fica desenhada, nao ruido. Pausa
  // e vala de silaba ficam de fora, senao o vizinho alto as levantaria e o
  // contraste sumiria.
  const levels = raw.map((value, index) => {
    if (value <= WAVE_MIN || value < 0.3) return value;
    const previous = raw[Math.max(0, index - 1)];
    const next = raw[Math.min(bars - 1, index + 1)];
    return clamp(previous * 0.2 + value * 0.6 + next * 0.2, WAVE_MIN, 1);
  });
  return levels;
}
