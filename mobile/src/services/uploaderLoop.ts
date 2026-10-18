/**
 * Worker da fila de envio. Um upload por vez (o servidor exige chunks
 * sequenciais). O estado e persistido no SQLite a cada avanco, entao o app pode
 * ser fechado ou morto e retoma do offset confirmado.
 */

import { DyariumApi, type FetchLike } from '@/core/api';
import { isPermanentUploadError } from '@/core/errors';
import { markCompleted, markFailed, markFailedTerminal, pickNextToUpload } from '@/core/queue';
import { mergeTranscript } from '@/core/transcript';
import { isTextNote, needsNoteSync, type Recording } from '@/core/types';
import { uploadRecording } from '@/core/uploader';

import { acquireLock, getRecording, listRecordings, releaseLock, upsertRecording } from './db';
import { CONTENT_TYPE, FILE_EXTENSION, uploadFileIO } from './files';
import { applySyncConflict, applySyncResult } from '@/core/noteSync';

import { conflictFields, syncNote, type SyncNoteResult } from './noteSync';
import { loadServerConfig } from './secure';
import { pushTranscript } from './transcriptSync';
import { willTranscribeLocally } from './whisper';

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
  let lock: string | null = null;
  try {
    // Trava no banco: evita que o worker em primeiro plano e o background task
    // processem a fila ao mesmo tempo.
    lock = await acquireLock('upload-queue').catch(() => null);
    if (!lock) return;
    const config = await loadServerConfig();
    if (!config) return;
    const api = new DyariumApi(config, doFetch);
    // Notas ja enviadas cujo corpo mudou. Cada uma e tentada uma vez por rodada:
    // se falhar (sem rede), o flag continua e a proxima rodada tenta de novo.
    const attemptedNotes = new Set<string>();
    for (;;) {
      const recordings = await listRecordings();
      const next = pickNextToUpload(recordings, new Date());
      if (next) {
        if (isTextNote(next)) {
          await uploadTextOne(api, next);
          continue;
        }
        if (!next.filePath || !next.sizeBytes) {
          // Sem arquivo local o reenvio nunca vai funcionar: falha permanente.
          const failed = markFailedTerminal(next, 'gravação sem arquivo local', new Date());
          await upsertRecording(failed);
          emitRecording(failed);
          continue;
        }
        await uploadOne(api, next);
        continue;
      }
      const dirtyNote = recordings.find((r) => needsNoteSync(r) && !attemptedNotes.has(r.id));
      if (!dirtyNote) break;
      attemptedNotes.add(dirtyNote.id);
      await pushNoteDocument(dirtyNote);
    }
  } finally {
    if (lock) await releaseLock('upload-queue', lock).catch(() => undefined);
    running = false;
  }
}

/**
 * Depois de enviar o conteudo (entrada criada), envia o corpo da nota em markdown
 * e guarda o noteId. Assim o corpo sobe junto, sem esperar um re-edit.
 *
 * Conflito (409): o servidor recusou porque o campo ja mudou no desktop. Nao
 * sobrescreve nada e nao devolve a nota para a fila — registra o conflito para a
 * tela da nota perguntar ao usuario.
 */
async function pushNoteDocument(recording: Recording): Promise<Recording> {
  let result: SyncNoteResult | undefined;
  try {
    result = await syncNote(recording);
  } catch (error) {
    const fields = conflictFields(error);
    if (fields.length === 0) return recording;
    const current = (await getRecording(recording.id)) ?? recording;
    const conflicted = applySyncConflict(current, fields);
    await upsertRecording(conflicted);
    emitRecording(conflicted);
    return conflicted;
  }
  if (!result) return recording;
  // Relê o registro: se o usuario editou a nota durante o envio, nao sobrescreve
  // nem limpa o flag (o proximo sync leva a edicao mais nova).
  const fresh = (await getRecording(recording.id)) ?? recording;
  const updated = applySyncResult(fresh, recording, result);
  await upsertRecording(updated);
  emitRecording(updated);
  // Se a nota ja tinha transcricao antes do upload, envia o texto.
  void pushTranscript(recording.id);
  return updated;
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
    // Se o app vai transcrever no aparelho, avisa o servidor para nao enfileirar.
    const localTranscribe = await willTranscribeLocally();
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
        localTranscribe,
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
    // Relê o registro antes de gravar: a transcricao local pode ter ficado pronta
    // durante o upload. Preserva o texto/segmentos e nunca rebaixa para "pending"
    // (senao a nota ficava "Transcrevendo" para sempre).
    const fresh = (await getRecording(current.id)) ?? current;
    current = {
      ...mergeTranscript(markCompleted(current, result.entryId, new Date()), fresh),
      serverAttachmentId: result.attachmentId ?? fresh.serverAttachmentId ?? current.serverAttachmentId,
      duplicate: result.duplicate ? true : undefined,
    };
    await upsertRecording(current);
    emitRecording(current);
    current = await pushNoteDocument(current);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha no envio';
    current = isPermanentUploadError(error)
      ? markFailedTerminal(current, message, new Date())
      : markFailed(current, message, new Date());
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
      id: current.id,
      client_key: current.id,
      title: current.title,
      recorded_at: current.recordedAt,
      created_at: current.createdAt,
      text: current.text ?? '',
    });
    current = {
      ...markCompleted(current, result.id, new Date()),
      transcriptStatus: 'ready',
      duplicate: result.duplicate ? true : undefined,
    };
    await upsertRecording(current);
    emitRecording(current);
    current = await pushNoteDocument(current);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha no envio';
    current = isPermanentUploadError(error)
      ? markFailedTerminal(current, message, new Date())
      : markFailed(current, message, new Date());
    await upsertRecording(current);
    emitRecording(current);
  }
}
