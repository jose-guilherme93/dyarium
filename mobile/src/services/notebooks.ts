/**
 * Cadernos no SQLite local. O servidor e espelhado, mas o app continua
 * funcionando offline: criacao, renomeacao e exclusao ficam com `dirty=1` e um
 * tombstone (`deleted=1`) ate o push confirmar.
 */

import type { NotebookBookFields, ServerNotebook } from '@/core/api';
import {
  DEFAULT_NOTEBOOK_ID,
  normalizeBookStatus,
  type BookStatus,
  type Notebook,
} from '@/core/notebooks';
import { getDatabase } from './db';

export interface NotebookRow {
  id: string;
  name: string;
  color: string;
  is_default: number;
  kind?: string;
  created_at: string;
  updated_at: string;
  dirty: number;
  synced: number;
  deleted: number;
  subtitle?: string;
  author?: string;
  synopsis?: string;
  language?: string;
  goal_words?: number;
  book_status?: string;
  page_size?: string;
  page_margin_mm?: number;
  body_px?: number;
  body_leading?: number;
  body_font?: string;
  daily_goal_words?: number;
  deadline?: string;
  has_cover?: number;
  cover_updated_at?: string;
}

/** Patch de edicao local; cada chave presente vira uma coluna. */
export interface NotebookPatch {
  name?: string;
  color?: string;
  subtitle?: string;
  author?: string;
  synopsis?: string;
  language?: string;
  goalWords?: number;
  bookStatus?: BookStatus;
  pageSize?: string;
  pageMarginMm?: number;
  bodyPx?: number;
  bodyLeading?: number;
  bodyFont?: string;
  dailyGoalWords?: number;
  deadline?: string;
  hasCover?: boolean;
  coverUpdatedAt?: string;
}

/** Campo do patch e a coluna correspondente em `notebooks`. */
const BOOK_COLUMNS: [keyof NotebookPatch, string][] = [
  ['subtitle', 'subtitle'],
  ['author', 'author'],
  ['synopsis', 'synopsis'],
  ['language', 'language'],
  ['goalWords', 'goal_words'],
  ['bookStatus', 'book_status'],
  ['pageSize', 'page_size'],
  ['pageMarginMm', 'page_margin_mm'],
  ['bodyPx', 'body_px'],
  ['bodyLeading', 'body_leading'],
  ['bodyFont', 'body_font'],
  ['dailyGoalWords', 'daily_goal_words'],
  ['deadline', 'deadline'],
  ['hasCover', 'has_cover'],
  ['coverUpdatedAt', 'cover_updated_at'],
];

/** Valores das 15 colunas do livro, na ordem de `BOOK_COLUMNS`. */
function bookValues(notebook: Notebook): (string | number)[] {
  return [
    notebook.subtitle ?? '',
    notebook.author ?? '',
    notebook.synopsis ?? '',
    notebook.language ?? '',
    notebook.goalWords ?? 0,
    notebook.bookStatus ?? 'drafting',
    notebook.pageSize ?? '',
    notebook.pageMarginMm ?? 0,
    notebook.bodyPx ?? 0,
    notebook.bodyLeading ?? 0,
    notebook.bodyFont ?? '',
    notebook.dailyGoalWords ?? 0,
    notebook.deadline ?? '',
    notebook.hasCover ? 1 : 0,
    notebook.coverUpdatedAt ?? '',
  ];
}

function notebookKind(value: Notebook['kind']): string {
  return value === 'mcp' ? 'mcp' : value === 'book' ? 'book' : 'notes';
}

export function rowToNotebook(row: NotebookRow): Notebook {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.is_default !== 0,
    kind: row.kind === 'mcp' ? 'mcp' : row.kind === 'book' ? 'book' : 'notes',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty !== 0,
    synced: row.synced !== 0,
    subtitle: row.subtitle ?? '',
    author: row.author ?? '',
    synopsis: row.synopsis ?? '',
    language: row.language ?? '',
    goalWords: row.goal_words ?? 0,
    bookStatus: normalizeBookStatus(row.book_status),
    pageSize: row.page_size ?? '',
    pageMarginMm: row.page_margin_mm ?? 0,
    bodyPx: row.body_px ?? 0,
    bodyLeading: row.body_leading ?? 0,
    bodyFont: row.body_font ?? '',
    dailyGoalWords: row.daily_goal_words ?? 0,
    deadline: row.deadline ?? '',
    hasCover: (row.has_cover ?? 0) !== 0,
    coverUpdatedAt: row.cover_updated_at ?? '',
  };
}

/** Caderno do servidor no formato local. */
export function notebookFromServer(server: ServerNotebook): Notebook {
  return {
    id: server.id,
    name: server.name,
    color: server.color,
    isDefault: server.is_default,
    kind: server.kind === 'mcp' ? 'mcp' : server.kind === 'book' ? 'book' : 'notes',
    createdAt: server.created_at,
    updatedAt: server.updated_at,
    dirty: false,
    synced: true,
    subtitle: server.subtitle ?? '',
    author: server.author ?? '',
    synopsis: server.synopsis ?? '',
    language: server.language ?? '',
    goalWords: server.goal_words ?? 0,
    bookStatus: normalizeBookStatus(server.book_status),
    pageSize: server.page_size ?? '',
    pageMarginMm: server.page_margin_mm ?? 0,
    bodyPx: server.body_px ?? 0,
    bodyLeading: server.body_leading ?? 0,
    bodyFont: server.body_font ?? '',
    dailyGoalWords: server.daily_goal_words ?? 0,
    deadline: server.deadline ?? '',
    hasCover: server.has_cover ?? false,
    coverUpdatedAt: server.cover_updated_at ?? '',
  };
}

/** Metadados do livro no formato que a API aceita. */
export function notebookBookPayload(notebook: Notebook): NotebookBookFields {
  return {
    subtitle: notebook.subtitle ?? '',
    author: notebook.author ?? '',
    synopsis: notebook.synopsis ?? '',
    language: notebook.language ?? '',
    goal_words: notebook.goalWords ?? 0,
    book_status: notebook.bookStatus ?? 'drafting',
    page_size: notebook.pageSize ?? '',
    page_margin_mm: notebook.pageMarginMm ?? 0,
    body_px: notebook.bodyPx ?? 0,
    body_leading: notebook.bodyLeading ?? 0,
    body_font: notebook.bodyFont ?? '',
    daily_goal_words: notebook.dailyGoalWords ?? 0,
    deadline: notebook.deadline ?? '',
  };
}

/** Cadernos visiveis, sem os tombstones pendentes de push. */
export async function listNotebooks(): Promise<Notebook[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NotebookRow>(
    `SELECT * FROM notebooks WHERE deleted = 0
     ORDER BY is_default ASC, created_at ASC, id ASC`,
  );
  return rows.map(rowToNotebook);
}

export async function getNotebook(id: string): Promise<Notebook | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<NotebookRow>(
    'SELECT * FROM notebooks WHERE id = ? AND deleted = 0',
    [id],
  );
  return row ? rowToNotebook(row) : null;
}

/** Cria um caderno local (ainda nao enviado). */
export async function insertLocalNotebook(notebook: Notebook): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO notebooks
      (id, name, color, is_default, kind, created_at, updated_at,
       subtitle, author, synopsis, language, goal_words, book_status, page_size,
       page_margin_mm, body_px, body_leading, body_font, daily_goal_words, deadline,
       has_cover, cover_updated_at, dirty, synced, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0)`,
    [
      notebook.id,
      notebook.name,
      notebook.color,
      notebook.isDefault ? 1 : 0,
      notebookKind(notebook.kind),
      notebook.createdAt,
      notebook.updatedAt,
      ...bookValues(notebook),
    ],
  );
}

/**
 * Renomeia/recolore e/ou grava os metadados do livro localmente; o push leva ao
 * servidor. Campo ausente no patch nao e tocado.
 */
export async function updateLocalNotebook(
  id: string,
  patch: NotebookPatch,
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  const nextName = patch.name?.trim();
  if (nextName && nextName.length > 0) {
    sets.push('name = ?');
    params.push(nextName);
  }
  if (patch.color !== undefined) {
    sets.push('color = ?');
    params.push(patch.color);
  }
  for (const [campo, coluna] of BOOK_COLUMNS) {
    const valor = patch[campo];
    if (valor === undefined) continue;
    sets.push(`${coluna} = ?`);
    params.push(typeof valor === 'boolean' ? (valor ? 1 : 0) : valor);
  }
  if (sets.length === 0) return;
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE notebooks SET
       ${sets.join(',\n       ')},
       updated_at = ?,
       dirty = 1
     WHERE id = ? AND is_default = 0`,
    [...params, new Date().toISOString(), id],
  );
}

/**
 * Exclui localmente e esconde o caderno. As notas vao para o padrao; o servidor
 * fara o mesmo quando receber o DELETE. Caderno nunca sincronizado some direto.
 */
export async function deleteLocalNotebook(id: string): Promise<void> {
  if (id === DEFAULT_NOTEBOOK_ID) return;
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'UPDATE recordings SET notebook_id = ? WHERE notebook_id = ?',
      [DEFAULT_NOTEBOOK_ID, id],
    );
    const row = await tx.getFirstAsync<{ synced: number }>(
      'SELECT synced FROM notebooks WHERE id = ?',
      [id],
    );
    if (!row || row.synced === 0) {
      await tx.runAsync('DELETE FROM notebooks WHERE id = ?', [id]);
      return;
    }
    await tx.runAsync(
      'UPDATE notebooks SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), id],
    );
  });
}

/** Marca o caderno como sincronizado (apos POST/PATCH/DELETE). */
export async function markNotebookSynced(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE notebooks SET dirty = 0, synced = 1 WHERE id = ?',
    [id],
  );
}

/**
 * Caderno vindo do retrato do Drive (`state.enc`), quando ele e mais novo que o
 * local. Entra sem `deleted` e sem mexer em `dirty`/`synced`: o push ao
 * servidor continua sendo decisao de quem ja era local; um caderno que so
 * existia no Drive entra pendente de push.
 */
export async function mergeNotebookFromDrive(notebook: Notebook): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ dirty: number; synced: number }>(
    'SELECT dirty, synced FROM notebooks WHERE id = ?',
    [notebook.id],
  );
  const dirty = existing ? existing.dirty : notebook.isDefault ? 0 : 1;
  const synced = existing ? existing.synced : 0;
  await db.runAsync(
    `INSERT INTO notebooks
      (id, name, color, is_default, kind, created_at, updated_at,
       subtitle, author, synopsis, language, goal_words, book_status, page_size,
       page_margin_mm, body_px, body_leading, body_font, daily_goal_words, deadline,
       has_cover, cover_updated_at, dirty, synced, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       color = excluded.color,
       is_default = excluded.is_default,
       kind = excluded.kind,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       subtitle = excluded.subtitle,
       author = excluded.author,
       synopsis = excluded.synopsis,
       language = excluded.language,
       goal_words = excluded.goal_words,
       book_status = excluded.book_status,
       page_size = excluded.page_size,
       page_margin_mm = excluded.page_margin_mm,
       body_px = excluded.body_px,
       body_leading = excluded.body_leading,
       body_font = excluded.body_font,
       daily_goal_words = excluded.daily_goal_words,
       deadline = excluded.deadline,
       has_cover = excluded.has_cover,
       cover_updated_at = excluded.cover_updated_at,
       deleted = 0`,
    [
      notebook.id,
      notebook.name,
      notebook.color,
      notebook.isDefault ? 1 : 0,
      notebookKind(notebook.kind),
      notebook.createdAt,
      notebook.updatedAt,
      ...bookValues(notebook),
      dirty,
      synced,
    ],
  );
}

export async function removeNotebookRow(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM notebooks WHERE id = ?', [id]);
}

/** Linhas que precisam de push: criadas/alteradas ou tombstone. */
export async function listDirtyNotebooks(): Promise<(Notebook & { deleted: boolean })[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NotebookRow>(
    'SELECT * FROM notebooks WHERE dirty = 1 AND is_default = 0 ORDER BY created_at ASC',
  );
  return rows.map((row) => ({ ...rowToNotebook(row), deleted: row.deleted !== 0 }));
}

/**
 * Aplica um caderno vindo do servidor. Se o local esta sujo, a edicao local
 * vence ate o push; o pull nao a sobrescreve (nem os metadados do livro).
 */
export async function upsertNotebookFromServer(notebook: Notebook): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO notebooks
      (id, name, color, is_default, kind, created_at, updated_at,
       subtitle, author, synopsis, language, goal_words, book_status, page_size,
       page_margin_mm, body_px, body_leading, body_font, daily_goal_words, deadline,
       has_cover, cover_updated_at, dirty, synced, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       color = excluded.color,
       is_default = excluded.is_default,
       kind = excluded.kind,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       subtitle = excluded.subtitle,
       author = excluded.author,
       synopsis = excluded.synopsis,
       language = excluded.language,
       goal_words = excluded.goal_words,
       book_status = excluded.book_status,
       page_size = excluded.page_size,
       page_margin_mm = excluded.page_margin_mm,
       body_px = excluded.body_px,
       body_leading = excluded.body_leading,
       body_font = excluded.body_font,
       daily_goal_words = excluded.daily_goal_words,
       deadline = excluded.deadline,
       has_cover = excluded.has_cover,
       cover_updated_at = excluded.cover_updated_at,
       synced = 1,
       deleted = 0
     WHERE notebooks.dirty = 0`,
    [
      notebook.id,
      notebook.name,
      notebook.color,
      notebook.isDefault ? 1 : 0,
      notebookKind(notebook.kind),
      notebook.createdAt,
      notebook.updatedAt,
      ...bookValues(notebook),
    ],
  );
}

/** Remove cadernos locais que o servidor nao tem mais (ja sincronizados). */
export async function pruneNotebooks(serverIds: Set<string>): Promise<void> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM notebooks WHERE dirty = 0 AND is_default = 0',
  );
  for (const row of rows) {
    if (!serverIds.has(row.id)) {
      // O servidor moveu as notas do caderno excluido para o padrao. Faz o mesmo
      // localmente antes de apagar a linha, para nenhuma nota ficar invisivel.
      await db.runAsync('UPDATE recordings SET notebook_id = ? WHERE notebook_id = ?', [
        DEFAULT_NOTEBOOK_ID,
        row.id,
      ]);
      await db.runAsync('DELETE FROM notebooks WHERE id = ?', [row.id]);
    }
  }
}

/**
 * Caderno vindo de um backup local. Entra sujo para o push confirmar; se ja
 * existir no aparelho, nao sobrescreve o que esta la.
 */
export async function restoreLocalNotebook(notebook: Notebook): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO notebooks
      (id, name, color, is_default, kind, created_at, updated_at,
       subtitle, author, synopsis, language, goal_words, book_status, page_size,
       page_margin_mm, body_px, body_leading, body_font, daily_goal_words, deadline,
       has_cover, cover_updated_at, dirty, synced, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      notebook.id,
      notebook.name,
      notebook.color,
      notebook.isDefault ? 1 : 0,
      notebookKind(notebook.kind),
      notebook.createdAt || new Date().toISOString(),
      notebook.updatedAt || new Date().toISOString(),
      ...bookValues(notebook),
      notebook.isDefault ? 0 : 1,
    ],
  );
}

/** Update em lote para as notas de um caderno excluido. */
export async function moveRecordingsToNotebook(from: string, to: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE recordings SET notebook_id = ? WHERE notebook_id = ?', [to, from]);
}
