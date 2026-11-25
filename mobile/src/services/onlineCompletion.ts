/**
 * Completion num provedor online compativel com /chat/completions.
 *
 * A analise continua sendo a mesma: os prompts e o contrato de JSON sao os do
 * aparelho; muda so quem gera. A chave fica no cofre e nunca entra em erro,
 * log ou URL.
 */

import { resolveAnalysisBaseUrl } from '@/core/providers';
import { loadPrefs, loadProviderKey } from './secure';

const REQUEST_TIMEOUT_MS = 120_000;

export type OnlineCompletionCode =
  | 'no_key'
  | 'no_provider'
  | 'auth'
  | 'rate_limit'
  | 'provider'
  | 'network'
  | 'bad_response';

export class OnlineCompletionError extends Error {
  readonly code: OnlineCompletionCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: OnlineCompletionCode, status: number, retryable: boolean) {
    super(messageFor(code));
    this.name = 'OnlineCompletionError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function messageFor(code: OnlineCompletionCode): string {
  switch (code) {
    case 'no_key':
      return 'chave do provedor ausente';
    case 'no_provider':
      return 'provedor online incompleto';
    case 'auth':
      return 'chave do provedor sem permissao';
    case 'rate_limit':
      return 'limite do provedor atingido';
    case 'provider':
      return 'provedor online indisponivel';
    case 'bad_response':
      return 'provedor devolveu uma resposta invalida';
    case 'network':
    default:
      return 'nao foi possivel falar com o provedor';
  }
}

function failForStatus(status: number): OnlineCompletionError {
  if (status === 401 || status === 403) return new OnlineCompletionError('auth', status, false);
  if (status === 429) return new OnlineCompletionError('rate_limit', status, true);
  if (status >= 500) return new OnlineCompletionError('provider', status, true);
  return new OnlineCompletionError('bad_response', status, false);
}

export interface OnlineMessage {
  role: string;
  content: string;
}

export interface OnlineCompletionOptions {
  maxTokens?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface OnlineCompletionResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  predictedMs: number;
  wallMs: number;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function endpointFor(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

/**
 * Uma completion online. Sem chave/modelo/URL a chamada nem sai: o erro diz o
 * que falta para a tela abrir a configuracao certa.
 */
export async function completeOnline(
  messages: OnlineMessage[],
  options: OnlineCompletionOptions = {},
): Promise<OnlineCompletionResult> {
  const [prefs, key] = await Promise.all([loadPrefs(), loadProviderKey('analysis')]);
  const baseUrl = resolveAnalysisBaseUrl(prefs.analysisProvider, prefs.analysisBaseUrl);
  const model = (prefs.analysisOnlineModel ?? '').trim();
  if (!key) throw new OnlineCompletionError('no_key', 0, false);
  if (!baseUrl || !model) throw new OnlineCompletionError('no_provider', 0, false);

  const doFetch = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const started = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const send = (withFormat: boolean) =>
    doFetch(endpointFor(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: options.maxTokens ?? 320,
        stream: false,
        ...(withFormat ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

  try {
    let response = await send(true);
    // Alguns provedores recusam `response_format`; o prompt ja pede JSON puro,
    // entao a segunda tentativa sem o campo continua valida.
    if (response.status === 400) {
      response = await send(false);
    }
    if (!response.ok) throw failForStatus(response.status);
    let payload: ChatResponse;
    try {
      payload = (await response.json()) as ChatResponse;
    } catch {
      throw new OnlineCompletionError('bad_response', response.status, false);
    }
    const text = (payload.choices?.[0]?.message?.content ?? '').trim();
    if (text === '') throw new OnlineCompletionError('bad_response', response.status, false);
    const wallMs = Math.max(0, Date.now() - started);
    return {
      text,
      promptTokens: Number(payload.usage?.prompt_tokens ?? 0),
      completionTokens: Number(payload.usage?.completion_tokens ?? 0),
      predictedMs: wallMs,
      wallMs,
    };
  } catch (error) {
    if (error instanceof OnlineCompletionError) throw error;
    throw new OnlineCompletionError('network', 0, true);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** O aparelho esta configurado para analisar online? */
export async function onlineAnalysisConfigured(): Promise<boolean> {
  const [prefs, key] = await Promise.all([loadPrefs(), loadProviderKey('analysis')]);
  const baseUrl = resolveAnalysisBaseUrl(prefs.analysisProvider, prefs.analysisBaseUrl);
  return Boolean(key) && baseUrl !== '' && (prefs.analysisOnlineModel ?? '').trim() !== '';
}
