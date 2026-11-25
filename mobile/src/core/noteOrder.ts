/**
 * Ordem da lista de notas.
 *
 * Vale a **data da nota** (`recordedAt`, com `createdAt` de reserva), nao a
 * ultima edicao: nota importada do Notion ou audio gravado antes guarda em
 * `recordedAt` a data original, e e essa data que a linha mostra. Ordenar por
 * `createdAt` (o dia em que a nota nasceu no app) esconderia a data real.
 * Puro e testavel.
 */

import { noteDateIso } from './format';
import type { Recording } from './types';

export type NoteOrder = 'newest' | 'oldest';

export const DEFAULT_NOTE_ORDER: NoteOrder = 'newest';

export function normalizeNoteOrder(value: unknown): NoteOrder {
  return value === 'oldest' ? 'oldest' : DEFAULT_NOTE_ORDER;
}

/** Milissegundos da data da nota; data ilegivel vai para o fim da lista. */
function noteTime(note: Recording): number {
  const time = new Date(noteDateIso(note)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Ordena pela data da nota; o id desempata para a lista nunca "pular" entre renders. */
export function sortByNoteDate(notes: Recording[], order: NoteOrder): Recording[] {
  const direction = order === 'oldest' ? 1 : -1;
  return [...notes].sort((a, b) => {
    const byDate = noteTime(a) - noteTime(b);
    if (byDate !== 0) return byDate * direction;
    return a.id.localeCompare(b.id) * direction;
  });
}
