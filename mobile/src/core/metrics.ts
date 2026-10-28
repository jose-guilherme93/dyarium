/**
 * Metricas por janela (7d/30d/365d) e as frases do resumo do Painel.
 *
 * Puro e testavel: recebe as notas (e as analises ja carregadas), um relogio
 * fixo e devolve os numeros prontos. Nada de rede, banco ou sistema de
 * arquivos. O Painel, o snapshot e os testes usam o mesmo resultado.
 *
 * A escrita continua sendo calculada por `analyzeWriting`; aqui so recortamos a
 * janela e acrescentamos voz, imagens, cobertura de analise e sentimento.
 */

import { analysisContentHash } from './analysisPrompt';
import { displayTitle } from './title';
import type { Recording } from './types';
import {
  WARM_FACTS_BATCH,
  analyzeWriting,
  dayKey,
  noteTextFacts,
  plainText,
  wordsOf,
  writingConsistency,
  writingStreaks,
  yieldToUI,
  warmWritingFacts,
  type ConsistencyMetrics,
  type WarmFactsOptions,
  type WordCount,
  type WritingStreaks,
} from './writing';

export type MetricsWindow = '7d' | '30d' | '365d';

export const METRICS_WINDOWS: MetricsWindow[] = ['7d', '30d', '365d'];

/** Dias corridos de cada janela. "Ano" e 365 dias, nao ano-calendario. */
export const METRICS_WINDOW_DAYS: Record<MetricsWindow, number> = {
  '7d': 7,
  '30d': 30,
  '365d': 365,
};

export interface MetricsRange {
  kind: MetricsWindow;
  days: number;
  /** Inicio do primeiro dia da janela (00:00 local). */
  from: Date;
  /** Fim da janela (agora, ou o ultimo instante da janela anterior). */
  to: Date;
}

export type MetricsAnalysisOrigin = 'local' | 'server';

/**
 * Analise ja carregada, no formato que o Painel consegue agregar. A tela monta
 * esta lista a partir do cache local/SQLite e das analises do servidor.
 */
export interface AnalysisFact {
  /** Id da entrada (ou da gravacao local, antes do upload). */
  entryId: string;
  /** Quando a analise foi produzida (ISO); usado para a do servidor. */
  createdAt?: string;
  origin?: MetricsAnalysisOrigin;
  /** Hash do conteudo analisado (so a analise local preenche). */
  contentHash?: string;
  /** Modelo que produziu; `local-fallback` indica leitura simplificada. */
  model?: string;
  sentiment: number;
  sentimentLabel?: string;
  /** Emocoes com intensidade, como o servidor devolve. */
  emotions?: Record<string, number> | null;
  /** Nomes ja normalizados para exibicao (a tela faz o mapeamento). */
  themes?: string[];
  people?: string[];
  places?: string[];
}

export interface MetricsInput {
  recordings: Recording[];
  analyses?: AnalysisFact[];
  /** Bytes de imagem por id local da nota (vem do scan de armazenamento). */
  imageBytes?: Record<string, number>;
  now?: Date;
}

export type MetricsStreak = WritingStreaks;

export interface WindowWriting {
  /** Entradas na janela (com ou sem texto). */
  notes: number;
  withText: number;
  withAudio: number;
  withTranscript: number;

  words: number;
  chars: number;
  sentences: number;
  paragraphs: number;
  uniqueWords: number;
  lexicalRichness: number;
  averageWordsPerNote: number;
  averageSentenceWords: number;
  averageWordLength: number;
  readingMinutes: number;

  topWords: WordCount[];
  longestWords: WordCount[];
  questions: number;
  exclamations: number;
  links: number;
  images: number;
  listItems: number;

  activeDays: number;
  averageNotesPerActiveDay: number;
  notesPerWeek: number;
  topWeekday: WordCount | null;
  topHour: WordCount | null;
  weekdayHour: number[][];
  consistency: ConsistencyMetrics;
  longestNote: { title: string; words: number } | null;
}

export interface WindowVoice {
  audioCount: number;
  audioMinutes: number;
  transcribedMinutes: number;
  coverage: number;
  words: number;
  wordsPerMinute: number;
  wordsPerAudio: number;
  originLocal: number;
  originServer: number;
  transcriptShare: number;
}

export interface WindowImages {
  count: number;
  bytesTotal: number;
  bytesAverage: number;
  /** Imagens por entrada na janela. */
  perNote: number;
  notesWithImage: number;
  notesWithImageNoText: number;
}

export interface WindowAnalysis {
  notesWithContent: number;
  notesAnalyzed: number;
  coverage: number;
  stale: number;
  simplified: number;
  lastAnalyzedAt: string | null;
}

export interface RankedCount {
  label: string;
  count: number;
}

export interface WindowTopics {
  themes: RankedCount[];
  people: RankedCount[];
  places: RankedCount[];
}

export interface SentimentPoint {
  key: string;
  average: number;
  notes: number;
}

export type SentimentTone = 'positive' | 'neutral' | 'negative';

export interface EmotionCount {
  label: string;
  count: number;
  /** Tom das notas em que a emocao apareceu. */
  tone: SentimentTone;
}

export interface WindowSentiment {
  source: 'analysis' | 'lexical';
  analyzed: number;
  positive: number;
  neutral: number;
  negative: number;
  average: number;
  topPositive: { title: string; score: number } | null;
  topNegative: { title: string; score: number } | null;
  emotions: EmotionCount[];
  series: SentimentPoint[];
  granularity: 'day' | 'week';
}

export interface WindowMetrics {
  window: MetricsWindow;
  days: number;
  from: string;
  to: string;
  writing: WindowWriting;
  voice: WindowVoice;
  images: WindowImages;
  analysis: WindowAnalysis;
  sentiment: WindowSentiment;
  topics: WindowTopics;
  summary: string[];
}

export interface MetricsReport {
  generatedAt: string;
  streak: MetricsStreak;
  windows: Record<MetricsWindow, WindowMetrics>;
}

// --- Datas -----------------------------------------------------------------

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

export function metricsRange(kind: MetricsWindow, now: Date = new Date()): MetricsRange {
  const days = METRICS_WINDOW_DAYS[kind];
  return {
    kind,
    days,
    from: startOfDay(addDays(now, -(days - 1))),
    to: now,
  };
}

function previousRange(range: MetricsRange): MetricsRange {
  return {
    kind: range.kind,
    days: range.days,
    from: addDays(range.from, -range.days),
    to: new Date(range.from.getTime() - 1),
  };
}

function inTimeRange(time: number, range: MetricsRange): boolean {
  return time >= range.from.getTime() && time <= range.to.getTime();
}

// --- Audio e transcricao ---------------------------------------------------

interface AudioFact {
  seconds: number;
  transcript: string;
  /** Palavras faladas na transcricao (ja contadas uma vez). */
  words: number;
  origin: MetricsAnalysisOrigin | null;
}

function hasLocalAudio(recording: Recording): boolean {
  return (
    Boolean(recording.filePath) ||
    recording.segmentCount > 0 ||
    Boolean(recording.contentType?.startsWith('audio/'))
  );
}

/**
 * Audios da nota com duracao e transcricao. Quando o servidor tem a pilha de
 * audios, ela manda; a transcricao local so preenche um audio unico sem
 * transcricao do servidor (caso de transcricao feita no aparelho e ainda nao
 * enviada).
 */
function computeAudioFacts(recording: Recording): AudioFact[] {
  const serverAudios = recording.serverAudios ?? [];
  if (serverAudios.length > 0) {
    const localText = (recording.transcript ?? '').trim();
    return serverAudios.map((audio) => {
      const serverText = (audio.transcript?.text ?? '').trim();
      const localFallback = !serverText && serverAudios.length === 1 ? localText : '';
      const transcript = serverText || localFallback;
      return {
        seconds:
          audio.duration_seconds || (serverAudios.length === 1 ? (recording.durationMs ?? 0) / 1000 : 0),
        transcript,
        words: transcript ? wordsOf(plainText(transcript)).length : 0,
        origin: transcript ? (localFallback ? (recording.transcriptOrigin ?? 'local') : 'server') : null,
      };
    });
  }

  if (!hasLocalAudio(recording)) return [];
  const transcript = (recording.transcript ?? '').trim();
  return [
    {
      seconds: (recording.durationMs ?? 0) / 1000,
      transcript,
      words: transcript ? wordsOf(plainText(transcript)).length : 0,
      origin: transcript ? (recording.transcriptOrigin ?? 'local') : null,
    },
  ];
}

const audioFactsCache = new WeakMap<Recording, AudioFact[]>();

/** Audios de uma nota; a transcricao so e tokenizada na primeira janela. */
function audioFacts(recording: Recording): AudioFact[] {
  const cached = audioFactsCache.get(recording);
  if (cached) return cached;
  const facts = computeAudioFacts(recording);
  audioFactsCache.set(recording, facts);
  return facts;
}

/** Transcricao para hash de conteudo: local primeiro, depois a do servidor. */
function transcriptText(recording: Recording): string {
  const local = (recording.transcript ?? '').trim();
  if (local) return local;
  return (recording.serverAudios ?? [])
    .map((audio) => (audio.transcript?.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

// --- Agregacao -------------------------------------------------------------

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface VoiceFacts extends WindowVoice {
  notesWithAudio: number;
  notesWithTranscript: number;
}

function voiceOf(recordings: Recording[], writingWords: number): VoiceFacts {
  let audioCount = 0;
  let audioSeconds = 0;
  let transcribedSeconds = 0;
  let transcribedCount = 0;
  let words = 0;
  let originLocal = 0;
  let originServer = 0;
  let notesWithAudio = 0;
  let notesWithTranscript = 0;

  for (const recording of recordings) {
    const facts = audioFacts(recording);
    if (facts.length > 0) notesWithAudio += 1;
    let noteTranscribed = false;
    for (const fact of facts) {
      audioCount += 1;
      audioSeconds += fact.seconds;
      if (!fact.transcript) continue;
      noteTranscribed = true;
      transcribedCount += 1;
      transcribedSeconds += fact.seconds;
      words += fact.words;
      if (fact.origin === 'local') originLocal += 1;
      else if (fact.origin === 'server') originServer += 1;
    }
    if (noteTranscribed) notesWithTranscript += 1;
  }

  const totalWords = writingWords + words;
  return {
    audioCount,
    audioMinutes: round1(audioSeconds / 60),
    transcribedMinutes: round1(transcribedSeconds / 60),
    coverage: audioSeconds > 0 ? transcribedSeconds / audioSeconds : 0,
    words,
    wordsPerMinute: transcribedSeconds > 0 ? round1(words / (transcribedSeconds / 60)) : 0,
    wordsPerAudio: transcribedCount > 0 ? round1(words / transcribedCount) : 0,
    originLocal,
    originServer,
    transcriptShare: totalWords > 0 ? words / totalWords : 0,
    notesWithAudio,
    notesWithTranscript,
  };
}

function imagesOf(recordings: Recording[], imageBytes?: Record<string, number>): WindowImages {
  let count = 0;
  let bytes = 0;
  let notesWithImage = 0;
  let notesWithImageNoText = 0;

  for (const recording of recordings) {
    const facts = noteTextFacts(recording);
    const images = facts.marks.images;
    if (images === 0) continue;
    count += images;
    notesWithImage += 1;
    bytes += imageBytes?.[recording.id] ?? 0;
    const hasTranscript = transcriptText(recording).length > 0;
    if (!facts.hasPlainText && !hasTranscript) notesWithImageNoText += 1;
  }

  return {
    count,
    bytesTotal: bytes,
    bytesAverage: count > 0 ? Math.round(bytes / count) : 0,
    perNote: recordings.length > 0 ? round2(count / recordings.length) : 0,
    notesWithImage,
    notesWithImageNoText,
  };
}

function latestAnalyses(analyses: AnalysisFact[] | undefined): Map<string, AnalysisFact> {
  const map = new Map<string, AnalysisFact>();
  for (const fact of analyses ?? []) {
    const key = fact.entryId.trim();
    if (!key) continue;
    const current = map.get(key);
    if (!current || (fact.createdAt ?? '') >= (current.createdAt ?? '')) map.set(key, fact);
  }
  return map;
}

function isStale(recording: Recording, fact: AnalysisFact): boolean {
  if (fact.origin === 'local' && fact.contentHash) {
    // Mesma base que o app usa hoje ao guardar a analise (titulo + corpo). A
    // transcricao ainda nao entra no hash; mudar isso exige versionar o hash
    // para nao marcar todas as analises antigas como desatualizadas.
    const current = analysisContentHash({
      title: (recording.title ?? '').trim(),
      text: recording.text ?? '',
    });
    return current !== fact.contentHash;
  }
  if (fact.origin === 'server' && fact.createdAt) {
    const updated = new Date(recording.updatedAt).getTime();
    const created = new Date(fact.createdAt).getTime();
    return Number.isFinite(updated) && Number.isFinite(created) && created < updated;
  }
  return false;
}

function analysisOf(recordings: Recording[], byEntry: Map<string, AnalysisFact>): WindowAnalysis {
  let notesWithContent = 0;
  let notesAnalyzed = 0;
  let stale = 0;
  let simplified = 0;
  let lastAnalyzedAt: string | null = null;

  for (const recording of recordings) {
    const facts = noteTextFacts(recording);
    const hasTranscript = transcriptText(recording).length > 0;
    if (!facts.hasPlainText && !hasTranscript) continue;
    notesWithContent += 1;

    const fact = byEntry.get(recording.entryId ?? recording.id);
    if (!fact) continue;
    notesAnalyzed += 1;
    if (fact.model === 'local-fallback') simplified += 1;
    if (isStale(recording, fact)) stale += 1;
    if (fact.createdAt && (!lastAnalyzedAt || fact.createdAt > lastAnalyzedAt)) {
      lastAnalyzedAt = fact.createdAt;
    }
  }

  return {
    notesWithContent,
    notesAnalyzed,
    coverage: notesWithContent > 0 ? notesAnalyzed / notesWithContent : 0,
    stale,
    simplified,
    lastAnalyzedAt,
  };
}

function rankedNames(
  recordings: Recording[],
  byEntry: Map<string, AnalysisFact>,
  pick: (fact: AnalysisFact) => string[] | undefined,
): RankedCount[] {
  const counts = new Map<string, RankedCount>();
  for (const recording of recordings) {
    const fact = byEntry.get(recording.entryId ?? recording.id);
    if (!fact) continue;
    const seen = new Set<string>();
    for (const raw of pick(fact) ?? []) {
      const label = raw.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const item = counts.get(key);
      if (item) item.count += 1;
      else counts.set(key, { label, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8);
}

function topicsOf(recordings: Recording[], byEntry: Map<string, AnalysisFact>): WindowTopics {
  return {
    themes: rankedNames(recordings, byEntry, (fact) => fact.themes),
    people: rankedNames(recordings, byEntry, (fact) => fact.people),
    places: rankedNames(recordings, byEntry, (fact) => fact.places),
  };
}

function normalizedLabel(label?: string): SentimentTone | null {
  const value = (label ?? '').trim().toLowerCase();
  if (value === 'positivo' || value === 'positive') return 'positive';
  if (value === 'negativo' || value === 'negative') return 'negative';
  if (value === 'neutro' || value === 'neutral') return 'neutral';
  return null;
}

function sentimentKind(score: number, label?: string): SentimentTone {
  return normalizedLabel(label) ?? (score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral');
}

interface Period {
  key: string;
  from: Date;
  to: Date;
}

function periodsOf(range: MetricsRange): { granularity: 'day' | 'week'; periods: Period[] } {
  if (range.kind === '365d') {
    const periods: Period[] = [];
    let cursor = startOfWeek(range.from);
    while (cursor.getTime() <= range.to.getTime()) {
      periods.push({ key: dayKey(cursor), from: cursor, to: addDays(cursor, 7) });
      cursor = addDays(cursor, 7);
    }
    return { granularity: 'week', periods };
  }

  const periods: Period[] = [];
  for (
    let cursor = startOfDay(range.from);
    cursor.getTime() <= range.to.getTime();
    cursor = addDays(cursor, 1)
  ) {
    periods.push({ key: dayKey(cursor), from: cursor, to: addDays(cursor, 1) });
  }
  return { granularity: 'day', periods };
}

interface SentimentEntry {
  date: Date;
  score: number;
  title: string;
}

function sentimentOf(
  recordings: Recording[],
  byEntry: Map<string, AnalysisFact>,
  range: MetricsRange,
): WindowSentiment {
  const { granularity, periods } = periodsOf(range);
  const analysisEntries: SentimentEntry[] = [];
  const lexicalEntries: SentimentEntry[] = [];
  const matchedFacts: AnalysisFact[] = [];

  for (const recording of recordings) {
    const facts = noteTextFacts(recording);
    if (facts.eventTime === null) continue;
    const date = new Date(facts.eventTime);
    const fact = byEntry.get(recording.entryId ?? recording.id);
    if (fact && Number.isFinite(fact.sentiment)) {
      matchedFacts.push(fact);
      analysisEntries.push({
        date,
        score: fact.sentiment,
        title: displayTitle(recording),
      });
      continue;
    }
    if (facts.words === 0) continue;
    lexicalEntries.push({
      date,
      score: facts.sentiment,
      title: displayTitle(recording),
    });
  }

  // Com qualquer analise na janela, a fonte e a analise: nao misturar com o
  // lexico local na mesma media.
  const source = analysisEntries.length > 0 ? 'analysis' : 'lexical';
  const entries = source === 'analysis' ? analysisEntries : lexicalEntries;

  const buckets = new Map<string, { sum: number; notes: number }>();
  let sum = 0;
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let topPositive: { title: string; score: number } | null = null;
  let topNegative: { title: string; score: number } | null = null;

  for (const entry of entries) {
    const kind = sentimentKind(entry.score);
    if (kind === 'positive') positive += 1;
    else if (kind === 'negative') negative += 1;
    else neutral += 1;
    if (entry.score > 0 && (!topPositive || entry.score > topPositive.score)) {
      topPositive = { title: entry.title, score: round2(entry.score) };
    }
    if (entry.score < 0 && (!topNegative || entry.score < topNegative.score)) {
      topNegative = { title: entry.title, score: round2(entry.score) };
    }
    sum += entry.score;

    const key =
      granularity === 'week'
        ? dayKey(startOfWeek(entry.date))
        : dayKey(entry.date);
    const bucket = buckets.get(key) ?? { sum: 0, notes: 0 };
    bucket.sum += entry.score;
    bucket.notes += 1;
    buckets.set(key, bucket);
  }

  const emotionStats = new Map<string, { count: number; sum: number }>();
  if (source === 'analysis') {
    for (const fact of matchedFacts) {
      if (!fact.emotions) continue;
      for (const [label, intensity] of Object.entries(fact.emotions)) {
        const name = label.trim();
        if (!name || !(intensity > 0)) continue;
        const stat = emotionStats.get(name) ?? { count: 0, sum: 0 };
        stat.count += 1;
        stat.sum += fact.sentiment;
        emotionStats.set(name, stat);
      }
    }
  }

  return {
    source,
    analyzed: entries.length,
    positive,
    neutral,
    negative,
    average: entries.length > 0 ? round2(sum / entries.length) : 0,
    topPositive,
    topNegative,
    emotions: [...emotionStats.entries()]
      .map(([label, stat]) => ({
        label,
        count: stat.count,
        tone: sentimentKind(stat.sum / stat.count),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 8),
    series: periods.map((period) => {
      const bucket = buckets.get(period.key);
      return {
        key: period.key,
        average: bucket && bucket.notes > 0 ? round2(bucket.sum / bucket.notes) : 0,
        notes: bucket?.notes ?? 0,
      };
    }),
    granularity,
  };
}

function computeWindow(input: MetricsInput, range: MetricsRange): WindowMetrics {
  const selected = input.recordings.filter((recording) => {
    const { eventTime } = noteTextFacts(recording);
    return eventTime !== null && inTimeRange(eventTime, range);
  });

  const base = analyzeWriting(selected, range.to);
  const voice = voiceOf(selected, base.words);
  const byEntry = latestAnalyses(input.analyses);

  return {
    window: range.kind,
    days: range.days,
    from: dayKey(range.from),
    to: dayKey(range.to),
    writing: {
      notes: selected.length,
      withText: base.withText,
      withAudio: voice.notesWithAudio,
      withTranscript: voice.notesWithTranscript,
      words: base.words,
      chars: base.chars,
      sentences: base.sentences,
      paragraphs: base.paragraphs,
      uniqueWords: base.uniqueWords,
      lexicalRichness: base.lexicalRichness,
      averageWordsPerNote: base.averageWordsPerNote,
      averageSentenceWords: base.averageSentenceWords,
      averageWordLength: base.averageWordLength,
      readingMinutes: round1(base.words / 200),
      topWords: base.topWords,
      longestWords: base.longestWords,
      questions: base.questions,
      exclamations: base.exclamations,
      links: base.links,
      images: base.images,
      listItems: base.listItems,
      activeDays: base.activeDays,
      averageNotesPerActiveDay: base.averageNotesPerActiveDay,
      notesPerWeek: round1(selected.length / (range.days / 7)),
      topWeekday: base.topWeekday,
      topHour: base.topHour,
      weekdayHour: base.weekdayHour,
      consistency: writingConsistency(selected, range.to, range.days),
      longestNote: base.longestNote,
    },
    voice: {
      audioCount: voice.audioCount,
      audioMinutes: voice.audioMinutes,
      transcribedMinutes: voice.transcribedMinutes,
      coverage: voice.coverage,
      words: voice.words,
      wordsPerMinute: voice.wordsPerMinute,
      wordsPerAudio: voice.wordsPerAudio,
      originLocal: voice.originLocal,
      originServer: voice.originServer,
      transcriptShare: voice.transcriptShare,
    },
    images: imagesOf(selected, input.imageBytes),
    analysis: analysisOf(selected, byEntry),
    sentiment: sentimentOf(selected, byEntry, range),
    topics: topicsOf(selected, byEntry),
    summary: [],
  };
}

// --- Frases do resumo ------------------------------------------------------

function formatInt(value: number): string {
  return value.toLocaleString('pt-BR');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function windowLabel(kind: MetricsWindow): string {
  return `${METRICS_WINDOW_DAYS[kind]} dias`;
}

function summarizeWindow(
  kind: MetricsWindow,
  current: WindowMetrics,
  previousWords: number,
  streak: MetricsStreak,
): string[] {
  const out: string[] = [];
  const writing = current.writing;

  if (writing.withText > 0) {
    let sentence = `Você escreveu ${formatInt(writing.words)} ${plural(
      writing.words,
      'palavra',
      'palavras',
    )} em ${writing.withText} ${plural(writing.withText, 'nota', 'notas')}`;
    const before = previousWords;
    if (before > 0) {
      const pct = Math.round(((writing.words - before) / before) * 100);
      if (pct >= 5) sentence += `, ${pct}% mais que nos ${windowLabel(kind)} anteriores`;
      else if (pct <= -5) {
        sentence += `, ${Math.abs(pct)}% menos que nos ${windowLabel(kind)} anteriores`;
      } else sentence += `, um ritmo parecido com os ${windowLabel(kind)} anteriores`;
    }
    out.push(`${sentence}.`);
  }

  if (current.voice.audioCount > 0 && out.length < 3) {
    const total = Math.max(1, Math.round(current.voice.audioMinutes));
    if (current.voice.coverage <= 0) {
      out.push(`Você gravou ${total} min; nenhum áudio foi transcrito ainda.`);
    } else if (current.voice.coverage >= 0.995) {
      out.push(`Você gravou ${total} min e transcreveu tudo.`);
    } else {
      out.push(`Você gravou ${total} min e transcreveu ${Math.max(1, Math.round(current.voice.transcribedMinutes))}.`);
    }
  }

  if (current.sentiment.analyzed > 0 && out.length < 3) {
    const { positive, negative, neutral, source } = current.sentiment;
    const basis = source === 'analysis' ? 'analisadas' : 'com texto';
    if (positive > negative && positive >= neutral) {
      out.push(`A maioria das notas ${basis} foi positiva.`);
    } else if (negative > positive && negative >= neutral) {
      out.push(`A maioria das notas ${basis} foi negativa.`);
    } else if (neutral > positive && neutral > negative) {
      out.push(`A maioria das notas ${basis} ficou neutra.`);
    } else {
      out.push(`As notas ${basis} ficaram divididas entre positivas e negativas.`);
    }
  }

  if (out.length < 3 && writing.activeDays > 0) {
    let sentence = `Você registrou notas em ${writing.activeDays} ${plural(
      writing.activeDays,
      'dia',
      'dias',
    )}`;
    if (streak.current > 1) sentence += ` e está há ${streak.current} dias seguidos`;
    out.push(`${sentence}.`);
  }

  return out.slice(0, 3);
}

/** Palavras escritas numa janela (o resumo so compara o volume anterior). */
function wordsIn(recordings: Recording[], range: MetricsRange): number {
  let words = 0;
  for (const recording of recordings) {
    const facts = noteTextFacts(recording);
    if (facts.eventTime === null || !inTimeRange(facts.eventTime, range)) continue;
    words += facts.words;
  }
  return words;
}

/**
 * Monta as tres janelas do Painel de uma vez. O mesmo `now` vale para todas,
 * para os numeros fecharem entre o resumo, as secoes e o snapshot.
 */
export function buildMetricsReport(input: MetricsInput): MetricsReport {
  const now = input.now ?? new Date();
  const streak = writingStreaks(input.recordings, now);
  const windows = {} as Record<MetricsWindow, WindowMetrics>;

  for (const kind of METRICS_WINDOWS) {
    const range = metricsRange(kind, now);
    const current = computeWindow(input, range);
    // A janela anterior so alimenta a frase de comparacao: montar o card
    // inteiro dela custava uma passada extra pela biblioteca toda.
    const previousWords = wordsIn(input.recordings, previousRange(range));
    current.summary = summarizeWindow(kind, current, previousWords, streak);
    windows[kind] = current;
  }

  return { generatedAt: now.toISOString(), streak, windows };
}

/**
 * Aquece os fatos de texto e de audio em blocos, cedendo a thread entre eles.
 *
 * O Painel chama isto antes de montar os cards: a primeira analise da biblioteca
 * deixa de bloquear o toque e o desenho, e as tres janelas seguintes ja leem o
 * cache.
 */
export async function warmMetricsFacts(
  recordings: Recording[],
  options: WarmFactsOptions = {},
): Promise<void> {
  const { batchSize = WARM_FACTS_BATCH, yieldToUI: yieldToUi = yieldToUI } = options;
  await warmWritingFacts(recordings, { batchSize, yieldToUI: yieldToUi });

  const missing = recordings.filter((recording) => !audioFactsCache.has(recording));
  const size = Math.max(1, batchSize);
  for (let index = 0; index < missing.length; index += 1) {
    audioFacts(missing[index]);
    const done = index + 1;
    if (done < missing.length && done % size === 0) await yieldToUi();
  }
}
