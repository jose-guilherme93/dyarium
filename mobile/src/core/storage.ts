/**
 * Uso de armazenamento local. Puro e testavel: classifica arquivos, agrega
 * categorias e decide o que pode ser liberado com seguranca.
 *
 * A leitura real das pastas fica no servico `storageScan`; aqui vive so a
 * matematica e as regras que queremos testar sem tocar no sistema de arquivos.
 */

import type { Recording, RecordingStatus } from './types';

export interface StorageUsage {
  noteCount: number;
  /** Notas com audio local. */
  withAudio: number;
  /** Notas ja sincronizadas que ainda tem audio local (candidatas a liberar). */
  syncedWithAudio: number;
  /** Bytes de audio guardados localmente. */
  audioBytes: number;
}

export type StorageFileKind = 'audio' | 'image' | 'other';

const AUDIO_EXTENSIONS = new Set([
  'aac',
  'm4a',
  'mp3',
  'wav',
  'ogg',
  'opus',
  'flac',
  'caf',
  'amr',
]);

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif']);

/** Classifica um arquivo da pasta da nota pelo nome. */
export function storageFileKind(name: string): StorageFileKind {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return 'other';
}

export type StorageCategoryId =
  | 'audio'
  | 'images'
  | 'models-transcription'
  | 'models-analysis'
  | 'cache'
  | 'database'
  | 'other';

export interface StorageCategory {
  id: StorageCategoryId;
  bytes: number;
}

export interface NoteStorageUsage {
  id: string;
  title: string;
  archived: boolean;
  status: RecordingStatus;
  /** Nota ja enviada ao servidor (o audio local e descartavel). */
  synced: boolean;
  audioBytes: number;
  imageBytes: number;
  otherBytes: number;
  totalBytes: number;
  /** Ha audio local e o servidor ja tem a nota. */
  canFreeAudio: boolean;
}

export interface StorageModelUsage {
  transcriptionBytes: number;
  analysisBytes: number;
}

export interface StorageCacheUsage {
  id: string;
  label: string;
  bytes: number;
}

export interface StorageInput {
  notes: NoteStorageUsage[];
  models: StorageModelUsage;
  caches: StorageCacheUsage[];
  databaseBytes: number;
  freeBytes: number | null;
  totalBytes: number | null;
  noteCount: number;
}

export interface StorageReport {
  categories: StorageCategory[];
  appBytes: number;
  freeBytes: number | null;
  totalBytes: number | null;
  /** Poco espaco livre no aparelho (abaixo de 1 GB ou 5%). */
  lowSpace: boolean;
  /** Notas com arquivos locais, da maior para a menor. */
  notes: NoteStorageUsage[];
  caches: StorageCacheUsage[];
  models: StorageModelUsage;
  noteCount: number;
  withAudio: number;
  syncedWithAudio: number;
  /** Notas com arquivos que ainda nao estao no servidor. */
  protectedNotes: number;
}

const LOW_SPACE_BYTES = 1024 ** 3;
const LOW_SPACE_RATIO = 0.05;

/**
 * Agrega o relatorio da tela. Ordena as notas por tamanho e calcula categorias,
 * cobertura e alerta de espaco. Nao le disco.
 */
export function aggregateStorage(input: StorageInput): StorageReport {
  const notes = [...input.notes]
    .filter((note) => note.totalBytes > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes);

  let audioBytes = 0;
  let imageBytes = 0;
  let otherBytes = 0;
  for (const note of notes) {
    audioBytes += note.audioBytes;
    imageBytes += note.imageBytes;
    otherBytes += note.otherBytes;
  }

  const cacheBytes = input.caches.reduce((sum, cache) => sum + cache.bytes, 0);
  const categories: StorageCategory[] = [
    { id: 'audio', bytes: audioBytes },
    { id: 'images', bytes: imageBytes },
    { id: 'models-transcription', bytes: input.models.transcriptionBytes },
    { id: 'models-analysis', bytes: input.models.analysisBytes },
    { id: 'cache', bytes: cacheBytes },
    { id: 'database', bytes: input.databaseBytes },
    { id: 'other', bytes: otherBytes },
  ];
  const appBytes = categories.reduce((sum, category) => sum + category.bytes, 0);

  const free = input.freeBytes;
  const lowSpace =
    free !== null &&
    free >= 0 &&
    (free < LOW_SPACE_BYTES ||
      (input.totalBytes !== null && input.totalBytes > 0 && free / input.totalBytes < LOW_SPACE_RATIO));

  return {
    categories,
    appBytes,
    freeBytes: input.freeBytes,
    totalBytes: input.totalBytes,
    lowSpace,
    notes,
    caches: input.caches,
    models: input.models,
    noteCount: input.noteCount,
    withAudio: notes.filter((note) => note.audioBytes > 0).length,
    syncedWithAudio: notes.filter((note) => note.canFreeAudio).length,
    protectedNotes: notes.filter((note) => !note.synced).length,
  };
}

/** Uso resumido a partir dos metadados das notas (compatibilidade). */
export function storageUsage(recordings: Recording[]): StorageUsage {
  let audioBytes = 0;
  let withAudio = 0;
  let syncedWithAudio = 0;
  for (const recording of recordings) {
    if (!recording.filePath) continue;
    withAudio += 1;
    audioBytes += recording.sizeBytes ?? 0;
    if (recording.status === 'completed') syncedWithAudio += 1;
  }
  return {
    noteCount: recordings.length,
    withAudio,
    syncedWithAudio,
    audioBytes,
  };
}
