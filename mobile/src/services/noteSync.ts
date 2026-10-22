/**
 * Sincroniza a nota com o servidor: liga o nucleo puro (`core/noteSync`) ao
 * cliente HTTP, a configuracao guardada no secure-store e ao envio das imagens
 * locais. Este e o unico lugar que sabe de secure-store.
 */

import { ApiError, DyariumApi, type FetchLike } from '@/core/api';
import { localAudioName } from '@/core/attachments';
import { audioRefFromPath } from '@/core/noteAudio';
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

import {
  resolveLocalAttachments,
  resolveLocalAudioAttachments,
} from './attachments';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/**
 * Resolve os anexos do documento: sobe imagens e audios que ainda estao
 * `local:` e devolve o markdown com `attachment:<id>`. O que falhar continua
 * local e mantem a nota suja para a proxima tentativa.
 */
const resolveAttachments: ImageResolver = async (note) => {
  const known = { ...(note.attachments ?? {}) };
  // Nota antiga: o audio da propria entrada ja tinha id no servidor, mas o mapa
  // nome -> anexo pode nao existir. Sem isto o sync subiria o mesmo audio de
  // novo so para descobrir que o SHA-256 ja estava la.
  const localRef = audioRefFromPath(note.filePath);
  const localName = localRef ? localAudioName(localRef) : undefined;
  if (localName && note.serverAttachmentId) known[localName] = note.serverAttachmentId;

  const images = await resolveLocalAttachments(
    note.entryId,
    note.id,
    note.text ?? '',
    known,
  );
  const audios = await resolveLocalAudioAttachments(
    note.entryId,
    note.id,
    images.markdown,
    images.attachments,
  );
  return {
    markdown: audios.markdown,
    attachments: audios.attachments,
    pending: [...images.pending, ...audios.pending],
  };
};

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
  return withServer(note, (api) => syncNoteWith(api, note, resolveAttachments));
}

/** "Manter o meu": reenvia sem versao, porque a escolha ja foi do usuario. */
export function syncNoteForcing(note: Recording): Promise<SyncNoteResult | undefined> {
  return withServer(note, (api) => syncNoteWith(api, note, resolveAttachments, { force: true }));
}

/** "Ficar com o de la": o que o servidor tem agora, para mostrar antes de trocar. */
export async function fetchTheirs(note: Recording): Promise<Awaited<ReturnType<typeof fetchServerNote>>> {
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