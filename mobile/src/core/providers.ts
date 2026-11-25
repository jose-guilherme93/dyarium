/**
 * Provedores online que o aparelho pode chamar direto.
 *
 * O mesmo conjunto que a web oferece para analise (formato /chat/completions da
 * OpenAI) e o unico provedor de transcricao que o servidor tambem suporta hoje,
 * a Deepgram. Puro: nada de rede ou armazenamento aqui.
 */

export interface AnalysisProvider {
  id: string;
  label: string;
  /** Nome curto mostrado na linha da tela. */
  short: string;
  baseUrl: string;
  model: string;
  /** Sugestoes quando o provedor nao tem /models confiavel no app. */
  models: string[];
  /** Onde criar a chave; mostrado atras de um toque. */
  keyUrl?: string;
  keyPlaceholder?: string;
}

export const ANALYSIS_PROVIDERS: AnalysisProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    short: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    models: ['google/gemini-2.5-flash', 'openai/gpt-4.1-mini', 'anthropic/claude-sonnet-4'],
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-...',
  },
  {
    id: 'groq',
    label: 'Groq',
    short: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'],
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    short: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    short: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    short: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'],
    keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    short: 'Grok',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3-mini',
    models: ['grok-3-mini', 'grok-3', 'grok-4-fast'],
    keyUrl: 'https://console.x.ai/',
    keyPlaceholder: 'xai-...',
  },
  {
    id: 'custom',
    label: 'Personalizado',
    short: 'Personalizado',
    baseUrl: '',
    model: '',
    models: [],
  },
];

export const CUSTOM_PROVIDER_ID = 'custom';
export const DEFAULT_ANALYSIS_PROVIDER = 'openrouter';

export function analysisProviderById(id: string | undefined): AnalysisProvider | undefined {
  const found = ANALYSIS_PROVIDERS.find((provider) => provider.id === id);
  return found ?? ANALYSIS_PROVIDERS.find((provider) => provider.id === CUSTOM_PROVIDER_ID);
}

/** Id valido ou o personalizado (nunca undefined na tela nem no envio). */
export function normalizeAnalysisProvider(id: string | undefined): string {
  return analysisProviderById(id)?.id ?? CUSTOM_PROVIDER_ID;
}

/**
 * URL base efetiva da chamada. O personalizado usa o que o usuario digitou; os
 * demais usam o preset, para uma URL antiga salva nao quebrar o provedor.
 */
export function resolveAnalysisBaseUrl(id: string | undefined, customUrl: string | undefined): string {
  const provider = analysisProviderById(id);
  if (provider && provider.id !== CUSTOM_PROVIDER_ID) return provider.baseUrl;
  return (customUrl ?? '').trim();
}

export const DEEPGRAM_MODELS = ['nova-3', 'nova-2', 'enhanced', 'base'];
export const DEFAULT_DEEPGRAM_MODEL = 'nova-3';
export const DEEPGRAM_KEY_URL = 'https://console.deepgram.com/project/api-keys';

export function normalizeDeepgramModel(model: string | undefined): string {
  const value = (model ?? '').trim();
  return value === '' ? DEFAULT_DEEPGRAM_MODEL : value;
}

/** O aparelho chama a Deepgram direto, sem servidor. */
export type TranscriptionOnlineProvider = 'deepgram';
