/**
 * Humor do mapa, calculado no aparelho.
 *
 * O web busca a serie no servidor (`GET /mood`); aqui a serie sai das analises
 * ja guardadas: media do tom por dia e quantas notas entraram na media. Nenhuma
 * chamada de rede.
 */

import type { GraphEntry } from './graphModel';

export interface MoodPoint {
  /** `YYYY-MM-DD` no fuso do aparelho. */
  date: string;
  sentiment: number;
  notes: number;
}

/** Dia local de uma nota, sem depender do fuso do ISO. */
export function localDay(iso: string): string {
  // Data sem hora ja e um dia: `new Date` a interpretaria como meia-noite UTC
  // e, a oeste de Greenwich, o dia voltaria um.
  const dayOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(iso.trim());
  if (dayOnly) return dayOnly[1];
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildMoodSeries(entries: GraphEntry[]): MoodPoint[] {
  const days = new Map<string, { sum: number; notes: number }>();
  for (const entry of entries) {
    const score = entry.sentiment ?? entry.analysis?.sentiment;
    if (typeof score !== 'number' || Number.isNaN(score)) continue;
    const day = localDay(entry.recordedAt);
    const current = days.get(day) ?? { sum: 0, notes: 0 };
    current.sum += score;
    current.notes += 1;
    days.set(day, current);
  }
  return [...days.entries()]
    .map(([date, value]) => ({
      date,
      sentiment: value.sum / value.notes,
      notes: value.notes,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Tom medio da serie, ponderado pelas notas. */
export function averageMood(series: MoodPoint[]): { sentiment: number; notes: number } {
  let sum = 0;
  let notes = 0;
  for (const point of series) {
    sum += point.sentiment * point.notes;
    notes += point.notes;
  }
  return { sentiment: notes > 0 ? sum / notes : 0, notes };
}
