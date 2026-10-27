/**
 * Busca a transcricao das gravacoes ja enviadas. Enquanto o servidor ainda
 * estiver transcrevendo, `GET /entries/{id}/transcript` responde 404; nesse caso
 * mantemos pendente e tentamos de novo depois.
 */

import { ApiError, DyariumApi, type FetchLike } from '@/core/api';
import { reviewHash } from '@/core/transcriptReview';
import { needsTranscript, type Recording } from '@/core/types';

import { notify } from './notifications';
import { listRecordings, upsertRecording } from './db';
import { loadServerConfig } from './secure';
import { emitRecording } from './uploaderLoop';

const doFetch = globalThis.fetch as unknown as FetchLike;

let running = false;
// Backoff por entrada quando o servidor responde 404 (ainda transcrevendo).
// Sem isso, cada ciclo de 8 s pedia /transcript de todas as notas pendentes.
const retryAt = new Map<string, number>();
const retryDelay = new Map<string, number>();
const MAX_RETRY_MS = 5 * 60_000;

export async function fetchTranscriptsOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const config = await loadServerConfig();
    if (!config) return;
    const api = new DyariumApi(config, doFetch);
    const recordings = await listRecordings();
    for (const recording of recordings) {
      if (!needsTranscript(recording)) continue;
      const entryId = recording.entryId as string;
      if ((retryAt.get(entryId) ?? 0) > Date.now()) continue;
      try {
        const transcript = await api.getTranscript(entryId);
        const updated: Recording = {
          ...recording,
          transcript: transcript.text,
          transcriptLanguage: transcript.language,
          transcriptStatus: 'ready',
          transcriptSegments: transcript.segments,
          // Revisao feita no servidor: o aparelho reaproveita em vez de gastar
          // bateria revisando de novo.
          transcriptReview:
            transcript.revised_prompt_version && transcript.revised_prompt_version > 0
              ? {
                  model: transcript.revised_model ?? '',
                  promptVersion: transcript.revised_prompt_version,
                  literal: transcript.revised_literal === true,
                  comprehension: transcript.revised_comprehension ?? -1,
                  hash: reviewHash(transcript.segments ?? []),
                }
              : recording.transcriptReview,
          updatedAt: new Date().toISOString(),
        };
        await upsertRecording(updated);
        emitRecording(updated);
        retryAt.delete(entryId);
        retryDelay.delete(entryId);
        // Aviso generico (sem conteudo sensivel).
        void notify('Transcrição pronta', 'Uma nota sua foi transcrita.');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // ainda transcrevendo no servidor: espera mais a cada tentativa
          const delay = Math.min((retryDelay.get(entryId) ?? 4_000) * 2, MAX_RETRY_MS);
          retryDelay.set(entryId, delay);
          retryAt.set(entryId, Date.now() + delay);
          continue;
        }
        // outros erros (rede, etc.): mantem pendente e tenta de novo depois
      }
    }
  } finally {
    running = false;
  }
}
