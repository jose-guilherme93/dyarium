/**
 * Sincronizacao dos cadernos: push das linhas locais sujas e pull do espelho.
 * Best-effort, como o pull das notas: sem servidor configurado, nada acontece.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { loadServerConfig } from './secure';
import {
  listDirtyNotebooks,
  markNotebookSynced,
  pruneNotebooks,
  removeNotebookRow,
  upsertNotebookFromServer,
} from './notebooks';

const doFetch = globalThis.fetch as unknown as FetchLike;
let pushPromise: Promise<number> | null = null;

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404;
}

/** Envia cadernos criados/alterados/excluidos offline. */
export function pushNotebooks(): Promise<number> {
  // Uma promessa compartilhada: quem chama espera o push em andamento, em vez de
  // seguir para notas que apontam para um caderno ainda nao criado no servidor.
  if (pushPromise) return pushPromise;
  pushPromise = doPushNotebooks().finally(() => {
    pushPromise = null;
  });
  return pushPromise;
}

async function doPushNotebooks(): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  const api = new DyariumApi(config, doFetch);
  const dirty = await listDirtyNotebooks();
  let changed = 0;
  for (const notebook of dirty) {
    if (notebook.isDefault) continue;
    if (notebook.deleted) {
      try {
        await api.deleteNotebook(notebook.id);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      await removeNotebookRow(notebook.id);
      changed += 1;
      continue;
    }
    if (!notebook.synced) {
      await api.createNotebook({
        id: notebook.id,
        name: notebook.name,
        color: notebook.color,
      });
    } else {
      await api.updateNotebook(notebook.id, {
        name: notebook.name,
        color: notebook.color,
      });
    }
    await markNotebookSynced(notebook.id);
    changed += 1;
  }
  return changed;
}

/** Traz os cadernos do servidor para o espelho local. */
export async function pullNotebooks(): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  const api = new DyariumApi(config, doFetch);
  const notebooks = await api.listNotebooks();
  for (const notebook of notebooks) {
    await upsertNotebookFromServer({
      id: notebook.id,
      name: notebook.name,
      color: notebook.color,
      isDefault: notebook.is_default,
      createdAt: notebook.created_at,
      updatedAt: notebook.updated_at,
      dirty: false,
      synced: true,
    });
  }
  await pruneNotebooks(new Set(notebooks.map((notebook) => notebook.id)));
  return notebooks.length;
}
