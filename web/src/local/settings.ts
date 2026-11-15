/**
 * Ajustes do cofre local, guardados no navegador.
 *
 * Sem servidor, escolher provedor precisa valer de verdade: o que a tela grava
 * fica no IndexedDB e volta na proxima abertura. As chaves de provedor tambem
 * ficam aqui — nunca vao para lugar nenhum, como no app.
 */

import { STORE_SETTINGS, storeGet, storeSet } from "../lib/idb";
import { FALLBACK_MODELS, providerFromSettings } from "../lib/modelCatalog";
import { WHISPER_MODELS } from "../lib/browserModels";

import type { ModelInfo, Settings } from "../types";

const CHAVE = "preferencias";

/** Padroes do cofre: sem provedor, sem chave, analise desligada. */
export const DEFAULT_SETTINGS: Settings = {
  owner_name: "",
  all_notes_mine: true,
  trim_silence: false,
  max_whisper_rss_mb: 0,
  whisper_model: "",
  whisper_language: "",
  transcribe_provider: "whisper",
  deepgram_model: "",
  deepgram_api_key_set: false,
  analyze_enabled: false,
  analyze_provider: "",
  analyze_local_runtime: "",
  analyze_base_url: "",
  analyze_model: "",
  analyze_api_key_set: false,
  analysis_themes: "",
  review_enabled: false,
  literal_transcript: false,
};

interface Stored extends Partial<Settings> {
  deepgram_api_key?: string;
  analyze_api_key?: string;
}

/** O que a tela pode ver: a chave fica no banco, nunca no estado da interface. */
function publicSettings(stored: Stored): Settings {
  const resto: Stored = { ...stored };
  delete resto.deepgram_api_key;
  delete resto.analyze_api_key;
  return {
    ...DEFAULT_SETTINGS,
    ...resto,
    deepgram_api_key_set: Boolean(stored.deepgram_api_key),
    analyze_api_key_set: Boolean(stored.analyze_api_key),
  };
}

export async function loadLocalSettings(): Promise<Settings> {
  return publicSettings((await storeGet<Stored>(STORE_SETTINGS, CHAVE)) ?? {});
}

/** Grava o patch; chave vazia significa "manter a que ja existe". */
export async function saveLocalSettings(patch: Record<string, unknown>): Promise<Settings> {
  const stored = (await storeGet<Stored>(STORE_SETTINGS, CHAVE)) ?? {};
  const proximo: Stored = { ...stored };
  for (const [campo, valor] of Object.entries(patch)) {
    if (campo === "deepgram_api_key") {
      if (typeof valor === "string" && valor.trim()) proximo.deepgram_api_key = valor.trim();
      continue;
    }
    if (campo === "analyze_api_key") {
      if (typeof valor === "string" && valor.trim()) proximo.analyze_api_key = valor.trim();
      continue;
    }
    (proximo as Record<string, unknown>)[campo] = valor;
  }
  await storeSet(STORE_SETTINGS, CHAVE, proximo);
  return publicSettings(proximo);
}

/**
 * Modelos de analise do provedor escolhido.
 *
 * O servidor consulta o `/models` de cada provedor; aqui vale o catalogo
 * curado, que e a mesma lista que a interface mostra como sugestao.
 */
export async function localAnalyzeModels(): Promise<string[]> {
  const settings = await loadLocalSettings();
  // O ajuste guarda o `kind` do provedor ("openai"); o catalogo e indexado pelo
  // id do preset ("openrouter"). providerFromSettings faz essa volta.
  const preset = providerFromSettings(
    settings.analyze_provider,
    settings.analyze_base_url,
    settings.analyze_local_runtime,
  );
  const direto = settings.analyze_model ? [settings.analyze_model] : [];
  const doCatalogo = FALLBACK_MODELS[preset] ?? [];
  return [...new Set([...direto, ...doCatalogo])];
}

/** Modelos de transcricao que rodam no proprio navegador. */
export function localWhisperModels(): ModelInfo[] {
  return WHISPER_MODELS.map((modelo) => ({
    name: modelo.id,
    filename: modelo.repo,
    size_mb: Math.round(modelo.sizeBytes / (1024 * 1024)),
    path: modelo.repo,
    downloaded: false,
    local_bytes: 0,
  }));
}
