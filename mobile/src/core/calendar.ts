import { noteDateIso } from './format';

/** Nomes dos meses, do calendario. */
export const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** Rotulos curtos das colunas, comecando na segunda. */
export const WEEKDAY_LABELS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'] as const;

export interface CalendarCell {
  /** "2026-11-13" no fuso do aparelho. */
  key: string;
  year: number;
  /** 0-11, como em Date. */
  month: number;
  day: number;
  /** Dia que pertence ao mes vizinho; aparece apagado e nao abre. */
  out: boolean;
  weekend: boolean;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Chave do dia no fuso do aparelho. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Chave do dia de uma nota; vazio quando a data nao existe. */
export function noteDayKey(note: { recordedAt?: string; createdAt?: string }): string {
  const iso = noteDateIso(note);
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return dayKey(date);
}

/** Hora da nota ("08:40"), no fuso do aparelho. */
export function noteTimeLabel(note: { recordedAt?: string; createdAt?: string }): string {
  const iso = noteDateIso(note);
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Grade do mes, com as semanas comecando na segunda.
 *
 * Sempre fecha semanas inteiras: o primeiro e o ultimo quadrado podem ser de
 * outro mes, e o chamador os desenha apagados.
 */
export function monthCells(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + days) / 7);
  const cells: CalendarCell[] = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    const date = new Date(year, month, index - offset + 1);
    cells.push({
      key: dayKey(date),
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      out: date.getMonth() !== month,
      weekend: date.getDay() === 0 || date.getDay() === 6,
    });
  }
  return cells;
}

/**
 * Notas por dia. A data e a do evento (recordedAt), com createdAt como reserva:
 * a mesma regra do servidor e do dashboard.
 */
export function groupNotesByDay<T extends { recordedAt?: string; createdAt?: string }>(
  notes: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const note of notes) {
    const key = noteDayKey(note);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(note);
    else map.set(key, [note]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => noteDateIso(a).localeCompare(noteDateIso(b)));
  }
  return map;
}

/** Notas do mesmo dia e mes em outros anos, o mais recente primeiro. */
export function notesInOtherYears<T extends { recordedAt?: string; createdAt?: string }>(
  notes: T[],
  day: string,
): { year: string; notes: T[] }[] {
  const monthDay = day.slice(5);
  const year = day.slice(0, 4);
  const groups = new Map<string, T[]>();
  for (const note of notes) {
    const key = noteDayKey(note);
    if (!key || key.slice(5) !== monthDay || key.slice(0, 4) === year) continue;
    const groupYear = key.slice(0, 4);
    const list = groups.get(groupYear);
    if (list) list.push(note);
    else groups.set(groupYear, [note]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([groupYear, list]) => ({
      year: groupYear,
      notes: [...list].sort((a, b) => noteDateIso(a).localeCompare(noteDateIso(b))),
    }));
}
