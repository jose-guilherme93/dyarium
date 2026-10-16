/**
 * Reconcilia as notas do aparelho com as do servidor. Roda junto com a fila:
 * insere as notas que so existem no servidor (como remotas), reenvia as
 * gravacoes cuja nota sumiu de la e remove as remotas que nao existem mais.
 * Assim toda nota de um lado passa a existir no outro.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { markQueued } from '@/core/queue';
import { planReconciliation, type RemoteNote } from '@/core/reconcile';
import type { Recording } from '@/core/types';

import { deleteRecordingRow, listRecordings, upsertRecording } from './db';
import { loadServerConfig } from './secure';
import { runUploadQueueOnce } from './uploaderLoop';

const doFetch = globalThis.fetch as unknown as FetchLike;

let running = false;

/** Roda uma reconciliacao. Devolve true se algo mudou no aparelho. */
export async function reconcileOnce(): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    const config = await loadServerConfig();
    if (!config) return false;
    const api = new DyariumApi(config, doFetch);

    let remote: RemoteNote[];
    try {
      const result = await api.listEntries(500);
      remote = (result.entries ?? []).map((entry) => ({
        id: entry.id,
        originKey: entry.origin_key,
        title: entry.title,
        recordedAt: entry.recorded_at ?? undefined,
        durationSeconds: entry.duration_seconds,
        status: entry.status,
      }));
    } catch {
      // Sem servidor agora: a reconciliacao espera o proximo ciclo.
      return false;
    }

    const local = await listRecordings();
    const plan = planReconciliation(local, remote);
    if (plan.insert.length === 0 && plan.reupload.length === 0 && plan.remove.length === 0) {
      return false;
    }

    for (const note of plan.insert) {
      await upsertRecording(remoteToRecording(note));
    }
    for (const id of plan.remove) {
      await deleteRecordingRow(id);
    }
    for (const id of plan.reupload) {
      const found = local.find((rec) => rec.id === id);
      if (found) {
        // Sem a nota no servidor, sobe de novo; a identidade por conteudo evita
        // duplicar caso o conteudo ja esteja la sob outra entrada.
        await upsertRecording(markQueued({ ...found, entryId: undefined }, new Date()));
      }
    }
    if (plan.reupload.length > 0) {
      void runUploadQueueOnce();
    }
    return true;
  } finally {
    running = false;
  }
}

/** Remove a entrada no servidor, para a exclusao convergir. */
export async function deleteRemoteEntry(entryId: string): Promise<void> {
  const config = await loadServerConfig();
  if (!config) return;
  const api = new DyariumApi(config, doFetch);
  await api.deleteEntry(entryId);
}

function remoteToRecording(note: RemoteNote): Recording {
  const now = new Date().toISOString();
  const recordedAt = note.recordedAt ?? now;
  return {
    id: `remote_${note.id}`,
    title: note.title || 'Nota do servidor',
    recordedAt,
    dir: '',
    segmentCount: 0,
    durationMs: note.durationSeconds ? Math.round(note.durationSeconds * 1000) : undefined,
    status: 'remote',
    entryId: note.id,
    originKey: note.originKey,
    offset: 0,
    attempts: 0,
    createdAt: recordedAt,
    updatedAt: now,
  };
}
