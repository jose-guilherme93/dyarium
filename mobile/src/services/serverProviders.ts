/**
 * Configuracao de provedores entre o aparelho e o servidor.
 *
 * Importar traz o que nao e segredo (provedor, modelo, idioma, revisao); a
 * chave nunca volta do servidor. Enviar leva a escolha do aparelho e, quando
 * existir aqui, a chave digitada — nunca um segredo ausente, para nao apagar o
 * que o servidor ja tinha.
 */

import { DyariumApi, type FetchLike, type ServerSettings } from '@/core/api';
import {
  importFromServerSettings,
  settingsPatchFromLocal,
  type LocalProviderConfig,
  type ProviderImport,
} from '@/core/providerSync';
import { loadPrefs, loadProviderKey, loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

function client() {
  const config = loadServerConfig();
  return config.then((value) => (value ? new DyariumApi(value, doFetch) : null));
}

/** Configuracao do servidor, ou null quando nao ha ambiente conectado. */
export async function readServerSettings(): Promise<ServerSettings | null> {
  const api = await client();
  if (!api) return null;
  try {
    return await api.getSettings();
  } catch {
    return null;
  }
}

/** Grava um patch na configuracao do servidor (provedor, modelo, chave). */
export async function updateServerSettings(patch: Record<string, unknown>): Promise<boolean> {
  const api = await client();
  if (!api) return false;
  try {
    await api.putSettings(patch);
    return true;
  } catch {
    return false;
  }
}

/** O que o app adota do servidor; null sem ambiente ou sem resposta. */
export async function importProvidersFromServer(): Promise<ProviderImport | null> {
  const settings = await readServerSettings();
  if (!settings) return null;
  return importFromServerSettings(settings);
}

/**
 * Envia a escolha do aparelho para o servidor. Devolve false sem ambiente ou
 * quando o servidor recusa; o erro fica generico para o chamador.
 */
export async function pushProvidersToServer(): Promise<boolean> {
  const api = await client();
  if (!api) return false;
  const prefs = await loadPrefs();
  const [deepgramKey, analysisKey] = await Promise.all([
    loadProviderKey('transcription'),
    loadProviderKey('analysis'),
  ]);
  const local: LocalProviderConfig = {
    place: prefs.transcriptionPlace ?? 'off',
    transcriptionOnlineModel: prefs.transcriptionOnlineModel ?? 'nova-3',
    analysisProvider: prefs.analysisProvider ?? 'custom',
    analysisBaseUrl: prefs.analysisBaseUrl ?? '',
    analysisOnlineModel: prefs.analysisOnlineModel ?? '',
    transcriptionLanguage: prefs.transcriptionLanguage === 'auto' ? 'auto' : 'pt',
    reviewTranscript: prefs.reviewTranscript === true,
    literalTranscript: prefs.literalTranscript === true,
    deepgramKey,
    analysisKey,
  };
  try {
    await api.putSettings(settingsPatchFromLocal(local));
    return true;
  } catch {
    return false;
  }
}
