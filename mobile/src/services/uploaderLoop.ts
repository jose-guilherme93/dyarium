/**
 * Worker da fila de envio. Um upload por vez (o servidor exige chunks
 * sequenciais). O estado e persistido no SQLite a cada avanco, entao o app pode
 * ser fechado ou morto e retoma do offset confirmado.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { markCompleted, markFailed, pickNextToUpload } from '@/core/queue';
import { isTextNote, type Recording } from '@/core/types';
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

export function emitRecording(recording: Recording): void {
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
      if (isTextNote(next)) {
        await uploadTextOne(api, next);
        continue;
      }
      if (!next.filePath || !next.sizeBytes) {
        // Sem arquivo local nao ha o que enviar: marca falha e segue para o
        // proximo (nao trava a fila inteira).
        const failed = markFailed(next, 'gravacao sem arquivo local', new Date());
        await upsertRecording(failed);
        emitRecording(failed);
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
  emitRecording(current);

  try {
    const result = await uploadRecording(
      {
        clientKey: current.id,
        filename: current.fileName ?? `${current.id}${FILE_EXTENSION}`,
        contentType: current.contentType ?? CONTENT_TYPE,
        title: current.title,
        recordedAt: current.recordedAt,
        localPath: current.filePath as string,
        sizeBytes: current.sizeBytes as number,
        text: current.text,
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
            emitRecording(current);
          },
          onProgress: async (sent) => {
            current = { ...current, offset: sent, updatedAt: new Date().toISOString() };
            await upsertRecording(current);
            emitRecording(current);
          },
        },
      },
    );
    current = {
      ...markCompleted(current, result.entryId, new Date()),
      transcriptStatus: 'pending',
      duplicate: result.duplicate ? true : undefined,
    };
    await upsertRecording(current);
    emitRecording(current);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha no envio';
    current = markFailed(current, message, new Date());
    await upsertRecording(current);
    emitRecording(current);
  }
}

/**
 * Envia uma nota somente texto. O texto e tratado pelo servidor como se fosse a
 * transcricao, mas marcado como nota de texto. O endpoint ainda nao existe no
 * servidor; ate la a nota fica na fila e reenta com backoff.
 */
async function uploadTextOne(api: DyariumApi, recording: Recording): Promise<void> {
  let current: Recording = {
    ...recording,
    status: 'uploading',
    updatedAt: new Date().toISOString(),
  };
  await upsertRecording(current);
  emitRecording(current);

  try {
    const result = await api.createTextEntry({
      client_key: current.id,
      title: current.title,
      recorded_at: current.recordedAt,
      text: current.text ?? '',
    });
    current = {
      ...markCompleted(current, result.entry_id, new Date()),
      transcriptStatus: 'ready',
      duplicate: result.duplicate ? true : undefined,
    };
    await upsertRecording(current);
    emitRecording(current);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha no envio';
    current = markFailed(current, message, new Date());
    await upsertRecording(current);
    emitRecording(current);
  }
}
