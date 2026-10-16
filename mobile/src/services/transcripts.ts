/**
 * Busca a transcricao das gravacoes ja enviadas. Enquanto o servidor ainda
 * estiver transcrevendo, `GET /entries/{id}/transcript` responde 404; nesse caso
 * mantemos pendente e tentamos de novo depois. Quando a transcricao falhou de
 * vez (a entrada ficou `failed`), paramos de consultar: era o que fazia o app
 * consultar para sempre um resultado que nunca chegaria.
 */

import { ApiError, DyariumApi, type FetchLike } from '@/core/api';
import { needsTranscript, type Recording } from '@/core/types';

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
      const entryId = recording.entryId as string;
      try {
        const transcript = await api.getTranscript(entryId);
        const updated: Recording = {
          ...recording,
          transcript: transcript.text,
          transcriptLanguage: transcript.language,
          transcriptStatus: 'ready',
          updatedAt: new Date().toISOString(),
        };
        await upsertRecording(updated);
        emitRecording(updated);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // Sem transcricao ainda. O status da entrada diz se ela vai chegar.
          if (await isTranscriptGone(api, entryId)) {
            await markTranscriptFailed(recording);
          }
          continue;
        }
        // outros erros (rede, etc.): mantem pendente e tenta de novo depois
      }
    }
  } finally {
    running = false;
  }
}

/** true quando a transcricao nao vira mais: entrada falha ou removida. */
async function isTranscriptGone(api: DyariumApi, entryId: string): Promise<boolean> {
  try {
    const entry = await api.getEntry(entryId);
    return entry.status === 'failed' || entry.status === 'deleted';
  } catch (error) {
    // 404: a entrada nao existe mais no servidor.
    return error instanceof ApiError && error.status === 404;
  }
}

async function markTranscriptFailed(recording: Recording): Promise<void> {
  const updated: Recording = {
    ...recording,
    transcriptStatus: 'failed',
    updatedAt: new Date().toISOString(),
  };
  await upsertRecording(updated);
  emitRecording(updated);
}
