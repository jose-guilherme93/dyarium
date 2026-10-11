/**
 * Orquestra o upload resumivel de UMA gravacao. O servidor exige chunks
 * sequenciais (X-Upload-Offset precisa bater com o offset esperado), entao o
 * loop e estritamente serial e retoma do offset devolvido em 409.
 *
 * Toda a IO e injetada: testavel com uma API falsa e um arquivo em memoria.
 */

import { ApiError, type DyariumApi } from './api';

export interface UploadFileIO {
  size(path: string): Promise<number>;
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
}

export interface UploadCallbacks {
  /** Chamado quando o upload e criado no servidor (persista o id). */
  onUploadCreated?(uploadId: string, offset: number): void | Promise<void>;
  /** Chamado a cada avanco do offset confirmado. */
  onProgress?(sent: number, total: number): void | Promise<void>;
}

export interface UploadInput {
  clientKey: string;
  filename: string;
  contentType: string;
  title: string;
  recordedAt: string;
  localPath: string;
  sizeBytes: number;
  durationSeconds?: number;
  /** Texto da nota associado ao audio (opcional). */
  text?: string;
  /** Se ja existe um upload em andamento, informe id e offset para retomar. */
  uploadId?: string;
  offset?: number;
}

export interface UploadDeps {
  api: DyariumApi;
  file: UploadFileIO;
  chunkSize?: number;
  callbacks?: UploadCallbacks;
}

export interface UploadResult {
  uploadId: string;
  entryId: string;
  sizeBytes: number;
  /** true quando o servidor encontraram um audio identico (dedupe). */
  duplicate?: boolean;
}

export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

export async function uploadRecording(
  input: UploadInput,
  deps: UploadDeps,
): Promise<UploadResult> {
  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (chunkSize <= 0) throw new Error('chunkSize deve ser positivo');

  const total = input.sizeBytes;
  let uploadId = input.uploadId;
  let offset = input.offset ?? 0;

  if (!uploadId) {
    const created = await deps.api.createUpload({
      client_key: input.clientKey,
      filename: input.filename,
      content_type: input.contentType,
      size_bytes: total,
      duration_seconds: input.durationSeconds,
      title: input.title,
      recorded_at: input.recordedAt,
      text: input.text,
    });
    uploadId = created.id;
    offset = created.offset ?? 0;
    await deps.callbacks?.onUploadCreated?.(uploadId, offset);
  } else {
    const state = await deps.api.getUpload(uploadId);
    offset = state.offset ?? offset;
  }

  await deps.callbacks?.onProgress?.(offset, total);

  while (offset < total) {
    const length = Math.min(chunkSize, total - offset);
    const bytes = await deps.file.read(input.localPath, offset, length);
    if (bytes.length === 0) throw new Error('leitura retornou zero bytes');
    try {
      const res = await deps.api.putChunk(uploadId, offset, bytes);
      offset = res.offset;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.offset === 'number') {
        offset = err.offset; // servidor adianta/recua; releia daqui
        await deps.callbacks?.onProgress?.(offset, total);
        continue;
      }
      throw err;
    }
    await deps.callbacks?.onProgress?.(offset, total);
  }

  const done = await deps.api.completeUpload(uploadId);
  return { uploadId, entryId: done.entry_id, sizeBytes: total, duplicate: done.duplicate };
}
