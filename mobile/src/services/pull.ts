/**
 * Pull das notas do servidor para o app.
 *
 * - Adiciona entradas que ainda nao existem localmente (casadas por id local e
 *   por entryId), com o corpo da nota convertido em markdown.
 * - Remove do app as notas que o servidor confirma como apagadas (a lixeira dele).
 *   Uma entrada ausente da lista NAO apaga nada: e o que protege o aparelho de um
 *   servidor novo, reinstalado ou restaurado.
 *
 * Best-effort e idempotente. Devolve quantas mudancas houve.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { entryToRecording, isBlankServerEntry, recordingsDeletedOnServer } from '@/core/pull';

import { deleteRecordingRow, listRecordings, upsertRecording } from './db';
import { deleteSessionFiles } from './files';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/** Alto o bastante para reconciliar exclusoes; o servidor tem teto proprio. */
const PULL_LIMIT = 2000;

export async function pullServerEntries(): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  const api = new DyariumApi(config, doFetch);
  const entries = await api.listEntries(PULL_LIMIT);
  const local = await listRecordings();

  let changed = 0;

  // Exclusoes: so o que o servidor confirma como apagado, e so quando a lista
  // veio completa (nao truncada). Se a lixeira nao puder ser lida, nao apagamos
  // nada: na duvida, o dado fica.
  const deleted = await api.listDeletedEntries(PULL_LIMIT).catch(() => null);
  if (deleted && deleted.length < PULL_LIMIT) {
    const deletedAt = new Map<string, string>();
    for (const entry of deleted) {
      if (entry.id) deletedAt.set(entry.id, entry.deleted_at ?? entry.updated_at);
    }
    for (const recording of recordingsDeletedOnServer(local, deletedAt)) {
      deleteSessionFiles(recording.id);
      await deleteRecordingRow(recording.id);
      changed += 1;
    }
  }

  // Adicoes: entradas que ainda nao existem localmente.
  const known = new Set<string>();
  for (const r of local) {
    known.add(r.id);
    if (r.entryId) known.add(r.entryId);
  }
  for (const entry of entries) {
    if (!entry.id || known.has(entry.id)) continue;
    let note;
    try {
      const notes = await api.listNotes(entry.id);
      note = notes[0];
    } catch {
      // sem nota associada: segue so com o titulo
    }
    if (isBlankServerEntry(entry, note)) continue;
    await upsertRecording(entryToRecording(entry, note));
    changed += 1;
  }

  return changed;
}
