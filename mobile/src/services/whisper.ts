/**
 * Carregamento do whisper.rn e onde a transcricao roda.
 *
 * Modulo leve (sem React e sem depender do loop de upload) para poder ser usado
 * de varios lugares sem criar ciclos de import.
 */

import { audioDecodeAvailable } from '../../modules/audio-decode';
import {
  clientOwnsStage,
  decideProcessing,
  type ProcessingDecision,
} from '@/core/processing';
import { loadPrefs, loadProviderKey, loadServerConfig } from './secure';
import { resolveTranscriptionModel } from './transcriptionModels';

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

/** Onde a transcricao desta instalacao roda (ou se esta desligada). */
export async function transcriptionPlace(): Promise<ProcessingDecision> {
  const [prefs, server, key] = await Promise.all([
    loadPrefs(),
    loadServerConfig(),
    loadProviderKey('transcription'),
  ]);
  // O modelo vem do disco, nao do id salvo: se a preferencia aponta para um
  // arquivo que nao esta la, o instalado resolve. Sem arquivo, `needsModel`.
  const installed = resolveTranscriptionModel(prefs.transcriptionModel);
  return decideProcessing({
    place: prefs.transcriptionPlace ?? 'off',
    hasServer: Boolean(server),
    deviceCapable: localTranscriptionAvailable(),
    deviceReady: Boolean(installed),
    onlineReady: Boolean(key) && prefs.transcriptionProvider === 'deepgram',
  });
}

/**
 * O app vai transcrever agora? Vale para o aparelho e para o provedor online:
 * os dois sao este cliente comecando a etapa.
 */
export async function willTranscribeLocally(): Promise<boolean> {
  return (await transcriptionPlace()).runsHere;
}

/**
 * O cliente se responsabiliza pela transcricao? Usado no upload: com o
 * aparelho (ou online, ou desligada) o servidor nao enfileira nada.
 */
export async function clientOwnsTranscription(): Promise<boolean> {
  return clientOwnsStage((await transcriptionPlace()).place);
}
