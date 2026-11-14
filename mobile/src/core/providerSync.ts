import type { ServerSettings } from './api';
import type { ProcessingPlace } from './processing';
import { resolveAnalysisBaseUrl } from './providers';

/** O que o app pode adotar do servidor sem receber segredo nenhum. */
export interface ProviderImport {
  transcriptionOnlineModel: string;
  analysisProvider: string;
  analysisBaseUrl: string;
  analysisOnlineModel: string;
  transcriptionLanguage: 'pt' | 'auto';
  reviewTranscript: boolean;
  literalTranscript: boolean;
}

/** Id do preset a partir do provedor e da URL que o servidor guardou. */
export function presetFromServer(
  provider: string,
  baseUrl: string,
  localRuntime: string,
): string {
  if (localRuntime !== '') return 'custom';
  if (provider === 'opencode') return 'custom';
  if (baseUrl.includes('openrouter.ai')) return 'openrouter';
  if (baseUrl.includes('generativelanguage.googleapis.com')) return 'google';
  if (baseUrl.includes('api.groq.com')) return 'groq';
  if (baseUrl.includes('deepseek')) return 'deepseek';
  if (baseUrl.includes('api.mistral.ai')) return 'mistral';
  if (baseUrl.includes('api.x.ai')) return 'xai';
  return 'custom';
}

/** Idioma do servidor no vocabulario do app (so pt fixo ou detectar). */
export function languageFromServer(value: string): 'pt' | 'auto' {
  return value === 'pt' ? 'pt' : 'auto';
}

/**
 * Configuracao nao secreta que o app adota do servidor. A chave fica la: o
 * import nao copia segredo, so provedor, modelo e preferencias.
 */
export function importFromServerSettings(settings: ServerSettings): ProviderImport {
  return {
    transcriptionOnlineModel: settings.deepgram_model || 'nova-3',
    analysisProvider: presetFromServer(
      settings.analyze_provider,
      settings.analyze_base_url,
      settings.analyze_local_runtime,
    ),
    analysisBaseUrl: settings.analyze_base_url,
    analysisOnlineModel: settings.analyze_model,
    transcriptionLanguage: languageFromServer(settings.whisper_language),
    reviewTranscript: settings.review_enabled,
    literalTranscript: settings.literal_transcript,
  };
}

export interface LocalProviderConfig {
  place: ProcessingPlace;
  transcriptionOnlineModel: string;
  analysisProvider: string;
  analysisBaseUrl: string;
  analysisOnlineModel: string;
  transcriptionLanguage: 'pt' | 'auto';
  reviewTranscript: boolean;
  literalTranscript: boolean;
  /** Chaves so entram no corpo quando existem no aparelho. */
  deepgramKey?: string | null;
  analysisKey?: string | null;
}

/**
 * Corpo do PUT /settings a partir do que o aparelho escolheu. Só manda chave
 * quando ela existe aqui; sem chave, a do servidor permanece intacta.
 */
export function settingsPatchFromLocal(local: LocalProviderConfig): Record<string, unknown> {
  const provider = local.analysisProvider;
  const baseUrl =
    provider === 'custom'
      ? local.analysisBaseUrl.trim()
      : resolveAnalysisBaseUrl(provider, local.analysisBaseUrl);
  const patch: Record<string, unknown> = {
    transcribe_provider: 'deepgram',
    deepgram_model: local.transcriptionOnlineModel,
    whisper_language: local.transcriptionLanguage === 'auto' ? '' : 'pt',
    review_enabled: local.reviewTranscript,
    literal_transcript: local.literalTranscript,
  };
  // Nao apaga o provedor do servidor com um valor vazio do aparelho.
  if (baseUrl !== '' && local.analysisOnlineModel.trim() !== '') {
    patch.analyze_provider = 'openai';
    patch.analyze_base_url = baseUrl;
    patch.analyze_model = local.analysisOnlineModel.trim();
  }
  if (local.deepgramKey) patch.deepgram_api_key = local.deepgramKey;
  if (local.analysisKey) patch.analyze_api_key = local.analysisKey;
  return patch;
}
