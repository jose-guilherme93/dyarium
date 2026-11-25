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
import * as Legacy from 'expo-file-system/legacy';

import { isAdtsHeader } from '@/core/concat';
import type { ConcatIO } from '@/core/concat';
import { storageFileKind } from '@/core/storage';
import type { UploadFileIO } from '@/core/uploader';

const ROOT_NAME = 'recordings';
const AUDIO_DIR_NAME = 'Audio';

export const CONTENT_TYPE = 'audio/aac';
export const FILE_EXTENSION = '.aac';

function rootDirectory(): Directory {
  return new Directory(Paths.document, ROOT_NAME);
}

function root(): Directory {
  const dir = rootDirectory();
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

/** Nome unico de um audio anexado a uma nota (varias gravacoes no mesmo corpo). */
export function audioFileName(sessionId: string): string {
  return `audio-${sessionId}${FILE_EXTENSION}`;
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
/**
 * Copia o arquivo compartilhado para o diretorio da sessao, preservando os
 * bytes (o audio original e imutavel). A API nova (`File.copy`) funciona para
 * URIs `file://`; para `content://` (SAF do Android) ela nao le o conteudo, por
 * isso caimos para `expo-file-system/legacy` (`copyAsync`), que suporta essas
 * URIs. Se a copia pela API nova falhar por outro motivo, tentamos o mesmo
 * caminho legado antes de desistir.
 */
export async function copySharedAudio(
  sourceUri: string,
  sessionId: string,
  extension: string,
  options?: { onProgress?: (copied: number, total: number, name: string) => void },
): Promise<{ uri: string; size: number }> {
  // A extensao nunca vem do nome do arquivo: so caracteres alfanumericos.
  const safeExt = (extension || '').replace(/[^a-zA-Z0-9]/g, '');
  const suffix = safeExt ? `.${safeExt}` : '';
  const destination = new File(sessionDirectory(sessionId), `original${suffix}`);
  if (destination.exists) destination.delete();

  const isContentUri = sourceUri.startsWith('content://');

  // content:// nao e lido pela API nova: vai direto para o caminho suportado.
  if (!isContentUri) {
    try {
      const source = new File(sourceUri);
      await source.copy(destination);
      return { uri: destination.uri, size: destination.size };
    } catch {
      // cai para o caminho legado
    }
  }

  await Legacy.copyAsync({ from: sourceUri, to: destination.uri });
  return { uri: destination.uri, size: destination.size };
}

/** Data de modificacao do arquivo em ms, quando disponivel. */
export function fileModifiedMs(uri: string): number | undefined {
  // URIs content:// nao sao lidas pela API nova; devolve undefined em vez de
  // lancar (a data de modificacao nao e essencial para a revisao).
  if (uri.startsWith('content://')) return undefined;
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

export function newestRecorderFile(): File | null {
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
async function findRecording(
  sourceUri: string | undefined,
  allowFallback = true,
): Promise<File | null> {
  if (!sourceUri && !allowFallback) return null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (sourceUri) {
      const candidate = new File(sourceUri);
      if (candidate.exists && candidate.size > 0) return candidate;
    }
    if (allowFallback) {
      const newest = newestRecorderFile();
      if (newest) return newest;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (sourceUri) {
    const candidate = new File(sourceUri);
    if (candidate.exists && candidate.size > 0) return candidate;
  }
  return null;
}

/** Move o arquivo gravado para o diretorio da sessao. Retorna o uri ou null. */
export async function storeSegment(
  sessionId: string,
  index: number,
  sourceUri: string | undefined,
  allowFallback = true,
): Promise<string | null> {
  const file = await findRecording(sourceUri, allowFallback);
  if (!file) return null;
  const destination = new File(sessionDirectory(sessionId), segmentFileName(index));
  if (destination.exists) destination.delete();
  await file.move(destination);
  return destination.uri;
}

/** Tamanho somado dos arquivos de uma pasta (bytes). Entradas ilegiveis sao ignoradas. */
export function directoryBytes(dir: Directory): number {
  if (!dir.exists) return 0;
  let total = 0;
  for (const entry of dir.list()) {
    try {
      total += new File(entry.uri).size;
    } catch {
      // entrada ilegivel: ignora
    }
  }
  return total;
}

export function deleteSessionFiles(sessionId: string): void {
  if (!sessionId) return;
  const dir = new Directory(root(), sessionId);
  if (dir.exists) dir.delete();
}

/** Diretorio da sessao sem cria-lo (para varreduras de armazenamento). */
export function existingSessionDirectory(sessionId: string): Directory | null {
  if (!sessionId) return null;
  const dir = new Directory(rootDirectory(), sessionId);
  return dir.exists ? dir : null;
}

/** Arquivos da pasta da nota, sem criar nada quando a pasta nao existe. */
export function sessionFiles(sessionId: string): File[] {
  const dir = existingSessionDirectory(sessionId);
  if (!dir) return [];
  return dir.list().filter((entry): entry is File => entry instanceof File);
}

/** Verifica que a sessao tem ao menos um segmento de audio valido (ADTS). */
export function verifySessionAudio(sessionId: string): { files: number; bytes: number } {
  const dir = existingSessionDirectory(sessionId);
  if (!dir) throw new Error('nenhum segmento de audio na sessao');
  const segments = dir.list().filter(
    (entry): entry is File => entry instanceof File && entry.name.startsWith('seg-') && entry.name.endsWith(FILE_EXTENSION),
  );
  if (segments.length === 0) throw new Error('nenhum segmento de audio na sessao');
  let files = 0;
  let bytes = 0;
  for (const entry of segments) {
    const size = entry.size;
    if (size <= 0) throw new Error('segmento vazio: ' + entry.name);
    const header = readBytesAt(entry.uri, 0, 2);
    if (!isAdtsHeader(header[0], header[1])) throw new Error('cabecalho ADTS invalido em: ' + entry.name);
    files += 1;
    bytes += size;
  }
  return { files, bytes };
}

export interface FreedAudio {
  files: number;
  bytes: number;
}

/**
 * Remove somente os arquivos de audio da pasta da nota. Imagens, transcricao e
 * outros arquivos ficam. Se a pasta ficar vazia, ela tambem e removida.
 */
export function deleteSessionAudioFiles(sessionId: string): FreedAudio {
  const dir = existingSessionDirectory(sessionId);
  if (!dir) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const entry of dir.list()) {
    if (!(entry instanceof File)) continue;
    if (storageFileKind(entry.name) !== 'audio') continue;
    try {
      const size = entry.size;
      entry.delete();
      files += 1;
      bytes += size;
    } catch {
      // arquivo em uso ou ja removido: segue para os proximos
    }
  }
  if (files > 0) {
    try {
      if (dir.list().length === 0) dir.delete();
    } catch {
      // pasta com arquivo em uso: deixa para a proxima
    }
  }
  return { files, bytes };
}

/**
 * Move o audio concatenado da sessao de origem para o diretorio da nota destino,
 * removendo os arquivos temporarios da origem. Usado quando uma gravacao avulsa
 * e anexada a uma nota existente. Devolve o novo uri, ou null.
 */
export async function moveAudio(
  fromSessionId: string,
  toSessionId: string,
  fileName: string = outputFileName(),
): Promise<string | null> {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return null;
  const source = new File(sessionDirectory(fromSessionId), outputFileName());
  if (!source.exists) return null;
  const destination = new File(sessionDirectory(toSessionId), fileName);
  if (destination.exists) destination.delete();
  await source.move(destination);
  deleteSessionFiles(fromSessionId);
  return destination.uri;
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
