/**
 * Uso de armazenamento local. Puro e testavel: soma o que esta no banco para
 * mostrar ao usuario quanto ocupa no aparelho.
 */

import type { Recording } from './types';

export interface StorageUsage {
  noteCount: number;
  /** Notas com audio local. */
  withAudio: number;
  /** Notas ja sincronizadas que ainda tem audio local (candidatas a liberar). */
  syncedWithAudio: number;
  /** Bytes de audio guardados localmente. */
  audioBytes: number;
}

export function storageUsage(recordings: Recording[]): StorageUsage {
  let audioBytes = 0;
  let withAudio = 0;
  let syncedWithAudio = 0;
  for (const recording of recordings) {
    if (!recording.filePath) continue;
    withAudio += 1;
    audioBytes += recording.sizeBytes ?? 0;
    if (recording.status === 'completed') syncedWithAudio += 1;
  }
  return {
    noteCount: recordings.length,
    withAudio,
    syncedWithAudio,
    audioBytes,
  };
}
