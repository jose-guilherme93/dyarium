/**
 * Worker da fila de envio. Um upload por vez (o servidor exige chunks
 * sequenciais). O estado e persistido no SQLite a cada avanco, entao o app pode
 * ser fechado ou morto e retoma do offset confirmado.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { markCompleted, markFailed, pickNextToUpload } from '@/core/queue';
import type { Recording } from '@/core/types';
import { uploadRecording } from '@/core/uploader';

import { listRecordings, upsertRecording } from './db';
import { CONTENT_TYPE, FILE_EXTENSION, uploadFileIO } from './files';
import { loadServerConfig } from './secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

type Observer = (recording: Recording) => void;
const observers = new Set<Observer>();

export function observeUploads(observer: Observer): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

function emit(recording: Recording): void {
  for (const observer of observers) observer(recording);
}

let running = false;

/** Roda a fila ate nao haver mais nada a enviar (ou ate o servidor faltar). */
export async function runUploadQueueOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const config = await loadServerConfig();
    if (!config) return;
    const api = new DyariumApi(config, doFetch);
    for (;;) {
      const recordings = await listRecordings();
      const next = pickNextToUpload(recordings, new Date());
      if (!next) break;
      if (!next.filePath || !next.sizeBytes) {
        // Sem arquivo local nao ha o que enviar: marca falha e segue para o
        // proximo (nao trava a fila inteira).
        const failed = markFailed(next, 'gravacao sem arquivo local', new Date());
        await upsertRecording(failed);
        emit(failed);
        continue;
      }
      await uploadOne(api, next);
    }
  } finally {
    running = false;
  }
}

async function uploadOne(api: DyariumApi, recording: Recording): Promise<void> {
  let current: Recording = {
    ...recording,
    status: 'uploading',
    updatedAt: new Date().toISOString(),
  };
  await upsertRecording(current);
  emit(current);

  try {
    const result = await uploadRecording(
      {
        clientKey: current.id,
        filename: `${current.id}${FILE_EXTENSION}`,
        contentType: CONTENT_TYPE,
        title: current.title,
        recordedAt: current.recordedAt,
        localPath: current.filePath as string,
        sizeBytes: current.sizeBytes as number,
        durationSeconds: current.durationMs
          ? Math.max(1, Math.round(current.durationMs / 1000))
          : undefined,
        uploadId: current.uploadId,
        offset: current.offset,
      },
      {
        api,
        file: uploadFileIO,
        callbacks: {
          onUploadCreated: async (uploadId, offset) => {
            current = { ...current, uploadId, offset, updatedAt: new Date().toISOString() };
            await upsertRecording(current);
            emit(current);
          },
          onProgress: async (sent) => {
            current = { ...current, offset: sent, updatedAt: new Date().toISOString() };
            await upsertRecording(current);
            emit(current);
          },
        },
      },
    );
    current = markCompleted(current, result.entryId, new Date());
    await upsertRecording(current);
    emit(current);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha no envio';
    current = markFailed(current, message, new Date());
    await upsertRecording(current);
    emit(current);
  }
}
