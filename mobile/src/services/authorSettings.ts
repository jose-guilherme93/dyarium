/**
 * Configuracao de autor vinda do servidor, guardada no aparelho para a analise
 * local funcionar offline. O servidor e a fonte da verdade; o pull atualiza o
 * cache. Uma instancia sem a chave significa "todas as notas sao do dono".
 */

import { DyariumApi, type FetchLike } from '@/core/api';

import { getAppFlag, setAppFlag } from './db';
import { loadServerConfig } from './secure';

const KEY = 'author_settings';
const doFetch = globalThis.fetch as unknown as FetchLike;

export interface AuthorSettings {
  ownerName: string;
  allNotesMine: boolean;
}

export const DEFAULT_AUTHOR_SETTINGS: AuthorSettings = {
  ownerName: '',
  allNotesMine: true,
};

function parse(raw: string | null): AuthorSettings {
  if (!raw) return DEFAULT_AUTHOR_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as { ownerName?: unknown; allNotesMine?: unknown };
    return {
      ownerName: typeof parsed.ownerName === 'string' ? parsed.ownerName : '',
      allNotesMine: parsed.allNotesMine !== false,
    };
  } catch {
    return DEFAULT_AUTHOR_SETTINGS;
  }
}

export async function loadAuthorSettings(): Promise<AuthorSettings> {
  return parse(await getAppFlag(KEY));
}

/** Busca do servidor e atualiza o cache. Sem servidor, mantem o que ja tem. */
export async function refreshAuthorSettings(): Promise<AuthorSettings> {
  const config = await loadServerConfig();
  if (!config) return loadAuthorSettings();
  const api = new DyariumApi(config, doFetch);
  const settings = await api.getAuthorSettings();
  const value: AuthorSettings = {
    ownerName: settings.owner_name,
    allNotesMine: settings.all_notes_mine,
  };
  await setAppFlag(KEY, JSON.stringify(value));
  return value;
}
