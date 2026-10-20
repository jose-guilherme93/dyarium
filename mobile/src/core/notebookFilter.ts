/**
 * Filtros e agrupamentos da biblioteca. Puro para testar sem SQLite nem telas.
 * A data canonica e sempre `recordedAt`; `updatedAt` so ordena "recentes".
 */

import { isBlankDraft } from './note';
import { DEFAULT_NOTEBOOK_ID } from './notebooks';
import type { Recording } from './types';

export interface NoteFilter {
  /** `null`/ausente = todos os cadernos (modo Recentes). */
  notebookId?: string | null;
  /** Todas as tags precisam estar presentes (E). */
  tags?: string[];
  query?: string;
}

export function recordingNotebookId(recording: Recording): string {
  return recording.notebookId || DEFAULT_NOTEBOOK_ID;
}

export function noteMatches(recording: Recording, filter: NoteFilter): boolean {
  if (filter.notebookId && recordingNotebookId(recording) !== filter.notebookId) return false;
  const wanted = (filter.tags ?? []).map((tag) => tag.toLowerCase());
  if (wanted.length > 0) {
    const present = new Set((recording.tags ?? []).map((tag) => tag.toLowerCase()));
    if (wanted.some((tag) => !present.has(tag))) return false;
  }
  const term = (filter.query ?? '').trim().toLowerCase();
  if (!term) return true;
  return (
    recording.title.toLowerCase().includes(term) ||
    (recording.text ?? '').toLowerCase().includes(term) ||
    (recording.transcript ?? '').toLowerCase().includes(term) ||
    (recording.tags ?? []).some((tag) => tag.toLowerCase().includes(term))
  );
}

/** Notas ativas e nao vazias de um caderno, ja filtradas. */
export function notesInNotebook(
  recordings: Recording[],
  filter: NoteFilter,
): Recording[] {
  return recordings.filter(
    (recording) =>
      !recording.archived &&
      isVisibleNote(recording) &&
      noteMatches(recording, filter),
  );
}

/**
 * Nota que deve aparecer na biblioteca. So o rascunho *vazio* some: um rascunho
 * com audio, texto ou titulo e uma nota de verdade e nao pode ficar invisivel
 * se o fluxo de gravacao falhar antes de submeter.
 */
export function isVisibleNote(recording: Recording): boolean {
  return !isBlankDraft(recording) && !isBlank(recording);
}

function isBlank(recording: Recording): boolean {
  return (
    recording.title.trim() === '' &&
    (recording.text ?? '').trim() === '' &&
    !recording.filePath &&
    !recording.entryId
  );
}

/**
 * Busca global: todos os cadernos, incluindo arquivadas (que aparecem com a
 * etiqueta no card). O termo casa titulo, corpo, transcricao e nome de tag.
 */
export function searchRecordings(recordings: Recording[], query: string): Recording[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return recordings
    .filter(
      (recording) =>
        isVisibleNote(recording) &&
        (recording.title.toLowerCase().includes(term) ||
          (recording.text ?? '').toLowerCase().includes(term) ||
          (recording.transcript ?? '').toLowerCase().includes(term) ||
          (recording.tags ?? []).some((tag) => tag.toLowerCase().includes(term))),
    )
    .sort((a, b) => noteDate(b).localeCompare(noteDate(a)));
}

function noteDate(recording: Recording): string {
  return recording.recordedAt || recording.createdAt;
}

/**
 * Modo Recentes: notas ativas de todos os cadernos, da edicao mais nova para a
 * mais antiga. Nao e uma "secao" acima da linha do tempo; e a propria lista.
 */
export function recentNotes(
  recordings: Recording[],
  filter: Pick<NoteFilter, 'tags' | 'query'> = {},
): Recording[] {
  return recordings
    .filter(
      (recording) =>
        !recording.archived &&
        isVisibleNote(recording) &&
        noteMatches(recording, { ...filter, notebookId: null }),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Contagem de tags usadas nas notas ativas do caderno (ou de todos). */
export function tagCountsForNotebook(
  recordings: Recording[],
  notebookId?: string | null,
): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const recording of recordings) {
    if (recording.archived || !isVisibleNote(recording)) continue;
    if (notebookId && recordingNotebookId(recording) !== notebookId) continue;
    for (const tag of recording.tags ?? []) {
      const key = tag.toLowerCase();
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { name: tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  );
}

/**
 * Contagens contextuais: cada tag mostra quantas notas teriam se ela fosse
 * marcada junto com as tags ja selecionadas (E). A tag selecionada conta as
 * notas que ja satisfazem o filtro inteiro.
 */
export function tagCountsForFilter(
  recordings: Recording[],
  notebookId: string | null,
  selected: string[],
): { name: string; count: number }[] {
  const universe = tagCountsForNotebook(recordings, notebookId);
  const selectedKeys = selected.map((tag) => tag.toLowerCase());
  return universe.map((tag) => {
    const key = tag.name.toLowerCase();
    const wanted = selectedKeys.includes(key) ? selectedKeys : [...selectedKeys, key];
    const count = recordings.filter((recording) => {
      if (recording.archived || !isVisibleNote(recording)) return false;
      if (notebookId && recordingNotebookId(recording) !== notebookId) return false;
      const present = new Set((recording.tags ?? []).map((item) => item.toLowerCase()));
      return wanted.every((item) => present.has(item));
    }).length;
    return { name: tag.name, count };
  });
}

/** Contagem de notas ativas por caderno (para a lista de cadernos local). */
export function activeNoteCount(recordings: Recording[], notebookId: string): number {
  return recordings.filter(
    (recording) =>
      !recording.archived &&
      isVisibleNote(recording) &&
      recordingNotebookId(recording) === notebookId,
  ).length;
}

/** Data da ultima nota do caderno, pela data real (nao pela importacao). */
export function lastNoteAt(recordings: Recording[], notebookId: string): string | undefined {
  let latest: string | undefined;
  for (const recording of recordings) {
    if (recording.archived || !isVisibleNote(recording)) continue;
    if (recordingNotebookId(recording) !== notebookId) continue;
    const when = recording.recordedAt || recording.createdAt;
    if (!latest || when > latest) latest = when;
  }
  return latest;
}
