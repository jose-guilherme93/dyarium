/**
 * Cadernos no SQLite local. O servidor e espelhado, mas o app continua
 * funcionando offline: criacao, renomeacao e exclusao ficam com `dirty=1` e um
 * tombstone (`deleted=1`) ate o push confirmar.
 */

import { DEFAULT_NOTEBOOK_ID, type Notebook } from '@/core/notebooks';
import { getDatabase } from './db';

interface NotebookRow {
  id: string;
  name: string;
  color: string;
  is_default: number;
  created_at: string;
  updated_at: string;
  dirty: number;
  synced: number;
  deleted: number;
}

function rowToNotebook(row: NotebookRow): Notebook {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.is_default !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dirty: row.dirty !== 0,
    synced: row.synced !== 0,
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
      (id, name, color, is_default, created_at, updated_at, dirty, synced, deleted)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)`,
    [
      notebook.id,
      notebook.name,
      notebook.color,
      notebook.isDefault ? 1 : 0,
      notebook.createdAt,
      notebook.updatedAt,
    ],
  );
}

/** Renomeia/recolore localmente; o push leva ao servidor. */
export async function updateLocalNotebook(
  id: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  const db = await getDatabase();
  const nextName = patch.name?.trim();
  const nextColor = patch.color;
  await db.runAsync(
    `UPDATE notebooks SET
       name = COALESCE(?, name),
       color = COALESCE(?, color),
       updated_at = ?,
       dirty = 1
     WHERE id = ? AND is_default = 0`,
    [nextName && nextName.length > 0 ? nextName : null, nextColor ?? null, new Date().toISOString(), id],
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
 * vence ate o push; o pull nao a sobrescreve.
 */
export async function upsertNotebookFromServer(notebook: Notebook): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO notebooks
      (id, name, color, is_default, created_at, updated_at, dirty, synced, deleted)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0)
     ON CONFLICT(id) DO UPDATE SET
       name = CASE WHEN notebooks.dirty = 1 THEN notebooks.name ELSE excluded.name END,
       color = CASE WHEN notebooks.dirty = 1 THEN notebooks.color ELSE excluded.color END,
       is_default = excluded.is_default,
       created_at = excluded.created_at,
       updated_at = CASE WHEN notebooks.dirty = 1 THEN notebooks.updated_at ELSE excluded.updated_at END,
       synced = 1,
       deleted = 0
     WHERE notebooks.dirty = 0`,
    [
      notebook.id,
      notebook.name,
      notebook.color,
      notebook.isDefault ? 1 : 0,
      notebook.createdAt,
      notebook.updatedAt,
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
      (id, name, color, is_default, created_at, updated_at, dirty, synced, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    [
      notebook.id,
      notebook.name,
      notebook.color,
      notebook.isDefault ? 1 : 0,
      notebook.createdAt || new Date().toISOString(),
      notebook.updatedAt || new Date().toISOString(),
      notebook.isDefault ? 0 : 1,
    ],
  );
}

/** Update em lote para as notas de um caderno excluido. */
export async function moveRecordingsToNotebook(from: string, to: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE recordings SET notebook_id = ? WHERE notebook_id = ?', [to, from]);
}
