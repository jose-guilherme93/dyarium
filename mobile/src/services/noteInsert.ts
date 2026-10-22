/**
 * Insercao pendente entre a tela da nota e a tela de gravacao.
 *
 * A gravacao acontece em outra tela: o audio so existe depois que o usuario
 * volta. A posicao onde ele entra precisa sobreviver a essa ida e volta.
 *
 * A posicao cabe em dois valores (o no de texto e o offset do cursor), entao
 * ela viaja guardada por nota, e a rota da gravacao leva so o id da nota.
 *
 * O estado e de tela, nao de dado: se o app morrer no meio da gravacao, a
 * insercao se perde junto com a gravacao (que o app ja trata como
 * interrompida). Nada fica gravado no corpo da nota, entao nao ha marcador
 * orfao para limpar na proxima abertura.
 */

import type { NoteInsertPosition } from '@/components/noteBodyTypes';

const pending = new Map<string, NoteInsertPosition>();

/** Guarda a posicao da insercao para a nota. */
export function setPendingInsert(noteId: string, position: NoteInsertPosition): void {
  pending.set(noteId, position);
}

/** Pega a posicao guardada e limpa o registro. */
export function takePendingInsert(noteId: string): NoteInsertPosition | null {
  const position = pending.get(noteId) ?? null;
  pending.delete(noteId);
  return position;
}

/** Descarta a posicao guardada, sem usá-la. */
export function clearPendingInsert(noteId: string): void {
  pending.delete(noteId);
}
