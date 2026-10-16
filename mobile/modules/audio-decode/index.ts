/**
 * Decodificacao de audio para o whisper (modulo nativo local).
 *
 * O app grava AAC em ADTS, que o whisper.cpp nao le. Este modulo decodifica o
 * audio para WAV PCM 16-bit mono a 16 kHz. Sem modulo nativo (build antigo) as
 * funcoes ficam indisponiveis e a transcricao local nao roda.
 */

import { requireOptionalNativeModule } from 'expo';

interface AudioDecodeModule {
  /** Decodifica `sourcePath` (file://) para um WAV 16 kHz em `targetPath`. */
  decodeToWav(sourcePath: string, targetPath: string): Promise<string>;
}

const native = requireOptionalNativeModule<AudioDecodeModule>('AudioDecode');

export function audioDecodeAvailable(): boolean {
  return native != null;
}

export function decodeToWav(sourcePath: string, targetPath: string): Promise<string> {
  if (!native) return Promise.reject(new Error('decodificacao de audio indisponivel'));
  return native.decodeToWav(sourcePath, targetPath);
}
