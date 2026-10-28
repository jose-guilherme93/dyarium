/**
 * Ordem da lista de notas.
 *
 * Vale a **data de criacao da nota no app** (`createdAt`), nao a data do evento
 * nem a ultima edicao: a lista precisa ficar estavel enquanto o usuario edita
 * uma nota antiga. Puro e testavel.
 */

import type { Recording } from './types';

export type NoteOrder = 'newest' | 'oldest';

export const DEFAULT_NOTE_ORDER: NoteOrder = 'newest';

export function normalizeNoteOrder(value: unknown): NoteOrder {
  return value === 'oldest' ? 'oldest' : DEFAULT_NOTE_ORDER;
}

/** Ordena por criacao; o id desempata para a lista nunca "pular" entre renders. */
export function sortByCreation(notes: Recording[], order: NoteOrder): Recording[] {
  const direction = order === 'oldest' ? 1 : -1;
  return [...notes].sort((a, b) => {
    const byDate = a.createdAt.localeCompare(b.createdAt);
    if (byDate !== 0) return byDate * direction;
    return a.id.localeCompare(b.id) * direction;
  });
}
