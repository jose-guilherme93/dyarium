/**
 * Carregamento do whisper.rn e disponibilidade da transcricao local.
 *
 * Modulo leve (sem React e sem depender do loop de upload) para poder ser usado
 * de varios lugares sem criar ciclos de import.
 */

import { audioDecodeAvailable } from '../../modules/audio-decode';
import { clientOwnsStage, decideProcessing } from '@/core/processing';
import { loadPrefs, loadServerConfig } from './secure';
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

/** Onde a transcricao desta instalacao roda (ou se esta desligada). */
export async function transcriptionPlace() {
  const [prefs, server] = await Promise.all([loadPrefs(), loadServerConfig()]);
  const modelId = prefs.transcriptionModel;
  return decideProcessing({
    enabled: prefs.transcriptionEnabled === true,
    serverProcessing: prefs.serverProcessing === true,
    hasServer: Boolean(server),
    deviceCapable: localTranscriptionAvailable(),
    deviceReady: Boolean(modelId && isModelInstalled(modelId)),
  });
}

/**
 * O app vai transcrever no aparelho agora? So quando a etapa esta ligada,
 * escolhida para o aparelho e com o modelo baixado. Sem modelo a nota fica
 * pendente — nunca cai para o servidor sem o usuario pedir.
 */
export async function willTranscribeLocally(): Promise<boolean> {
  return (await transcriptionPlace()).runsOnDevice;
}

/**
 * O cliente se responsabiliza pela transcricao? Usado no upload: com o
 * aparelho responsavel (ou a etapa desligada) o servidor nao enfileira nada.
 */
export async function clientOwnsTranscription(): Promise<boolean> {
  return clientOwnsStage((await transcriptionPlace()).place);
}
