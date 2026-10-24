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
 *
 * Nota sem titulo paga `markdownToPlain` no corpo inteiro, e o card, a busca, o
 * menu e as metricas pedem o mesmo titulo varias vezes para o mesmo objeto. A
 * biblioteca troca o objeto quando qualquer campo muda, entao o WeakMap por
 * identidade devolve o valor ja calculado e se invalida sozinho.
 */
const titleCache = new WeakMap<object, string>();

export function displayTitle(recording: {
  title?: string;
  text?: string;
  transcript?: string;
}): string {
  const cached = titleCache.get(recording);
  if (cached !== undefined) return cached;
  const title = (recording.title ?? '').trim();
  const value =
    title ||
    firstLine(recording.text ?? '') ||
    firstLine(recording.transcript ?? '') ||
    'Sem título';
  titleCache.set(recording, value);
  return value;
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
