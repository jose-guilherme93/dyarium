/**
 * Operacoes de entrada no servidor que o app dispara diretamente.
 */

import { DyariumApi, type FetchLike } from '@/core/api';

import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

/** Apaga a entrada no servidor (soft delete). Best-effort. */
export async function deleteServerEntry(entryId: string): Promise<void> {
  const config = await loadServerConfig();
  if (!config) return;
  const api = new DyariumApi(config, doFetch);
  await api.deleteEntry(entryId);
}

/** Desfaz a exclusao logica no servidor (volta da lixeira). Best-effort. */
export async function restoreServerEntry(entryId: string): Promise<void> {
  const config = await loadServerConfig();
  if (!config) return;
  const api = new DyariumApi(config, doFetch);
  await api.restoreEntry(entryId);
}
