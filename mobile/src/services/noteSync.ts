/**
 * Sincroniza a nota com o servidor: liga o nucleo puro (`core/noteSync`) ao
 * cliente HTTP, a configuracao guardada no secure-store e ao envio das imagens
 * locais. Este e o unico lugar que sabe de secure-store.
 */

import { ApiError, DyariumApi, type FetchLike } from '@/core/api';
import {
  conflictFields,
  fetchServerNote,
  isNoteConflict,
  syncNoteWith,
  type ImageResolver,
  type NoteSyncApi,
  type SyncNoteResult,
} from '@/core/noteSync';
import type { Recording } from '@/core/types';

import { resolveLocalAttachments } from './attachments';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/** Resolver de imagens: sobe o que ainda esta `local:` e devolve o markdown. */
const resolveImages: ImageResolver = (note) =>
  resolveLocalAttachments(note.entryId, note.id, note.text ?? '', note.attachments ?? {});

async function withServer<T>(
  note: Recording,
  run: (api: DyariumApi & NoteSyncApi) => Promise<T>,
): Promise<T | undefined> {
  if (!note.entryId) return undefined;
  const config = await loadServerConfig();
  if (!config) return undefined;
  return run(new DyariumApi(config, doFetch) as DyariumApi & NoteSyncApi);
}

/**
 * Envia titulo/data e corpo em markdown. `undefined` quando a nota ainda nao tem
 * entrada no servidor. Conflito sobe como `ConflictError` (409), sem nada gravado.
 */
export function syncNote(note: Recording): Promise<SyncNoteResult | undefined> {
  return withServer(note, (api) => syncNoteWith(api, note, resolveImages));
}

/** "Manter o meu": reenvia sem versao, porque a escolha ja foi do usuario. */
export function syncNoteForcing(note: Recording): Promise<SyncNoteResult | undefined> {
  return withServer(note, (api) => syncNoteWith(api, note, resolveImages, { force: true }));
}

/** "Ficar com o de la": o que o servidor tem agora, para mostrar antes de trocar. */
export async function fetchTheirs(
  note: Recording,
): Promise<{ title?: string; recordedAt?: string; markdown: string }> {
  if (!note.entryId) return { markdown: '' };
  const config = await loadServerConfig();
  if (!config) return { markdown: '' };
  const api = new DyariumApi(config, doFetch) as DyariumApi & NoteSyncApi;
  return fetchServerNote(api, note.entryId);
}

export { conflictFields, isNoteConflict };
export type { SyncNoteResult };

/**
 * Erro de rede/API que nao e conflito: o app tenta de novo mais tarde. Conflito
 * nao entra aqui — repetir a gravacao nao resolveria nada.
 */
export function isTransientNoteError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}