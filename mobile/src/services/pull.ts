/**
 * Pull das notas do servidor para o app.
 *
 * - Adiciona entradas que ainda nao existem localmente (casadas por id local e
 *   por entryId), com o corpo da nota convertido em markdown.
 * - Remove do app as notas sincronizadas cuja entrada sumiu do servidor (foi
 *   apagada la).
 *
 * Best-effort e idempotente. Devolve quantas mudancas houve.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { entryToRecording, isBlankServerEntry } from '@/core/pull';

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
  const serverIds = new Set(entries.map((e) => e.id).filter(Boolean));
  const local = await listRecordings();

  let changed = 0;

  // Exclusoes: so quando a lista veio completa (nao truncada) — evita apagar
  // por engano ao bater o limite.
  if (entries.length < PULL_LIMIT) {
    for (const r of local) {
      if (r.status !== 'completed' || !r.entryId) continue;
      if (serverIds.has(r.entryId)) continue;
      deleteSessionFiles(r.id);
      await deleteRecordingRow(r.id);
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
