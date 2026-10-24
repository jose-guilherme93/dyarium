/**
 * Snapshot das metricas para o servidor e para o painel web: o documento pronto
 * que o app envia (contrato versionado em docs/api.md e docs/metricas.md).
 *
 * Puro e testavel: recebe as notas e devolve o JSON do contrato. O envelope
 * (`device_id`, `device_name`) e do servico; aqui vive so o conteudo versionado.
 * Chaves em snake_case para casar com o resto da API.
 *
 * Schema 2: as tres janelas (7d/30d/365d) vao prontas. O web escolhe a janela e
 * desenha, sem recalcular nada, para os numeros baterem com o app.
 */

import {
  buildMetricsReport,
  type AnalysisFact,
  type MetricsReport,
  type MetricsWindow,
  type SentimentTone,
  type WindowAnalysis,
  type WindowImages,
  type WindowMetrics,
  type WindowSentiment,
  type WindowVoice,
  type WindowWriting,
} from './metrics';
import type { Recording } from './types';
import { writingHistory, type WordCount, type WritingHistory } from './writing';

/** Versao do contrato. Mudanca de forma (nao de valor) sobe esta versao. */
export const METRICS_SCHEMA = 2;

export interface SnapshotWordCount {
  label: string;
  value: number;
}

export interface SnapshotSeriesPoint {
  label: string;
  words: number;
  notes: number;
}

export interface SnapshotDayCell {
  key: string | null;
  words: number;
  notes: number;
}

export interface SnapshotConsistencyDay {
  key: string;
  wrote: boolean;
  notes: number;
  words: number;
}

export interface SnapshotEmotion {
  label: string;
  count: number;
  tone: SentimentTone;
}

export interface SnapshotConsistency {
  days: SnapshotConsistencyDay[];
  written_days: number;
  tracked_days: number;
  rate: number;
  longest_run: number;
}

/** Escrita dentro de uma janela. */
export interface SnapshotWriting {
  notes: number;
  with_text: number;
  with_audio: number;
  with_transcript: number;

  words: number;
  chars: number;
  sentences: number;
  paragraphs: number;
  unique_words: number;
  lexical_richness: number;
  average_words_per_note: number;
  average_sentence_words: number;
  average_word_length: number;
  reading_minutes: number;

  top_words: SnapshotWordCount[];
  longest_words: SnapshotWordCount[];
  questions: number;
  exclamations: number;
  links: number;
  images: number;
  list_items: number;

  active_days: number;
  average_notes_per_active_day: number;
  notes_per_week: number;
  top_weekday: SnapshotWordCount | null;
  top_hour: SnapshotWordCount | null;
  weekday_hour: number[][];
  consistency: SnapshotConsistency;
  longest_note: { title: string; words: number } | null;
}

export interface SnapshotVoice {
  audio_count: number;
  audio_minutes: number;
  transcribed_minutes: number;
  coverage: number;
  words: number;
  words_per_minute: number;
  words_per_audio: number;
  origin_local: number;
  origin_server: number;
  transcript_share: number;
}

export interface SnapshotImages {
  count: number;
  bytes_total: number;
  bytes_average: number;
  per_note: number;
  notes_with_image: number;
  notes_with_image_no_text: number;
}

export interface SnapshotAnalysis {
  notes_with_content: number;
  notes_analyzed: number;
  coverage: number;
  stale: number;
  simplified: number;
  last_analyzed_at: string | null;
}

export interface SnapshotRankedCount {
  label: string;
  count: number;
}

export interface SnapshotTopics {
  themes: SnapshotRankedCount[];
  people: SnapshotRankedCount[];
  places: SnapshotRankedCount[];
}

export interface SnapshotSentiment {
  source: 'analysis' | 'lexical';
  analyzed: number;
  positive: number;
  neutral: number;
  negative: number;
  average: number;
  top_positive: { title: string; score: number } | null;
  top_negative: { title: string; score: number } | null;
  emotions: SnapshotEmotion[];
  series: { key: string; average: number; notes: number }[];
  granularity: 'day' | 'week';
}

export interface SnapshotWindow {
  from: string;
  to: string;
  writing: SnapshotWriting;
  voice: SnapshotVoice;
  images: SnapshotImages;
  analysis: SnapshotAnalysis;
  sentiment: SnapshotSentiment;
  topics: SnapshotTopics;
  summary: string[];
}

export interface SnapshotStreak {
  current: number;
  longest: number;
  wrote_today: boolean;
}

/** Series do historico, para os graficos do painel. */
export interface SnapshotHistory {
  weekly: SnapshotSeriesPoint[];
  /** Colunas (semanas) de 7 dias, de domingo a sabado. */
  calendar: SnapshotDayCell[][];
  max_weekly: number;
  max_daily: number;
}

export interface MetricsSnapshot {
  schema: number;
  generated_at: string;
  streak: SnapshotStreak;
  windows: Record<MetricsWindow, SnapshotWindow>;
  history: SnapshotHistory;
}

function words(items: WordCount[]): SnapshotWordCount[] {
  return items.map((item) => ({ label: item.label, value: item.value }));
}

function snapshotWriting(writing: WindowWriting): SnapshotWriting {
  return {
    notes: writing.notes,
    with_text: writing.withText,
    with_audio: writing.withAudio,
    with_transcript: writing.withTranscript,
    words: writing.words,
    chars: writing.chars,
    sentences: writing.sentences,
    paragraphs: writing.paragraphs,
    unique_words: writing.uniqueWords,
    lexical_richness: writing.lexicalRichness,
    average_words_per_note: writing.averageWordsPerNote,
    average_sentence_words: writing.averageSentenceWords,
    average_word_length: writing.averageWordLength,
    reading_minutes: writing.readingMinutes,
    top_words: words(writing.topWords),
    longest_words: words(writing.longestWords),
    questions: writing.questions,
    exclamations: writing.exclamations,
    links: writing.links,
    images: writing.images,
    list_items: writing.listItems,
    active_days: writing.activeDays,
    average_notes_per_active_day: writing.averageNotesPerActiveDay,
    notes_per_week: writing.notesPerWeek,
    top_weekday: writing.topWeekday ? { label: writing.topWeekday.label, value: writing.topWeekday.value } : null,
    top_hour: writing.topHour ? { label: writing.topHour.label, value: writing.topHour.value } : null,
    weekday_hour: writing.weekdayHour,
    consistency: {
      days: writing.consistency.days.map((day) => ({
        key: day.key,
        wrote: day.wrote,
        notes: day.notes,
        words: day.words,
      })),
      written_days: writing.consistency.writtenDays,
      tracked_days: writing.consistency.trackedDays,
      rate: writing.consistency.rate,
      longest_run: writing.consistency.longestRun,
    },
    longest_note: writing.longestNote
      ? { title: writing.longestNote.title, words: writing.longestNote.words }
      : null,
  };
}

function snapshotVoice(voice: WindowVoice): SnapshotVoice {
  return {
    audio_count: voice.audioCount,
    audio_minutes: voice.audioMinutes,
    transcribed_minutes: voice.transcribedMinutes,
    coverage: voice.coverage,
    words: voice.words,
    words_per_minute: voice.wordsPerMinute,
    words_per_audio: voice.wordsPerAudio,
    origin_local: voice.originLocal,
    origin_server: voice.originServer,
    transcript_share: voice.transcriptShare,
  };
}

function snapshotImages(images: WindowImages): SnapshotImages {
  return {
    count: images.count,
    bytes_total: images.bytesTotal,
    bytes_average: images.bytesAverage,
    per_note: images.perNote,
    notes_with_image: images.notesWithImage,
    notes_with_image_no_text: images.notesWithImageNoText,
  };
}

function snapshotAnalysis(analysis: WindowAnalysis): SnapshotAnalysis {
  return {
    notes_with_content: analysis.notesWithContent,
    notes_analyzed: analysis.notesAnalyzed,
    coverage: analysis.coverage,
    stale: analysis.stale,
    simplified: analysis.simplified,
    last_analyzed_at: analysis.lastAnalyzedAt,
  };
}

function snapshotSentiment(sentiment: WindowSentiment): SnapshotSentiment {
  return {
    source: sentiment.source,
    analyzed: sentiment.analyzed,
    positive: sentiment.positive,
    neutral: sentiment.neutral,
    negative: sentiment.negative,
    average: sentiment.average,
    top_positive: sentiment.topPositive,
    top_negative: sentiment.topNegative,
    emotions: sentiment.emotions.map((emotion) => ({
      label: emotion.label,
      count: emotion.count,
      tone: emotion.tone,
    })),
    series: sentiment.series.map((point) => ({
      key: point.key,
      average: point.average,
      notes: point.notes,
    })),
    granularity: sentiment.granularity,
  };
}

function snapshotTopics(metrics: WindowMetrics): SnapshotTopics {
  return {
    themes: metrics.topics.themes.map((item) => ({ label: item.label, count: item.count })),
    people: metrics.topics.people.map((item) => ({ label: item.label, count: item.count })),
    places: metrics.topics.places.map((item) => ({ label: item.label, count: item.count })),
  };
}

function snapshotWindow(metrics: WindowMetrics): SnapshotWindow {
  return {
    from: metrics.from,
    to: metrics.to,
    writing: snapshotWriting(metrics.writing),
    voice: snapshotVoice(metrics.voice),
    images: snapshotImages(metrics.images),
    analysis: snapshotAnalysis(metrics.analysis),
    sentiment: snapshotSentiment(metrics.sentiment),
    topics: snapshotTopics(metrics),
    summary: metrics.summary,
  };
}

/**
 * Monta o documento a partir das notas. Deterministico para a mesma entrada e
 * `now`: e o que permite testar sem rede nem banco.
 */
export function buildMetricsSnapshot(
  recordings: Recording[],
  now: Date = new Date(),
  analyses: AnalysisFact[] = [],
  imageBytes: Record<string, number> = {},
): MetricsSnapshot {
  return buildMetricsSnapshotFromReport(
    buildMetricsReport({ recordings, analyses, imageBytes, now }),
    writingHistory(recordings, now),
  );
}

/**
 * O mesmo documento, a partir das contas que o Painel ja fez.
 *
 * E o que mantem a regra do contrato: a tela monta uma vez, com um unico `now`,
 * e usa o mesmo documento no Painel e no upload. Sem isto o sync recalculava a
 * biblioteca inteira de novo na abertura do Painel.
 */
export function buildMetricsSnapshotFromReport(
  report: MetricsReport,
  history: WritingHistory,
): MetricsSnapshot {
  return {
    schema: METRICS_SCHEMA,
    generated_at: report.generatedAt,
    streak: {
      current: report.streak.current,
      longest: report.streak.longest,
      wrote_today: report.streak.wroteToday,
    },
    windows: {
      '7d': snapshotWindow(report.windows['7d']),
      '30d': snapshotWindow(report.windows['30d']),
      '365d': snapshotWindow(report.windows['365d']),
    },
    history: {
      weekly: history.weekly.map((week) => ({
        label: week.label,
        words: week.words,
        notes: week.notes,
      })),
      calendar: history.calendar.map((column) =>
        column.map((cell) => ({ key: cell.key, words: cell.words, notes: cell.notes })),
      ),
      max_weekly: history.maxWeekly,
      max_daily: history.maxDaily,
    },
  };
}
