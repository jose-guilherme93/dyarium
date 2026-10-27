/**
 * Envia ao servidor a transcricao atual da nota. Best-effort: uma falha nao muda
 * o estado local. Chamado depois de transcrever localmente, depois de subir o
 * audio (caso o entryId chegue depois) e apos editar um trecho.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { rawTranscript } from '@/core/transcriptReview';

import { getRecording, listRecordings } from './db';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export async function pushTranscript(id: string): Promise<boolean> {
  const recording = await getRecording(id);
  if (!recording?.entryId) return true;
  // Transcricao pela metade NAO sobe. O dashboard mostrava o texto parcial como
  // se fosse o final e a nota ficava com a transcricao cortada quando o app
  // fechava antes do fim; o texto completo sobe quando o estado vira `ready`.
  if (recording.transcriptStatus === 'pending' || recording.transcriptStatus === 'failed') {
    return true;
  }
  const segments = recording.transcriptSegments ?? [];
  const visible = (recording.transcript ?? '').trim();
  // O servidor guarda o texto cru do whisper; o revisado sobe como derivado,
  // para o original continuar intacto.
  const raw = rawTranscript(segments, visible);
  if (!raw && !visible) return true;
  const review = recording.transcriptReview;
  // A revisao sobe mesmo quando nao mudou nada: o servidor precisa saber que a
  // passada rodou, senao "nada a corrigir" fica igual a "nao revisado".
  const hasRevision = Boolean(review && review.model);

  const config = await loadServerConfig();
  if (!config) return true;
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
    // Ja esta no servidor com o mesmo texto visivel (cru ou revisado): nao
    // reenvia a transcricao, mas a revisao ainda pode faltar la. Uma versao
    // local bem menor que a do servidor e uma transcricao que parou no meio:
    // nao pode sobrescrever o texto completo que ja esta la.
    const localChars = Math.max(raw.trim().length, visible.length);
    const truncated = Boolean(serverText && localChars < serverText.trim().length * 0.8);
    const needsTranscript =
      !truncated &&
      (serverText === undefined || (serverText !== raw && serverText !== visible));
    if (needsTranscript) {
      await api.putTranscript(recording.entryId, {
        attachment_id: attachmentId,
        language: recording.transcriptLanguage,
        text: raw,
        segments: segments.map((segment) => ({
          start_ms: segment.start_ms,
          end_ms: segment.end_ms,
          text: segment.text,
          edited: segment.edited,
        })),
      });
    }

    if (review && hasRevision) {
      await api.putTranscriptRevisions(recording.entryId, {
        attachment_id: attachmentId,
        model: review.model,
        prompt_version: review.promptVersion,
        literal: review.literal,
        comprehension: review.comprehension,
        rejected: review.rejected ?? 0,
        // Sem marcador a passada foi ate o fim (revisoes antigas e as que vem
        // do servidor); um numero menor significa que ainda falta trecho.
        reviewed_through: review.reviewedThrough ?? segments.length,
        segments: segments
          .map((segment, idx) => ({ idx, segment }))
          .filter(({ segment }) => !segment.edited)
          .map(({ idx, segment }) => ({ idx, text: segment.revised ?? segment.text })),
      });
    }
    return true;
  } catch {
    // best-effort: tenta de novo no proximo gatilho
    return false;
  }
}

/** Teto de notas por varredura: uma biblioteca grande nao prende o app. */
const PUSH_SWEEP_LIMIT = 100;

let sweeping = false;

/**
 * Empurra as transcricoes que ja estao no aparelho e ainda nao chegaram ao
 * servidor: nota transcrita numa versao anterior do app, envio que falhou
 * offline, ou transcricao feita antes de o audio subir. Compara o texto antes
 * de enviar e para na primeira falha de rede em vez de insistir em todas.
 */
export async function pushPendingTranscriptsOnce(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const recordings = await listRecordings();
    let checked = 0;
    for (const recording of recordings) {
      if (checked >= PUSH_SWEEP_LIMIT) break;
      if (!recording.entryId || recording.status !== 'completed') continue;
      // Notas vindas do servidor ja tem o texto la; nao gastam uma leitura.
      if (recording.transcriptOrigin === 'server') continue;
      // Pending/failed tem texto parcial: espera a transcricao terminar.
      if (recording.transcriptStatus !== 'ready' && recording.transcriptStatus !== undefined) continue;
      const hasText =
        (recording.transcript ?? '').trim() !== '' ||
        (recording.transcriptSegments?.length ?? 0) > 0;
      if (!hasText) continue;
      checked += 1;
      const ok = await pushTranscript(recording.id);
      if (!ok) break;
    }
  } finally {
    sweeping = false;
  }
}
