/**
 * Transcricao direta na Deepgram, do aparelho.
 *
 * O audio vai em janelas WAV de 16 kHz (as mesmas que o whisper local usa), o
 * que mantem checkpoint, retomada e uso de memoria iguais nos dois motores. A
 * chave nunca aparece em mensagem, log ou URL: o erro devolvido e generico.
 */

import type { TranscriptSegment } from '@/core/types';

const BASE_URL = 'https://api.deepgram.com';
/** Uma janela de 60 s nao tem por que passar de dois minutos. */
const REQUEST_TIMEOUT_MS = 120_000;

export type DeepgramErrorCode =
  | 'invalid_key'
  | 'forbidden'
  | 'rate_limit'
  | 'provider'
  | 'network'
  | 'bad_response';

export class DeepgramError extends Error {
  readonly code: DeepgramErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: DeepgramErrorCode, status: number, retryable: boolean) {
    super(messageFor(code));
    this.name = 'DeepgramError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function messageFor(code: DeepgramErrorCode): string {
  switch (code) {
    case 'invalid_key':
      return 'chave da Deepgram invalida';
    case 'forbidden':
      return 'chave da Deepgram sem permissao';
    case 'rate_limit':
      return 'limite da Deepgram atingido';
    case 'provider':
      return 'Deepgram indisponivel';
    case 'bad_response':
      return 'Deepgram devolveu uma resposta invalida';
    case 'network':
    default:
      return 'nao foi possivel falar com a Deepgram';
  }
}

function failForStatus(status: number): DeepgramError {
  if (status === 401) return new DeepgramError('invalid_key', status, false);
  if (status === 402 || status === 403) return new DeepgramError('forbidden', status, false);
  if (status === 429) return new DeepgramError('rate_limit', status, true);
  if (status >= 500) return new DeepgramError('provider', status, true);
  return new DeepgramError('bad_response', status, false);
}

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
}

interface DeepgramSentence {
  text?: string;
  start?: number;
  end?: number;
}

interface DeepgramAlternative {
  transcript?: string;
  words?: DeepgramWord[];
  paragraphs?: { paragraphs?: { sentences?: DeepgramSentence[] }[] };
}

interface DeepgramBody {
  results?: {
    channels?: {
      detected_language?: string;
      alternatives?: DeepgramAlternative[];
    }[];
  };
}

export interface DeepgramWindow {
  text: string;
  language: string;
  segments: TranscriptSegment[];
}

function toMs(seconds: unknown): number {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0;
}

function joinText(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Converte a resposta em segmentos na linha do tempo da nota. Prefere as
 * frases da Deepgram; sem elas, agrupa palavras por pausa para nao jogar a
 * janela inteira num segmento unico.
 */
export function parseDeepgramResponse(payload: unknown, offsetMs: number): DeepgramWindow {
  const body = payload as DeepgramBody | null;
  const channel = body?.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  const language = (channel?.detected_language ?? '').trim();
  if (!alternative) return { text: '', language, segments: [] };

  const sentences =
    alternative.paragraphs?.paragraphs?.flatMap((paragraph) => paragraph.sentences ?? []) ?? [];
  const segments: TranscriptSegment[] = [];
  for (const sentence of sentences) {
    const text = (sentence.text ?? '').trim();
    if (text === '') continue;
    const start = offsetMs + toMs(sentence.start);
    const end = offsetMs + Math.max(toMs(sentence.end), toMs(sentence.start) + 1);
    segments.push({ start_ms: start, end_ms: end, text });
  }
  if (segments.length > 0) {
    return {
      language,
      text: joinText(segments.map((segment) => segment.text)),
      segments,
    };
  }

  // Sem paragrafos: agrupa por pausa maior que um segundo ou a cada 12 palavras.
  const words = (alternative.words ?? []).filter((word) => (word.punctuated_word ?? word.word ?? '').trim() !== '');
  let current: DeepgramWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const text = joinText(current.map((word) => word.punctuated_word ?? word.word ?? ''));
    if (text === '') {
      current = [];
      return;
    }
    const start = offsetMs + toMs(current[0]?.start);
    const rawEnd = toMs(current[current.length - 1]?.end);
    const end = offsetMs + Math.max(rawEnd, toMs(current[0]?.start) + 1);
    segments.push({ start_ms: start, end_ms: end, text });
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    const gap = previous ? toMs(word.start) - toMs(previous.end) : 0;
    if (current.length >= 12 || (previous && gap > 1000)) flush();
    current.push(word);
  }
  flush();

  const text = joinText(segments.map((segment) => segment.text)) || (alternative.transcript ?? '').trim();
  return { language, text, segments };
}

export interface DeepgramWindowInput {
  audio: Uint8Array;
  apiKey: string;
  model: string;
  /** 'pt', 'auto' ou vazio. */
  language: string;
  /** Inicio da janela no audio original. */
  offsetMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Envia uma janela e devolve o texto com as marcas ja deslocadas. */
export async function transcribeDeepgramWindow(input: DeepgramWindowInput): Promise<DeepgramWindow> {
  const doFetch = input.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const query = new URLSearchParams({
    model: input.model,
    smart_format: 'true',
    punctuate: 'true',
    paragraphs: 'true',
  });
  if (input.language === '' || input.language === 'auto') {
    query.set('detect_language', 'true');
  } else {
    query.set('language', input.language);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (input.signal?.aborted) controller.abort();
  input.signal?.addEventListener('abort', abort);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body =
      typeof Blob !== 'undefined'
        ? new Blob([new Uint8Array(input.audio).buffer as ArrayBuffer], { type: 'audio/wav' })
        : input.audio;
    const response = await doFetch(`${BASE_URL}/v1/listen?${query.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${input.apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: body as BodyInit,
      signal: controller.signal,
    });
    if (!response.ok) throw failForStatus(response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DeepgramError('bad_response', response.status, false);
    }
    return parseDeepgramResponse(payload, input.offsetMs);
  } catch (error) {
    if (error instanceof DeepgramError) throw error;
    if (controller.signal.aborted) throw new DeepgramError('network', 0, true);
    throw new DeepgramError('network', 0, true);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}
