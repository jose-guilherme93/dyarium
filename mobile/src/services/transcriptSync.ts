/**
 * Envia ao servidor a transcricao atual da nota. Best-effort: uma falha nao muda
 * o estado local. Chamado depois de transcrever localmente, depois de subir o
 * audio (caso o entryId chegue depois) e apos editar um trecho.
 */

import { DyariumApi, type FetchLike } from '@/core/api';

import { getRecording } from './db';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export async function pushTranscript(id: string): Promise<void> {
  const recording = await getRecording(id);
  if (!recording?.entryId) return;
  const text = (recording.transcript ?? '').trim();
  if (!text) return;

  const config = await loadServerConfig();
  if (!config) return;
  try {
    const api = new DyariumApi(config, doFetch);
    await api.putTranscript(recording.entryId, {
      language: recording.transcriptLanguage,
      text,
      segments: (recording.transcriptSegments ?? []).map((segment) => ({
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        text: segment.text,
      })),
    });
  } catch {
    // best-effort: tenta de novo no proximo gatilho
  }
}
