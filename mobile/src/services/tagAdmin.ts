/**
 * Administracao de tags no servidor. O app so edita o banco global quando ha
 * conexao; as notas continuam podendo receber tags locais offline e o sync leva
 * os nomes depois.
 */

import { DyariumApi, type FetchLike, type ServerTag } from '@/core/api';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

async function api(): Promise<DyariumApi | null> {
  const config = await loadServerConfig();
  if (!config) return null;
  return new DyariumApi(config, doFetch);
}

/** Banco de tags do servidor; lista vazia quando nao ha configuracao. */
export async function listTagBank(): Promise<ServerTag[]> {
  const client = await api();
  if (!client) return [];
  return client.listTags();
}

export async function renameTag(
  id: string,
  name: string,
): Promise<{ id: string; name: string; color: string; merged: boolean }> {
  const client = await api();
  if (!client) throw new Error('sem servidor');
  return client.updateTag(id, { name });
}

export async function removeTag(id: string): Promise<void> {
  const client = await api();
  if (!client) throw new Error('sem servidor');
  return client.deleteTag(id);
}
