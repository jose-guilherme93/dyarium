/**
 * Backup local: copia todas as notas (texto, transcricao, audio e imagens) para
 * uma pasta escolhida pelo usuario, e restaura de la.
 *
 * A pasta vem do seletor do Android (SAF), entao o IO usa a API legacy do
 * expo-file-system: a API nova (File/Directory) resolve mal os filhos de uma
 * arvore SAF (apontam para a raiz, o que chega a apagar a pasta escolhida). A
 * legacy tem funcoes dedicadas (`StorageAccessFramework`) que resolvem certo.
 *
 * Escrita binaria no SAF nao tem copia direta: escrevemos em chunks base64
 * (memoria limitada). A leitura de volta usa `copyAsync` (SAF -> arquivo local).
 */

import { File, FileMode } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';

import {
  BACKUP_MANIFEST,
  backupFileName,
  baseName,
  buildManifest,
  bytesToBase64,
  nameFromDocumentUri,
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

/** Tamanho de cada chunk escrito no SAF (mantem a memoria baixa). */
const WRITE_CHUNK = 256 * 1024;

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

function noteFiles(recording: Recording): File[] {
  const dir = sessionDirectory(recording.id);
  if (!dir.exists) return [];
  return dir.list().filter((entry): entry is File => entry instanceof File);
}

/** Abre o seletor de pasta e devolve o uri (arvore SAF), ou null se cancelar. */
export async function pickBackupFolder(initialUri?: string): Promise<string | null> {
  const result = await Legacy.StorageAccessFramework.requestDirectoryPermissionsAsync(
    initialUri ?? null,
  );
  if (!result.granted || !result.directoryUri) return null;
  return result.directoryUri;
}

/** Mapa nome do arquivo -> uri, dos arquivos que ja existem na pasta. */
async function listFolder(folderUri: string): Promise<Map<string, string>> {
  const uris = await Legacy.StorageAccessFramework.readDirectoryAsync(folderUri);
  const map = new Map<string, string>();
  for (const uri of uris) map.set(nameFromDocumentUri(uri), uri);
  return map;
}

async function removeChild(existing: Map<string, string>, name: string): Promise<void> {
  const uri = existing.get(name);
  if (!uri) return;
  await Legacy.deleteAsync(uri, { idempotent: true });
  existing.delete(name);
}

/** Escreve um arquivo local no SAF, em chunks base64 (sem carregar tudo na RAM). */
async function writeLocalToSaf(localUri: string, safUri: string): Promise<void> {
  const handle = new File(localUri).open(FileMode.ReadOnly);
  try {
    let chunk = handle.readBytes(WRITE_CHUNK);
    if (chunk.length === 0) {
      await Legacy.writeAsStringAsync(safUri, '', { encoding: 'base64' });
      return;
    }
    let first = true;
    while (chunk.length > 0) {
      await Legacy.writeAsStringAsync(safUri, bytesToBase64(chunk), {
        encoding: 'base64',
        append: !first,
      });
      first = false;
      chunk = handle.readBytes(WRITE_CHUNK);
    }
  } finally {
    handle.close();
  }
}

/** Le o manifesto da pasta (para mostrar o que tem antes de restaurar). */
export async function readManifest(folderUri: string): Promise<BackupManifest | null> {
  const existing = await listFolder(folderUri);
  const uri = existing.get(BACKUP_MANIFEST);
  if (!uri) return null;
  return parseManifest(await Legacy.readAsStringAsync(uri));
}

/** Copia tudo para a pasta escolhida (audio, imagens, texto no manifesto). */
export async function runBackup(
  folderUri: string,
  onProgress?: BackupProgress,
): Promise<BackupSummary> {
  const recordings = orderForBackup(await listRecordings());
  const existing = await listFolder(folderUri);
  const notes: BackupNote[] = [];
  let files = 0;
  let bytes = 0;

  for (let i = 0; i < recordings.length; i += 1) {
    const recording = recordings[i];
    const names: string[] = [];
    for (const file of noteFiles(recording)) {
      const name = backupFileName(recording.id, file.name);
      await removeChild(existing, name);
      const safUri = await Legacy.StorageAccessFramework.createFileAsync(
        folderUri,
        name,
        mimeOf(file.name),
      );
      await writeLocalToSaf(file.uri, safUri);
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

  await removeChild(existing, BACKUP_MANIFEST);
  const manifestUri = await Legacy.StorageAccessFramework.createFileAsync(
    folderUri,
    BACKUP_MANIFEST,
    'application/json',
  );
  await Legacy.writeAsStringAsync(manifestUri, JSON.stringify(buildManifest(notes, new Date())));

  return { notes: notes.length, files, bytes };
}

/** Restaura as notas da pasta para o aparelho, na ordem do manifesto. */
export async function runRestore(
  folderUri: string,
  onProgress?: BackupProgress,
): Promise<BackupSummary> {
  const existing = await listFolder(folderUri);
  const manifestUri = existing.get(BACKUP_MANIFEST);
  if (!manifestUri) throw new Error('backup_manifest_missing');
  const manifest = parseManifest(await Legacy.readAsStringAsync(manifestUri));
  if (!manifest) throw new Error('backup_manifest_invalid');

  const total = manifest.notes.length;
  let files = 0;
  let bytes = 0;

  for (let i = 0; i < total; i += 1) {
    const entry = manifest.notes[i];
    const recording = entry.recording;
    const destination = sessionDirectory(recording.id);
    for (const name of entry.files) {
      const source = existing.get(backupFileName(recording.id, name));
      if (!source) continue;
      const target = new File(destination, name);
      if (target.exists) target.delete();
      await Legacy.copyAsync({ from: source, to: target.uri });
      files += 1;
      bytes += new File(target.uri).size;
    }
    await upsertRecording(
      toRestoredRecording(recording, sessionDirUri(recording.id), entry.audioFile),
    );
    onProgress?.(i + 1, total);
  }

  return { notes: total, files, bytes };
}
