/**
 * Titulo da nota: data e hora do inicio da gravacao, no fuso local.
 * Formato: "dd/MM/yyyy HH:mm" (pt-BR).
 */

import { markdownToPlain } from './richText';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Primeira linha nao vazia do texto (sem marcadores de markdown). */
function firstLine(value: string): string {
  const line = markdownToPlain(value)
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? '';
}

/**
 * Titulo exibido na lista: o titulo do usuario; quando vazio, a primeira linha
 * do texto (ou da transcricao) serve de titulo temporario.
 */
export function displayTitle(recording: {
  title?: string;
  text?: string;
  transcript?: string;
}): string {
  const title = (recording.title ?? '').trim();
  if (title) return title;
  return firstLine(recording.text ?? '') || firstLine(recording.transcript ?? '') || 'Sem título';
}

export function formatTitle(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Inicio da gravacao em ISO 8601 UTC, como o servidor espera. */
export function toRecordedAt(date: Date): string {
  return date.toISOString();
}
