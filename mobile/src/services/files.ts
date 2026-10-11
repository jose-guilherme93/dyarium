/**
 * IO de arquivos do app, via expo-file-system (API nova: File/Directory/Paths).
 * Os segmentos e o arquivo concatenado vivem no diretorio de documentos, que
 * nao e apagado pelo sistema.
 *
 * Nota (Android / expo-audio): o `recorder.uri` pode apontar para um arquivo
 * errado ou zerado (issue expo/expo#39646). Por isso `storeSegment` prefere o
 * uri quando ele tem conteudo, mas cai para o arquivo mais recente e nao-vazio
 * do diretorio `Audio/` do proprio expo-audio.
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';

import type { ConcatIO } from '@/core/concat';
import type { UploadFileIO } from '@/core/uploader';

const ROOT_NAME = 'recordings';
const AUDIO_DIR_NAME = 'Audio';

export const CONTENT_TYPE = 'audio/aac';
export const FILE_EXTENSION = '.aac';

function root(): Directory {
  const dir = new Directory(Paths.document, ROOT_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function sessionDirectory(sessionId: string): Directory {
  const dir = new Directory(root(), sessionId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function sessionDirUri(sessionId: string): string {
  return sessionDirectory(sessionId).uri;
}

export function segmentFileName(index: number): string {
  return `seg-${String(index).padStart(3, '0')}${FILE_EXTENSION}`;
}

export function outputFileName(): string {
  return `recording${FILE_EXTENSION}`;
}

export function outputFileUri(sessionId: string): string {
  return new File(sessionDirectory(sessionId), outputFileName()).uri;
}

/**
 * Copia o arquivo compartilhado para o diretorio da sessao, preservando os
 * bytes (o audio original e imutavel). O `copy` nativo cobre o caso comum
 * (uri file://); se falhar, cai para copia por bytes, que tambem funciona para
 * uris content:// (SAF). Retorna o uri local e o tamanho em bytes.
 */
export async function copySharedAudio(
  sourceUri: string,
  sessionId: string,
  extension: string,
): Promise<{ uri: string; size: number }> {
  const source = new File(sourceUri);
  const suffix = extension.startsWith('.') ? extension : `.${extension}`;
  const destination = new File(sessionDirectory(sessionId), `original${suffix}`);
  if (destination.exists) destination.delete();
  try {
    await source.copy(destination);
  } catch {
    destination.create({ intermediates: true, overwrite: true });
    const chunkSize = 1 << 20;
    const input = source.open(FileMode.ReadOnly);
    const output = destination.open(FileMode.Append);
    try {
      let chunk = input.readBytes(chunkSize);
      while (chunk.length > 0) {
        output.writeBytes(chunk);
        chunk = input.readBytes(chunkSize);
      }
    } finally {
      input.close();
      output.close();
    }
  }
  return { uri: destination.uri, size: destination.size };
}

/** Data de modificacao do arquivo em ms, quando disponivel. */
export function fileModifiedMs(uri: string): number | undefined {
  try {
    const value = new File(uri).lastModified;
    return typeof value === 'number' && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Le bytes nativamente via FileHandle, sem Blob. `File.slice()`/`File.write()`
 * criam Blobs, que o React Native rejeita ("Creating blobs from ArrayBuffer...").
 */
function readBytesAt(path: string, offset: number, length: number): Uint8Array {
  const handle = new File(path).open(FileMode.ReadOnly);
  try {
    if (offset > 0) handle.offset = offset;
    return handle.readBytes(length);
  } finally {
    handle.close();
  }
}

/** Diretorios onde o expo-audio grava (`<document|cache>/Audio`). */
function audioDirectories(): Directory[] {
  return [new Directory(Paths.document, AUDIO_DIR_NAME), new Directory(Paths.cache, AUDIO_DIR_NAME)];
}

/** Arquivos .aac nao-vazios que o expo-audio deixou nos diretorios Audio/. */
function recorderFiles(): File[] {
  const files: File[] = [];
  for (const dir of audioDirectories()) {
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      if (!entry.name.endsWith(FILE_EXTENSION)) continue;
      const file = new File(entry.uri);
      if (file.size > 0) files.push(file);
    }
  }
  return files;
}

function newestRecorderFile(): File | null {
  const files = recorderFiles();
  if (files.length === 0) return null;
  files.sort((a, b) => (b.info().modificationTime ?? 0) - (a.info().modificationTime ?? 0));
  return files[0];
}

/**
 * Localiza o arquivo gravado. Primeiro confia no uri informado; se ele nao
 * existir ou estiver zerado, procura o mais recente em Audio/. Tenta algumas
 * vezes porque o arquivo pode levar um instante para ser finalizado.
 */
async function findRecording(sourceUri: string | undefined): Promise<File | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (sourceUri) {
      const candidate = new File(sourceUri);
      if (candidate.exists && candidate.size > 0) return candidate;
    }
    const newest = newestRecorderFile();
    if (newest) return newest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/** Move o arquivo gravado para o diretorio da sessao. Retorna o uri ou null. */
export async function storeSegment(
  sessionId: string,
  index: number,
  sourceUri: string | undefined,
): Promise<string | null> {
  const file = await findRecording(sourceUri);
  if (!file) return null;
  const destination = new File(sessionDirectory(sessionId), segmentFileName(index));
  if (destination.exists) destination.delete();
  await file.move(destination);
  return destination.uri;
}

export function deleteSessionFiles(sessionId: string): void {
  if (!sessionId) return;
  const dir = new Directory(root(), sessionId);
  if (dir.exists) dir.delete();
}

/** IO injetavel para a concatenacao (ver core/concat.ts). */
export const concatIO: ConcatIO = {
  async listSegments(dirUri: string): Promise<string[]> {
    const dir = new Directory(dirUri);
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((entry) => entry.name.startsWith('seg-') && entry.name.endsWith(FILE_EXTENSION))
      .map((entry) => entry.uri);
  },
  async size(path: string): Promise<number> {
    return new File(path).size;
  },
  async read(path: string, offset: number, length: number): Promise<Uint8Array> {
    return readBytesAt(path, offset, length);
  },
  async append(outPath: string, bytes: Uint8Array): Promise<void> {
    const file = new File(outPath);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    // `File.write(Uint8Array)` tenta criar um Blob, que o React Native nao
    // suporta ("Creating blobs from ArrayBuffer..."). O FileHandle escreve os
    // bytes nativamente, sem Blob.
    const handle = file.open(FileMode.Append);
    try {
      handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
  },
};

/** IO injetavel para o uploader (ver core/uploader.ts). */
export const uploadFileIO: UploadFileIO = {
  async size(path: string): Promise<number> {
    return new File(path).size;
  },
  async read(path: string, offset: number, length: number): Promise<Uint8Array> {
    return readBytesAt(path, offset, length);
  },
};
