/**
 * Varredura real do armazenamento local: pastas das notas, modelos, caches,
 * banco e espaco livre do aparelho. A agregacao fica no nucleo (`core/storage`).
 */

import { Directory, File, Paths } from 'expo-file-system';

import {
  aggregateStorage,
  storageFileKind,
  type NoteStorageUsage,
  type StorageCacheUsage,
  type StorageReport,
} from '@/core/storage';
import { displayTitle } from '@/core/title';
import type { Recording } from '@/core/types';

import { installedAnalysisModelsBytes } from './analysisModels';
import { databaseBytes } from './db';
import { directoryBytes, sessionFiles } from './files';
import { installedModelsBytes } from './transcriptionModels';

/** Arquivos de audio temporarios mais novos que isso nao entram na limpeza. */
const AUDIO_TEMP_AGE_MS = 60 * 60 * 1000;

const CACHE_DIRS: { id: string; label: string; name: string }[] = [
  { id: 'attachments', label: 'Anexos baixados', name: 'attachments' },
  { id: 'whisper', label: 'WAV de transcricao', name: 'whisper' },
  { id: 'restore', label: 'Restauracao de backup', name: 'dyarium-restore' },
];

function cacheDirectory(id: string): Directory | null {
  const entry = CACHE_DIRS.find((item) => item.id === id);
  return entry ? new Directory(Paths.cache, entry.name) : null;
}

function audioTempDirectory(): Directory {
  return new Directory(Paths.cache, 'Audio');
}

function oldAudioTempFiles(): File[] {
  const dir = audioTempDirectory();
  if (!dir.exists) return [];
  const now = Date.now();
  const out: File[] = [];
  for (const entry of dir.list()) {
    if (!(entry instanceof File)) continue;
    const modified = entry.lastModified;
    if (typeof modified !== 'number') continue;
    if (now - modified >= AUDIO_TEMP_AGE_MS) out.push(entry);
  }
  return out;
}

function audioTempBytes(): number {
  let total = 0;
  for (const file of oldAudioTempFiles()) {
    try {
      total += file.size;
    } catch {
      // arquivo em uso: ignora
    }
  }
  return total;
}

/** Caches conhecidos e regeneraveis. Nao inclui modelos nem o banco. */
export function scanStorageCaches(): StorageCacheUsage[] {
  const caches = CACHE_DIRS.map((entry) => {
    const dir = cacheDirectory(entry.id);
    return {
      id: entry.id,
      label: entry.label,
      bytes: dir ? directoryBytes(dir) : 0,
    };
  });
  caches.push({ id: 'audio-temp', label: 'Audio temporario', bytes: audioTempBytes() });
  return caches;
}

/** Apaga um cache conhecido e devolve os bytes liberados. */
export function clearStorageCache(id: string): number {
  if (id === 'audio-temp') {
    let freed = 0;
    for (const file of oldAudioTempFiles()) {
      try {
        const size = file.size;
        file.delete();
        freed += size;
      } catch {
        // arquivo em uso: fica para a proxima
      }
    }
    return freed;
  }

  const dir = cacheDirectory(id);
  if (!dir || !dir.exists) return 0;
  const freed = directoryBytes(dir);
  dir.delete();
  return freed;
}

/** Limpa todos os caches regeneraveis e devolve o total liberado. */
export function clearAllStorageCaches(): number {
  return scanStorageCaches().reduce((sum, cache) => sum + clearStorageCache(cache.id), 0);
}

function noteUsage(recording: Recording): NoteStorageUsage {
  let audioBytes = 0;
  let imageBytes = 0;
  let otherBytes = 0;

  for (const file of sessionFiles(recording.id)) {
    try {
      const size = file.size;
      switch (storageFileKind(file.name)) {
        case 'audio':
          audioBytes += size;
          break;
        case 'image':
          imageBytes += size;
          break;
        default:
          otherBytes += size;
      }
    } catch {
      // arquivo inacessivel: ignora
    }
  }

  const synced = recording.status === 'completed' && Boolean(recording.entryId);
  return {
    id: recording.id,
    title: displayTitle(recording),
    archived: Boolean(recording.archived),
    status: recording.status,
    synced,
    audioBytes,
    imageBytes,
    otherBytes,
    totalBytes: audioBytes + imageBytes + otherBytes,
    canFreeAudio: synced && audioBytes > 0,
  };
}

function diskSpace(): { freeBytes: number | null; totalBytes: number | null } {
  let freeBytes: number | null = null;
  let totalBytes: number | null = null;
  try {
    freeBytes = Paths.availableDiskSpace;
  } catch {
    // aparelho nao informou o espaco livre
  }
  try {
    totalBytes = Paths.totalDiskSpace;
  } catch {
    // aparelho nao informou o total
  }
  return { freeBytes, totalBytes };
}

/** Mesma marca de imagem que as metricas contam no texto da nota. */
const IMAGE_MARKDOWN = /!\[[^\]]*\]\(/;

/** Notas por bloco na varredura assincrona (cada bloco cede a thread). */
const IMAGE_SCAN_BATCH = 10;

/** Bytes de imagem de uma nota; null quando o texto nao tem imagem. */
function imageBytesOf(recording: Recording): number | null {
  // A metrica de imagens so consulta notas que tem imagem no texto. Sem este
  // filtro, cada recálculo listava a pasta de TODAS as notas com chamadas
  // sincronas de filesystem na thread de JS; numa biblioteca grande isso
  // segurava o app por varios segundos, inclusive no inicio de uma gravacao.
  if (!IMAGE_MARKDOWN.test(recording.text ?? '')) return null;
  let bytes = 0;
  try {
    for (const file of sessionFiles(recording.id)) {
      if (storageFileKind(file.name) !== 'image') continue;
      try {
        bytes += file.size;
      } catch {
        // arquivo inacessivel: ignora
      }
    }
  } catch {
    // pasta ilegivel: ignora a nota
  }
  return bytes;
}

/** Bytes de imagem por id local da nota, para as metricas do Painel e o snapshot. */
export function scanImageBytes(recordings: Recording[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const recording of recordings) {
    const bytes = imageBytesOf(recording);
    if (bytes) out[recording.id] = bytes;
  }
  return out;
}

/**
 * A mesma varredura, em blocos.
 *
 * Ler pastas e sincrono no expo-file-system: numa biblioteca com muitas imagens
 * a varredura inteira segurava o primeiro desenho do Painel. Aqui cada bloco
 * devolve a thread para a interface antes do proximo.
 */
export async function scanImageBytesAsync(
  recordings: Recording[],
  {
    batchSize = IMAGE_SCAN_BATCH,
    yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  }: { batchSize?: number; yieldToUI?: () => Promise<void> } = {},
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const size = Math.max(1, batchSize);
  // Só as notas com imagem entram na fila (mesma condicao da versao sincrona).
  const pending = recordings.filter((recording) => IMAGE_MARKDOWN.test(recording.text ?? ''));
  for (let index = 0; index < pending.length; index += 1) {
    const bytes = imageBytesOf(pending[index]);
    if (bytes) out[pending[index].id] = bytes;
    const done = index + 1;
    if (done < pending.length && done % size === 0) await yieldToUI();
  }
  return out;
}

/** Relatorio completo da tela de armazenamento. */
export async function scanStorage(recordings: Recording[]): Promise<StorageReport> {
  const notes: NoteStorageUsage[] = [];
  for (const recording of recordings) {
    try {
      const usage = noteUsage(recording);
      if (usage.totalBytes > 0) notes.push(usage);
    } catch {
      // pasta ilegivel: ignora a nota nesta varredura
    }
  }

  let transcriptionBytes = 0;
  let analysisBytes = 0;
  try {
    transcriptionBytes = installedModelsBytes();
  } catch {
    // modelos de transcricao indisponiveis
  }
  try {
    analysisBytes = installedAnalysisModelsBytes();
  } catch {
    // modelos de analise indisponiveis
  }

  const database = await databaseBytes().catch(() => 0);
  const disk = diskSpace();

  return aggregateStorage({
    notes,
    models: { transcriptionBytes, analysisBytes },
    caches: scanStorageCaches(),
    databaseBytes: database,
    freeBytes: disk.freeBytes,
    totalBytes: disk.totalBytes,
    noteCount: recordings.length,
  });
}
