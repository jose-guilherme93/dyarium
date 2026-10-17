/**
 * Pull das notas do servidor para o app.
 *
 * - Adiciona entradas que ainda nao existem localmente (casadas por id local e
 *   por entryId), com o corpo da nota convertido em markdown.
 * - Atualiza as que ja existem quando o servidor mudou o texto, o titulo, a data
 *   ou o arquivamento (edicao feita no dashboard). A ultima edicao vence: nota
 *   limpa aceita a versao nova; nota com edicao pendente so perde o campo que o
 *   servidor gravou depois da ultima edicao local.
 * - Remove do app as notas que o servidor confirma como apagadas (a lixeira dele).
 *   Uma entrada ausente da lista NAO apaga nada: e o que protege o aparelho de um
 *   servidor novo, reinstalado ou restaurado.
 *
 * Best-effort e idempotente. Devolve quantas mudancas houve.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { entryToRecording, isBlankServerEntry, mergeServerNote, recordingsDeletedOnServer } from '@/core/pull';
import type { Recording } from '@/core/types';

import { deleteRecordingRow, listRecordings, upsertRecording } from './db';
import { deleteSessionFiles } from './files';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/** Alto o bastante para reconciliar exclusoes; o servidor tem teto proprio. */
const PULL_LIMIT = 2000;

/** Evita dois pulls ao mesmo tempo (o periodico e o de foco podem se cruzar). */
let pulling = false;

export async function pullServerEntries(): Promise<number> {
  if (pulling) return 0;
  pulling = true;
  try {
    return await pullOnce();
  } finally {
    pulling = false;
  }
}

async function pullOnce(): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  const api = new DyariumApi(config, doFetch);
  const entries = await api.listEntries(PULL_LIMIT);
  const local = await listRecordings();

  let changed = 0;
  const removed = new Set<string>();

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
      removed.add(recording.id);
      changed += 1;
    }
  }

  const known = new Set<string>();
  const localByEntry = new Map<string, Recording>();
  for (const recording of local) {
    if (removed.has(recording.id)) continue;
    known.add(recording.id);
    if (recording.entryId) {
      known.add(recording.entryId);
      localByEntry.set(recording.entryId, recording);
    }
  }

  for (const entry of entries) {
    if (!entry.id) continue;

    const existing = localByEntry.get(entry.id);
    if (existing) {
      let note;
      // A listagem traz a versao do corpo; so busca o texto quando ela mudou.
      if (entry.versions?.body && entry.versions.body !== existing.bodyVersion) {
        try {
          note = (await api.listNotes(entry.id))[0];
        } catch {
          continue;
        }
      }
      const merged = mergeServerNote(existing, entry, note);
      if (merged) {
        await upsertRecording(merged);
        changed += 1;
      }
      continue;
    }

    if (known.has(entry.id)) continue;
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
