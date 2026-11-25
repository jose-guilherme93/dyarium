/**
 * Lista mista "Recentes": notas, livros e projetos num unico fluxo por data.
 * Puro: nada de React nem nativo, testavel com fakes.
 */

import { bookWords } from './books';
import { noteDateIso } from './format';
import type { Notebook } from './notebooks';
import { isVisibleNote, noteMatches, recordingNotebookId } from './notebookFilter';
import { parseProjectLogs, type LogSession } from './projetoLog';
import type { NoteOrder } from './noteOrder';
import type { Recording } from './types';

export interface RecentItemNote {
  kind: 'note';
  recording: Recording;
}

export interface RecentItemBook {
  kind: 'book';
  notebook: Notebook;
  chapterCount: number;
  words: number;
  date: string;
}

export interface RecentItemProject {
  kind: 'project';
  name: string;
  sessions: number;
  date: string;
  mcpId: string;
}

export type RecentItem = RecentItemNote | RecentItemBook | RecentItemProject;

export interface BuildRecentItemsInput {
  recordings: Recording[];
  notebooks: Notebook[];
}

export interface RecentFilter {
  query?: string;
  tags?: string[];
  notebookId?: string | null;
}

function chapterCount(chapters: Recording[]): number {
  let count = 0;
  for (const chapter of chapters) {
    if (chapter.chapterKind === 'chapter') count += 1;
  }
  return count;
}

function bookDate(notebook: Notebook, chapters: Recording[]): string {
  let latest = notebook.updatedAt;
  for (const chapter of chapters) {
    const when = chapter.updatedAt;
    if (when && when > latest) latest = when;
  }
  return latest;
}

function projectDate(session: LogSession): string {
  return `${session.date}T${session.time}`;
}

/**
 * Monta os itens da lista mista. Notas de livros e do caderno MCP ficam de fora
 * da lista de notas: livros viram linhas proprias e as notas do MCP viram
 * projetos atraves de `parseProjectLogs`.
 */
export function buildRecentItems({ recordings, notebooks }: BuildRecentItemsInput): RecentItem[] {
  const items: RecentItem[] = [];
  const bookIds = new Set<string>();
  const mcpIds = new Set<string>();

  for (const notebook of notebooks) {
    if (notebook.kind === 'book') bookIds.add(notebook.id);
    if (notebook.kind === 'mcp') mcpIds.add(notebook.id);
  }

  for (const recording of recordings) {
    const notebookId = recordingNotebookId(recording);
    if (bookIds.has(notebookId) || mcpIds.has(notebookId)) continue;
    if (recording.archived) continue;
    if (!isVisibleNote(recording)) continue;
    items.push({ kind: 'note', recording });
  }

  for (const notebook of notebooks) {
    if (notebook.kind !== 'book') continue;
    const chapters = recordings.filter((recording) => recordingNotebookId(recording) === notebook.id);
    items.push({
      kind: 'book',
      notebook,
      chapterCount: chapterCount(chapters),
      words: bookWords(chapters),
      date: bookDate(notebook, chapters),
    });
  }

  for (const notebook of notebooks) {
    if (notebook.kind !== 'mcp') continue;
    const notes = recordings
      .filter((recording) => recordingNotebookId(recording) === notebook.id)
      .map((recording) => ({ id: recording.id, body: recording.text ?? '', title: recording.title }));
    const sessions = parseProjectLogs(
      notes,
      Object.fromEntries(notes.map((note) => [note.id, note.title])),
    );

    const byProject = new Map<string, { sessions: number; last: string }>();
    for (const session of sessions) {
      if (!session.project) continue;
      const current = byProject.get(session.project) ?? { sessions: 0, last: '' };
      current.sessions += 1;
      const at = projectDate(session);
      if (!current.last || at > current.last) current.last = at;
      byProject.set(session.project, current);
    }

    for (const [name, aggregate] of byProject) {
      items.push({
        kind: 'project',
        name,
        sessions: aggregate.sessions,
        date: aggregate.last,
        mcpId: notebook.id,
      });
    }
  }

  return items;
}

function itemDate(item: RecentItem): string {
  if (item.kind === 'note') return noteDateIso(item.recording);
  return item.date;
}

function otherKey(item: RecentItemBook | RecentItemProject): string {
  return item.kind === 'book' ? item.notebook.id : item.name;
}

/**
 * Ordena o fluxo misto. Notas obedecem ao seletor de ordem; livros e projetos
 * mantem a posicao por data decrescente. O merge intercala os dois grupos pela
 * data, de forma que o resultado continua sendo um unico fluxo estavel.
 */
export function sortRecent(items: RecentItem[], order: NoteOrder): RecentItem[] {
  const notes: RecentItemNote[] = [];
  const others: (RecentItemBook | RecentItemProject)[] = [];
  for (const item of items) {
    if (item.kind === 'note') notes.push(item);
    else others.push(item);
  }

  const noteDirection = order === 'oldest' ? 1 : -1;
  notes.sort((a, b) => {
    const byDate = itemDate(a).localeCompare(itemDate(b));
    if (byDate !== 0) return byDate * noteDirection;
    return a.recording.id.localeCompare(b.recording.id) * noteDirection;
  });

  others.sort((a, b) => {
    const byDate = itemDate(b).localeCompare(itemDate(a));
    if (byDate !== 0) return byDate;
    return otherKey(a).localeCompare(otherKey(b));
  });

  const result: RecentItem[] = [];
  let noteIndex = 0;
  let otherIndex = 0;
  while (noteIndex < notes.length && otherIndex < others.length) {
    const note = notes[noteIndex];
    const other = others[otherIndex];
    const byDate = itemDate(note).localeCompare(itemDate(other));
    // No modo "mais novas" primeiro, a data maior vence; no modo "mais antigas",
    // a data menor vence. Empate favorece a nota para nao quebrar a ordem
    // interna ja estabelecida.
    const takeNote = order === 'oldest' ? byDate <= 0 : byDate >= 0;
    if (takeNote) {
      result.push(note);
      noteIndex += 1;
    } else {
      result.push(other);
      otherIndex += 1;
    }
  }

  return result.concat(notes.slice(noteIndex), others.slice(otherIndex));
}

/**
 * Filtra a lista mista. Query casa nome de livro e nome de projeto; tags so
 * afetam notas. Ao escolher um caderno comum, so notas daquele caderno entram.
 */
export function filterRecent(
  items: RecentItem[],
  { query, tags, notebookId }: RecentFilter,
): RecentItem[] {
  const term = (query ?? '').trim().toLowerCase();

  if (notebookId) {
    return items.filter((item) => {
      if (item.kind !== 'note') return false;
      return noteMatches(item.recording, { query, tags, notebookId });
    });
  }

  return items.filter((item) => {
    if (item.kind === 'note') {
      return noteMatches(item.recording, { query, tags, notebookId: null });
    }
    if (item.kind === 'book') {
      if (!term) return true;
      return item.notebook.name.toLowerCase().includes(term);
    }
    return !term || item.name.toLowerCase().includes(term);
  });
}
