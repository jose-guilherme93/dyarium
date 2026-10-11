/**
 * Sincroniza titulo/data/texto de uma nota ja enviada. Best-effort: uma falha
 * aqui nao muda o estado local (a nota ja esta no servidor). O campo `text` so
 * passa a valer quando o servidor aceitar a nota de texto.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import type { Recording } from '@/core/types';

import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export async function syncNote(note: Recording): Promise<void> {
  if (!note.entryId) return;
  const config = await loadServerConfig();
  if (!config) return;
  const api = new DyariumApi(config, doFetch);
  await api.updateEntry(note.entryId, {
    title: note.title,
    recorded_at: note.recordedAt,
    text: note.text,
  });
}
