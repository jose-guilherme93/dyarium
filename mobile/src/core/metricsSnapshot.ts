/**
 * Snapshot das metricas de escrita: o documento pronto que o app envia ao
 * servidor (e que o painel web mostra igual ao Painel do app).
 *
 * Puro e testavel: recebe as notas e devolve o JSON do contrato. O envelope
 * (`device_id`, `device_name`) e do servico; aqui vive so o conteudo versionado.
 * Chaves em snake_case para casar com o resto da API.
 */

import type { WordCount } from './writing';
import { analyzeWriting, writingHistory } from './writing';
import type { Recording } from './types';

/** Versao do contrato. Mudanca de forma (nao de valor) sobe esta versao. */
export const METRICS_SCHEMA = 1;

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

export interface SnapshotSentiment {
  analyzed: number;
  average: number;
  positive: number;
  neutral: number;
  negative: number;
  top_positive: { title: string; score: number } | null;
  top_negative: { title: string; score: number } | null;
}

/** Metricas de escrita (o corpo das notas) e o retrato do habito. */
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
  top_words: SnapshotWordCount[];
  longest_words: SnapshotWordCount[];

  questions: number;
  exclamations: number;
  links: number;
  images: number;
  list_items: number;

  transcript_words: number;
  average_transcript_words: number;

  active_days: number;
  average_notes_per_active_day: number;
  current_streak: number;
  longest_streak: number;
  wrote_today: boolean;
  top_weekday: SnapshotWordCount | null;
  top_hour: SnapshotWordCount | null;
  first_at: string | null;
  last_at: string | null;
  longest_note: { title: string; words: number } | null;

  monthly: SnapshotSeriesPoint[];
  month_comparison_pct: number | null;
  sentiment: SnapshotSentiment;
  /** Grade 7 (domingo..sabado) x 8 faixas de 3h: notas por faixa. */
  weekday_hour: number[][];
  consistency: {
    days: SnapshotConsistencyDay[];
    written_days: number;
    tracked_days: number;
    rate: number;
    longest_run: number;
  };
  insights: string[];
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
  writing: SnapshotWriting;
  history: SnapshotHistory;
}

function words(items: WordCount[]): SnapshotWordCount[] {
  return items.map((item) => ({ label: item.label, value: item.value }));
}

/**
 * Monta o snapshot a partir das notas. Deterministico para a mesma entrada e
 * `now`: e o que permite testar sem rede nem banco.
 */
export function buildMetricsSnapshot(
  recordings: Recording[],
  now: Date = new Date(),
): MetricsSnapshot {
  const metrics = analyzeWriting(recordings, now);
  const history = writingHistory(recordings, now);

  return {
    schema: METRICS_SCHEMA,
    generated_at: now.toISOString(),
    writing: {
      notes: metrics.notes,
      with_text: metrics.withText,
      with_audio: metrics.withAudio,
      with_transcript: metrics.withTranscript,
      words: metrics.words,
      chars: metrics.chars,
      sentences: metrics.sentences,
      paragraphs: metrics.paragraphs,
      unique_words: metrics.uniqueWords,
      lexical_richness: metrics.lexicalRichness,
      average_words_per_note: metrics.averageWordsPerNote,
      average_sentence_words: metrics.averageSentenceWords,
      average_word_length: metrics.averageWordLength,
      top_words: words(metrics.topWords),
      longest_words: words(metrics.longestWords),
      questions: metrics.questions,
      exclamations: metrics.exclamations,
      links: metrics.links,
      images: metrics.images,
      list_items: metrics.listItems,
      transcript_words: metrics.transcriptWords,
      average_transcript_words: metrics.averageTranscriptWords,
      active_days: metrics.activeDays,
      average_notes_per_active_day: metrics.averageNotesPerActiveDay,
      current_streak: metrics.currentStreak,
      longest_streak: metrics.longestStreak,
      wrote_today: metrics.wroteToday,
      top_weekday: metrics.topWeekday ? { label: metrics.topWeekday.label, value: metrics.topWeekday.value } : null,
      top_hour: metrics.topHour ? { label: metrics.topHour.label, value: metrics.topHour.value } : null,
      first_at: metrics.firstAt,
      last_at: metrics.lastAt,
      longest_note: metrics.longestNote
        ? { title: metrics.longestNote.title, words: metrics.longestNote.words }
        : null,
      monthly: metrics.monthly.map((month) => ({
        label: month.label,
        words: month.words,
        notes: month.notes,
      })),
      month_comparison_pct: metrics.monthComparisonPct,
      sentiment: {
        analyzed: metrics.sentiment.analyzed,
        average: metrics.sentiment.average,
        positive: metrics.sentiment.positive,
        neutral: metrics.sentiment.neutral,
        negative: metrics.sentiment.negative,
        top_positive: metrics.sentiment.topPositive,
        top_negative: metrics.sentiment.topNegative,
      },
      weekday_hour: metrics.weekdayHour,
      consistency: {
        days: metrics.consistency.days.map((day) => ({
          key: day.key,
          wrote: day.wrote,
          notes: day.notes,
          words: day.words,
        })),
        written_days: metrics.consistency.writtenDays,
        tracked_days: metrics.consistency.trackedDays,
        rate: metrics.consistency.rate,
        longest_run: metrics.consistency.longestRun,
      },
      insights: metrics.insights,
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
