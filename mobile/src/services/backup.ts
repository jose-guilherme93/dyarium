/**
 * Backup local: copia todas as notas (texto, transcricao, audio e imagens) para
 * uma pasta escolhida pelo usuario, e restaura de la. O manifesto guarda a lista
 * em ordem; os arquivos vao com o id da nota no nome para nao colidir.
 *
 * A pasta e escolhida via SAF (`Directory.pickDirectoryAsync`), entao serve
 * qualquer local do aparelho (Downloads, cartao SD, etc.).
 */

import { Directory, File } from 'expo-file-system';

import {
  BACKUP_FOLDER,
  BACKUP_MANIFEST,
  backupFileName,
  baseName,
  buildManifest,
  orderForBackup,
  parseManifest,
  toRestoredRecording,
  type BackupManifest,
  type BackupNote,
} from '@/core/backup';
import type { Recording } from '@/core/types';

import { listRecordings, upsertRecording } from './db';
import { sessionDirectory, sessionDirUri } from './files';

export interface BackupSummary {
  notes: number;
  files: number;
  bytes: number;
}

export type BackupProgress = (done: number, total: number) => void;

function mimeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'aac':
      return 'audio/aac';
    case 'm4a':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

/** Cria (ou reusa) um arquivo de destino, apagando o anterior. */
function targetFile(parent: Directory, name: string, mime: string): File {
  const existing = new File(parent, name);
  if (existing.exists) existing.delete();
  return parent.createFile(name, mime);
}

function folderOf(uri: string): Directory {
  const dir = new Directory(uri);
  if (!dir.exists) throw new Error('backup_folder_missing');
  return dir;
}

/**
 * Abre o seletor de pasta e devolve o uri da pasta de backup. Tenta uma
 * subpasta `Dyarium`; se nao der (SAF sem suporte), usa a pasta escolhida.
 */
export async function pickBackupFolder(initialUri?: string): Promise<string> {
  const picked = await Directory.pickDirectoryAsync(initialUri);
  const root = new Directory(picked, BACKUP_FOLDER);
  try {
    if (!root.exists) root.create({ idempotent: true });
    return root.uri;
  } catch {
    return picked.uri;
  }
}

function noteFiles(recording: Recording): File[] {
  const dir = sessionDirectory(recording.id);
  if (!dir.exists) return [];
  return dir.list().filter((entry): entry is File => entry instanceof File);
}

/** Copia tudo para a pasta escolhida (audio, imagens, texto no manifesto). */
export async function runBackup(
  folderUri: string,
  onProgress?: BackupProgress,
): Promise<BackupSummary> {
  const folder = folderOf(folderUri);
  const recordings = orderForBackup(await listRecordings());
  const notes: BackupNote[] = [];
  let files = 0;
  let bytes = 0;

  for (let i = 0; i < recordings.length; i += 1) {
    const recording = recordings[i];
    const names: string[] = [];
    for (const file of noteFiles(recording)) {
      const target = targetFile(folder, backupFileName(recording.id, file.name), mimeOf(file.name));
      await file.copy(target, { overwrite: true });
      names.push(file.name);
      files += 1;
      bytes += file.size;
    }
    notes.push({
      // Sem os caminhos absolutos: serao refeitos no restore.
      recording: { ...recording, dir: '', filePath: undefined },
      audioFile: baseName(recording.filePath),
      files: names,
    });
    onProgress?.(i + 1, recordings.length);
  }

  const manifest = buildManifest(notes, new Date());
  const manifestFile = targetFile(folder, BACKUP_MANIFEST, 'application/json');
  manifestFile.write(JSON.stringify(manifest));
  bytes += manifestFile.size;

  return { notes: notes.length, files, bytes };
}

/** Le o manifesto da pasta (para mostrar o que tem antes de restaurar). */
export async function readManifest(folderUri: string): Promise<BackupManifest | null> {
  const folder = new Directory(folderUri);
  const manifestFile = new File(folder, BACKUP_MANIFEST);
  if (!manifestFile.exists) return null;
  return parseManifest(await manifestFile.text());
}

/** Restaura as notas da pasta para o aparelho, na ordem do manifesto. */
export async function runRestore(
  folderUri: string,
  onProgress?: BackupProgress,
): Promise<BackupSummary> {
  const folder = folderOf(folderUri);
  const manifest = await readManifest(folder.uri);
  if (!manifest) throw new Error('backup_manifest_invalid');

  const total = manifest.notes.length;
  let files = 0;
  let bytes = 0;

  for (let i = 0; i < total; i += 1) {
    const entry = manifest.notes[i];
    const recording = entry.recording;
    const destination = sessionDirectory(recording.id);
    for (const name of entry.files) {
      const source = new File(folder, backupFileName(recording.id, name));
      if (!source.exists) continue;
      const target = new File(destination, name);
      if (target.exists) target.delete();
      await source.copy(target, { overwrite: true });
      files += 1;
      bytes += source.size;
    }
    await upsertRecording(
      toRestoredRecording(recording, sessionDirUri(recording.id), entry.audioFile),
    );
    onProgress?.(i + 1, total);
  }

  return { notes: total, files, bytes };
}
