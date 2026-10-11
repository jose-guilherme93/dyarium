/**
 * Maquina de estados da fila de gravacoes. Puro: recebe um Recording e devolve
 * um novo Recording. Nada de IO aqui.
 */

import { nextAttemptDelayMs } from './backoff';
import type { Recording } from './types';

function nowIso(now: Date): string {
  return now.toISOString();
}

/** Marca como pronta para envio (apos concatenar os segmentos). */
export function markRecorded(
  r: Recording,
  filePath: string,
  sizeBytes: number,
  durationMs: number,
  now = new Date(),
): Recording {
  return {
    ...r,
    status: 'recorded',
    filePath,
    sizeBytes,
    durationMs,
    updatedAt: nowIso(now),
  };
}

/** Marca como enfileirada para envio. */
export function markQueued(r: Recording, now = new Date()): Recording {
  return { ...r, status: 'queued', updatedAt: nowIso(now) };
}

/** Upload iniciado (ou retomado): guarda o id e o offset confirmado. */
export function markUploading(
  r: Recording,
  uploadId: string,
  offset: number,
  now = new Date(),
): Recording {
  return { ...r, status: 'uploading', uploadId, offset, updatedAt: nowIso(now) };
}

/** Progresso do upload (offset confirmado pelo servidor). */
export function markProgress(r: Recording, offset: number, now = new Date()): Recording {
  return { ...r, offset, updatedAt: nowIso(now) };
}

/** Upload concluido: entrada criada no servidor. */
export function markCompleted(r: Recording, entryId: string, now = new Date()): Recording {
  return {
    ...r,
    status: 'completed',
    entryId,
    offset: r.sizeBytes ?? r.offset,
    lastError: undefined,
    nextAttemptAt: undefined,
    updatedAt: nowIso(now),
  };
}

/** Falha: incrementa tentativas e agenda o proximo retry. */
export function markFailed(r: Recording, error: string, now = new Date()): Recording {
  const attempts = r.attempts + 1;
  const delay = nextAttemptDelayMs(attempts);
  return {
    ...r,
    status: 'failed',
    attempts,
    lastError: error,
    nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
    updatedAt: nowIso(now),
  };
}

/** Uma gravacao esta pronta para (re)tentar agora? */
export function isDue(r: Recording, now = new Date()): boolean {
  if (r.status === 'uploading') return true; // retomar
  if (r.status !== 'queued' && r.status !== 'failed') return false;
  if (!r.nextAttemptAt) return true;
  return new Date(r.nextAttemptAt).getTime() <= now.getTime();
}

/**
 * Escolhe a proxima gravacao a enviar. Prioriza uma retomada (uploading) e
 * depois a mais antiga entre as devidas. Uma por vez (o servidor exige chunks
 * sequenciais).
 */
export function pickNextToUpload(recordings: Recording[], now = new Date()): Recording | undefined {
  const resuming = recordings.find((r) => r.status === 'uploading');
  if (resuming) return resuming;
  const due = recordings
    .filter((r) => isDue(r, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return due[0];
}
