/**
 * Pull das notas do servidor para o app.
 *
 * Insere localmente as entradas que ainda nao existem (casadas por id) com o
 * corpo da nota convertido em markdown. Best-effort e idempotente: rodar de
 * novo nao duplica nem sobrescreve o que ja esta local.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { entryToRecording, isBlankServerEntry } from '@/core/pull';

import { listRecordings, upsertRecording } from './db';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/** Devolve quantas entradas novas foram trazidas. */
export async function pullServerEntries(): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  const api = new DyariumApi(config, doFetch);
  const entries = await api.listEntries();
  const local = await listRecordings();
  // Casa por id local E por entryId: nota de audio tem id local proprio, mas a
  // entrada no servidor tem id gerado pelo upload — sem isso, ela duplicava.
  const known = new Set<string>();
  for (const r of local) {
    known.add(r.id);
    if (r.entryId) known.add(r.entryId);
  }

  let added = 0;
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
    added += 1;
  }
  return added;
}
