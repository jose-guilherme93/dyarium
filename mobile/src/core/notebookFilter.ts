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

/**
 * Texto normalizado para busca, por identidade da nota.
 *
 * Baixar o corpo inteiro a cada tecla custava uma varredura completa da
 * biblioteca (e uma alocacao por nota) por caractere digitado. A biblioteca
 * troca o objeto da nota quando qualquer campo muda, entao o WeakMap se
 * invalida sozinho e nao segura a copia de uma nota removida. O custo e pago
 * apenas quando existe busca ativa.
 */
interface SearchText {
  title: string;
  text: string;
  transcript: string;
  tags: string[];
}

let searchTextCache = new WeakMap<Recording, SearchText>();
let searchCacheUsed = false;

/**
 * Solta as copias normalizadas quando ninguem esta buscando.
 *
 * Elas sao grandes (corpo e transcricao em minusculas) e as notas continuam
 * vivas na biblioteca; manter tudo depois de fechar a busca pesava no heap do
 * app inteiro. O WeakMap e trocado por um vazio, sem tocar nos objetos.
 */
function releaseSearchCache(): void {
  if (!searchCacheUsed) return;
  searchCacheUsed = false;
  searchTextCache = new WeakMap();
}

function searchText(recording: Recording): SearchText {
  const cached = searchTextCache.get(recording);
  if (cached) return cached;
  const value: SearchText = {
    title: (recording.title ?? '').toLowerCase(),
    text: (recording.text ?? '').toLowerCase(),
    transcript: (recording.transcript ?? '').toLowerCase(),
    tags: (recording.tags ?? []).map((tag) => tag.toLowerCase()),
  };
  searchCacheUsed = true;
  searchTextCache.set(recording, value);
  return value;
}

function matchesTerm(recording: Recording, term: string): boolean {
  const searchable = searchText(recording);
  return (
    searchable.title.includes(term) ||
    searchable.text.includes(term) ||
    searchable.transcript.includes(term) ||
    searchable.tags.some((tag) => tag.includes(term))
  );
}

/** Tags da nota em minusculas, para comparacao sem baixar de novo. */
const tagKeysCache = new WeakMap<Recording, string[]>();

function tagKeys(recording: Recording): string[] {
  const cached = tagKeysCache.get(recording);
  if (cached) return cached;
  // Array (e nao Set): a lista tem poucas tags e o Set por nota pesava no heap
  // quando a biblioteca inteira passava pelas contagens.
  const value = (recording.tags ?? []).map((tag) => tag.toLowerCase());
  tagKeysCache.set(recording, value);
  return value;
}

export function noteMatches(recording: Recording, filter: NoteFilter): boolean {
  if (filter.notebookId && recordingNotebookId(recording) !== filter.notebookId) return false;
  const wanted = (filter.tags ?? []).map((tag) => tag.toLowerCase());
  if (wanted.length > 0) {
    const present = tagKeys(recording);
    if (wanted.some((tag) => !present.includes(tag))) return false;
  }
  const term = (filter.query ?? '').trim().toLowerCase();
  if (!term) return true;
  return matchesTerm(recording, term);
}

/** Notas ativas e nao vazias de um caderno, ja filtradas. */
export function notesInNotebook(
  recordings: Recording[],
  filter: NoteFilter,
): Recording[] {
  if (!(filter.query ?? '').trim()) releaseSearchCache();
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
  if (!term) {
    releaseSearchCache();
    return [];
  }
  return recordings
    .filter((recording) => isVisibleNote(recording) && matchesTerm(recording, term))
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
  if (!(filter.query ?? '').trim()) releaseSearchCache();
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
    let count = 0;
    for (const recording of recordings) {
      if (recording.archived || !isVisibleNote(recording)) continue;
      if (notebookId && recordingNotebookId(recording) !== notebookId) continue;
      // `tagKeys` e cacheado por identidade: as contagens de todas as tags
      // reaproveitam a mesma lista em vez de remonta-la a cada linha.
      if (wanted.every((item) => tagKeys(recording).includes(item))) count += 1;
    }
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

export interface NotebookStats {
  /** Notas ativas e visiveis do caderno. */
  count: number;
  /** Data da ultima nota, pela data real. */
  lastAt?: string;
}

/**
 * Contagem e ultima data de todos os cadernos numa passada so.
 *
 * A tela de cadernos chamava `activeNoteCount`/`lastNoteAt` por item visivel,
 * e cada uma varria a lista inteira: O(cadernos * notas) por renderizacao.
 * Aqui a lista e varrida uma vez e o mapa e reaproveitado no `renderItem`.
 */
export function notebookStats(recordings: Recording[]): Map<string, NotebookStats> {
  const stats = new Map<string, NotebookStats>();
  for (const recording of recordings) {
    if (recording.archived || !isVisibleNote(recording)) continue;
    const id = recordingNotebookId(recording);
    const when = recording.recordedAt || recording.createdAt;
    const current = stats.get(id);
    if (!current) {
      stats.set(id, { count: 1, lastAt: when });
      continue;
    }
    current.count += 1;
    if (!current.lastAt || when > current.lastAt) current.lastAt = when;
  }
  return stats;
}
