/**
 * Carregamento do whisper.rn e disponibilidade da transcricao local.
 *
 * Modulo leve (sem React e sem depender do loop de upload) para poder ser usado
 * de varios lugares sem criar ciclos de import.
 */

import { audioDecodeAvailable } from '../../modules/audio-decode';
import { loadPrefs } from './secure';
import { isModelInstalled } from './transcriptionModels';

export interface WhisperSegment {
  text: string;
  t0: number;
  t1: number;
}

export interface WhisperTranscribeResult {
  result: string;
  language: string;
  segments: WhisperSegment[];
}

export interface WhisperTranscribeOptions {
  language?: string;
  maxThreads?: number;
  onNewSegments?: (event: { segments: WhisperSegment[] }) => void;
  /** Progresso da transcricao, de 0 a 100. */
  onProgress?: (progress: number) => void;
}

export interface WhisperContext {
  transcribe(
    pathOrBase64: string,
    options?: WhisperTranscribeOptions,
  ): { promise: Promise<WhisperTranscribeResult>; stop: () => Promise<void> };
  release(): Promise<void>;
}

export interface WhisperModule {
  initWhisper(options: { filePath: string; useGpu?: boolean }): Promise<WhisperContext>;
}

export function loadWhisper(): WhisperModule | null {
  try {
    // O pacote nao declara a entrada "." no `exports`; `whisper.rn/index` aponta
    // para o mesmo modulo.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('whisper.rn/index') as WhisperModule;
  } catch {
    return null;
  }
}

/** O build tem os modulos nativos de transcricao local? */
export function localTranscriptionAvailable(): boolean {
  return Boolean(loadWhisper() && audioDecodeAvailable());
}

/**
 * O app vai transcrever no aparelho? (ligado, com modulo nativo e com modelo
 * baixado). Usado no upload para avisar o servidor que nao precisa transcrever.
 */
export async function willTranscribeLocally(): Promise<boolean> {
  if (!localTranscriptionAvailable()) return false;
  const prefs = await loadPrefs();
  if (prefs.localTranscription === false) return false;
  const modelId = prefs.transcriptionModel;
  return Boolean(modelId && isModelInstalled(modelId));
}
