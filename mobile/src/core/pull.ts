/**
 * Monta a nota local a partir de uma entrada (e da sua nota) vindas do servidor.
 * Puro: concentra o mapeamento para testar sem rede nem banco.
 */

import { blocksToMarkdown, type Block } from './blocks';
import type { ServerEntry, ServerNote } from './api';
import type { Recording, RecordingSource } from './types';

function toSource(contentType: string): RecordingSource {
  return contentType ? 'microphone' : 'text';
}

/** Converte o documento de blocos da nota em markdown do app. */
export function documentToMarkdown(document: unknown): string {
  if (!Array.isArray(document)) return '';
  return blocksToMarkdown(document as Block[]);
}

/**
 * Entrada sem nada (sem titulo, sem audio e sem corpo): nao vale trazer para o
 * app. Evita que entradas vazias (criadas em background) apareçam como notas.
 */
export function isBlankServerEntry(entry: ServerEntry, note?: ServerNote): boolean {
  return (
    entry.title.trim() === '' &&
    entry.content_type === '' &&
    documentToMarkdown(note?.document).trim() === ''
  );
}

/**
 * Notas locais que o servidor confirmou como apagadas (estao na lixeira dele).
 *
 * Duas travas contra perder dado:
 * - A ausencia na lista de entradas NAO basta: se o servidor for reinstalado, ou
 *   o banco voltar de um backup antigo, tudo pareceria apagado e o app limparia o
 *   aparelho inteiro. So apagamos o que o servidor diz que apagou.
 * - A exclusao precisa ser mais nova que a ultima mudanca local. Uma nota
 *   restaurada de um backup (`updatedAt` = agora) sobrevive a uma exclusao
 *   anterior a ela, mesmo que o app esteja offline e ainda nao tenha reafirmado a
 *   nota no servidor.
 */
export function recordingsDeletedOnServer(
  local: Recording[],
  deletedAt: Map<string, string>,
): Recording[] {
  return local.filter((recording) => {
    if (recording.status !== 'completed' || !recording.entryId) return false;
    const deleted = deletedAt.get(recording.entryId);
    if (!deleted) return false;
    const deletedTime = Date.parse(deleted);
    const localTime = Date.parse(recording.updatedAt);
    if (Number.isNaN(deletedTime) || Number.isNaN(localTime)) return false;
    return deletedTime > localTime;
  });
}

export function entryToRecording(entry: ServerEntry, note?: ServerNote): Recording {
  return {
    id: entry.id,
    title: entry.title,
    recordedAt: entry.recorded_at ?? entry.created_at,
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    entryId: entry.id,
    noteId: note?.id,
    source: toSource(entry.content_type),
    contentType: entry.content_type || undefined,
    transcriptStatus: entry.content_type ? 'pending' : undefined,
    text: note ? documentToMarkdown(note.document) : '',
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}
