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
    // O servidor liga a transcricao ao audio por `attachment_id`. Sem ele, o
    // texto ficava solto na entrada e o dashboard mostrava audio sem texto.
    let attachmentId = recording.serverAttachmentId;
    let serverText: string | undefined;
    try {
      const entry = await api.getEntry(recording.entryId);
      const audios = entry.audios ?? [];
      if (!attachmentId) {
        if (audios.length === 1) {
          attachmentId = audios[0].id;
        } else if (audios.length > 1) {
          const durationMs = recording.durationMs ?? 0;
          const target =
            durationMs > 0
              ? audios.reduce((best, audio) =>
                  Math.abs(audio.duration_seconds * 1000 - durationMs) <
                  Math.abs(best.duration_seconds * 1000 - durationMs)
                    ? audio
                    : best,
                )
              : audios[audios.length - 1];
          attachmentId = target.id;
        }
      }
      if (attachmentId) {
        serverText = audios.find((audio) => audio.id === attachmentId)?.transcript?.text?.trim();
      }
    } catch {
      // Sem leitura da entrada seguimos com o id conhecido (ou deixamos o
      // servidor associar quando houver um unico audio).
    }
    // Ja esta no servidor com o mesmo texto: nada a fazer (evita reenvio e SSE
    // a cada abertura da nota).
    if (serverText === text) return;

    await api.putTranscript(recording.entryId, {
      attachment_id: attachmentId,
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
