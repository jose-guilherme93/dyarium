/**
 * Notas do app. Uma nota tem titulo, texto e (opcionalmente) audio. O app e de
 * notas de audio e de texto: a nota de texto nao tem audio; o texto e enviado ao
 * servidor como conteudo (tratado como se fosse a transcricao) e marcado como
 * nota de texto. Puro e testavel.
 */

import type { Recording } from './types';

export interface TextNoteInput {
  id: string;
  title: string;
  text: string;
  /** Data do evento (ISO). Default: agora. */
  recordedAt?: string;
  now: Date;
}

/** Monta a nota de texto pronta para entrar na fila. */
export function buildTextNote(input: TextNoteInput): Recording {
  const iso = input.now.toISOString();
  const title = input.title.trim() || 'Nota';
  const text = input.text.trim();
  return {
    id: input.id,
    title,
    recordedAt: input.recordedAt ?? iso,
    dir: '',
    segmentCount: 0,
    status: 'queued',
    offset: 0,
    attempts: 0,
    source: 'text',
    text,
    // O texto ja e o conteudo: nao ha transcricao a esperar.
    transcript: text,
    transcriptStatus: 'ready',
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Monta um rascunho de nota (ainda sem conteudo; nao entra na fila). */
export function buildDraftNote(input: { id: string; now: Date }): Recording {
  const iso = input.now.toISOString();
  return {
    id: input.id,
    title: '',
    recordedAt: iso,
    dir: '',
    segmentCount: 0,
    status: 'draft',
    offset: 0,
    attempts: 0,
    source: 'text',
    text: '',
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Uma nota tem conteudo quando tem audio ou texto nao vazio. */
export function noteHasContent(note: Recording): boolean {
  return Boolean(note.filePath) || Boolean(note.text && note.text.trim().length > 0);
}

/**
 * Rascunho ainda em branco (sem audio, sem texto e sem titulo): existe no banco,
 * mas nao aparece na lista — o usuario nao deve ver "nota vazia" antes de escrever.
 */
export function isBlankDraft(note: Recording): boolean {
  return (
    note.status === 'draft' &&
    !note.filePath &&
    !(note.title ?? '').trim() &&
    !(note.text ?? '').trim()
  );
}
