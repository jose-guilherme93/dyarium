/**
 * Busca a transcricao das gravacoes ja enviadas. Enquanto o servidor ainda
 * estiver transcrevendo, `GET /entries/{id}/transcript` responde 404; nesse caso
 * mantemos pendente e tentamos de novo depois.
 */

import { ApiError, DyariumApi, type FetchLike, type ServerEntry } from '@/core/api';
import { mergeServerTranscript, reviewFromServer } from '@/core/transcriptReview';
import { needsTranscript, type Recording } from '@/core/types';

import { notify } from './notifications';
import {
  listRecordings,
  setTranscriptSyncAt,
  getTranscriptSyncAt,
  upsertRecording,
} from './db';
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
        const segments = transcript.segments ?? [];
        const updated: Recording = {
          ...recording,
          transcript: transcript.text,
          transcriptLanguage: transcript.language,
          // A transcricao veio do servidor: o app nao pode reenvia-la como se
          // tivesse transcrito aqui. Sem esta marca, cada abertura do app
          // substituia a linha no servidor, criava uma notificacao falsa e
          // apagava a compreensao da revisao.
          transcriptOrigin: 'server',
          transcriptStatus: 'ready',
          // Marca explicita de transcricao pronta: e o que impede a fila local
          // de refazer o texto que veio do servidor.
          hasTranscript: true,
          transcriptSegments: segments,
          // Revisao feita no servidor: o aparelho reaproveita em vez de gastar
          // bateria revisando de novo. O estado da passada (fim, alcance e
          // recusados) vem junto, senao o chip ficava preso em "revisando".
          transcriptReview:
            reviewFromServer(transcript, segments) ?? recording.transcriptReview,
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

/**
 * Traz as transcricoes que mudaram no servidor desde o ultimo pull. O sinal e
 * `transcript_at` da lista de entradas; a busca acontece uma vez por mudanca.
 * Uma nota sem transcricao local recebe a do servidor; uma nota ja pronta
 * reaproveita as revisoes pelo mesmo merge usado antes.
 */
export async function syncServerTranscripts(
  entries: ServerEntry[],
  recordings: Recording[],
): Promise<number> {
  const config = await loadServerConfig();
  if (!config) return 0;
  const api = new DyariumApi(config, doFetch);
  const byEntry = new Map<string, Recording>();
  for (const recording of recordings) {
    if (!recording.entryId || recording.deletedAt) continue;
    byEntry.set(recording.entryId, recording);
  }

  let changed = 0;
  for (const entry of entries) {
    if (!entry.id || !entry.transcript_at) continue;
    const sourceAt = entry.transcript_at;
    if ((await getTranscriptSyncAt(entry.id)) === sourceAt) continue;
    const recording = byEntry.get(entry.id);
    if (!recording) {
      await setTranscriptSyncAt(entry.id, sourceAt);
      continue;
    }
    try {
      if (recording.transcriptStatus === 'ready') {
        const merged = await refreshServerTranscript(recording);
        if (merged) changed += 1;
      } else if (recording.transcriptOrigin !== 'local') {
        // Nota ainda sem transcricao local: adota a do servidor com a mesma
        // marca de origem, para nao reenviar como se tivesse sido feita aqui.
        const transcript = await api.getTranscript(entry.id);
        const segments = transcript.segments ?? [];
        const updated: Recording = {
          ...recording,
          transcript: transcript.text,
          transcriptLanguage: transcript.language,
          transcriptOrigin: 'server',
          transcriptStatus: 'ready',
          hasTranscript: true,
          transcriptSegments: segments,
          transcriptReview:
            reviewFromServer(transcript, segments) ?? recording.transcriptReview,
          updatedAt: new Date().toISOString(),
        };
        await upsertRecording(updated);
        emitRecording(updated);
        changed += 1;
      }
      await setTranscriptSyncAt(entry.id, sourceAt);
    } catch {
      // Rede/5xx: o marcador fica como esta e o proximo pull tenta de novo.
    }
  }
  return changed;
}

/**
 * Confere no servidor se a revisao de uma nota pronta mudou desde o ultimo pull
 * (outro aparelho, o dashboard) e atualiza a copia local. Devolve a gravacao
 * nova, ou `null` quando nada mudou ou quando a copia local vence.
 *
 * Nao avisa nada: nao e uma transcricao nova, so o mesmo texto revisado de novo.
 */
export async function refreshServerTranscript(recording: Recording): Promise<Recording | null> {
  if (!recording.entryId || recording.transcriptStatus !== 'ready') return null;
  const config = await loadServerConfig();
  if (!config) return null;
  const api = new DyariumApi(config, doFetch);
  const transcript = await api.getTranscript(recording.entryId);
  const merged = mergeServerTranscript(recording, transcript);
  if (!merged) return null;
  await upsertRecording(merged);
  emitRecording(merged);
  return merged;
}
