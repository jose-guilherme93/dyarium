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
