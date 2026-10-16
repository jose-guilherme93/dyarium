/**
 * Busca a transcricao das gravacoes ja enviadas. Enquanto o servidor ainda
 * estiver transcrevendo, `GET /entries/{id}/transcript` responde 404; nesse caso
 * mantemos pendente e tentamos de novo depois.
 */

import { ApiError, DyariumApi, type FetchLike } from '@/core/api';
import { needsTranscript, type Recording } from '@/core/types';

import { notify } from './notifications';
import { listRecordings, upsertRecording } from './db';
import { loadServerConfig } from './secure';
import { emitRecording } from './uploaderLoop';

const doFetch = globalThis.fetch as unknown as FetchLike;

let running = false;

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
      try {
        const transcript = await api.getTranscript(recording.entryId as string);
        const updated: Recording = {
          ...recording,
          transcript: transcript.text,
          transcriptLanguage: transcript.language,
          transcriptStatus: 'ready',
          transcriptSegments: transcript.segments,
          updatedAt: new Date().toISOString(),
        };
        await upsertRecording(updated);
        emitRecording(updated);
        // Aviso generico (sem conteudo sensivel).
        void notify('Transcrição pronta', 'Uma nota sua foi transcrita.');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // ainda transcrevendo no servidor; tenta de novo no proximo ciclo
          continue;
        }
        // outros erros (rede, etc.): mantem pendente e tenta de novo depois
      }
    }
  } finally {
    running = false;
  }
}
