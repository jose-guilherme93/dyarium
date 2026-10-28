/**
 * Backup local: copia todas as notas (texto, transcricao, audio e imagens) para
 * uma pasta escolhida pelo usuario, e restaura de la — com verificacao.
 *
 * Como e confiavel:
 * - Cada midia leva o md5 do conteudo no nome (`<id>__<md5>__<nome>`), entao
 *   reexecutar nao reescreve o que ja existe (dedup) e arquivos antigos podem
 *   ser apagados sem risco.
 * - O manifesto e escrito por ultimo: um backup interrompido nao invalida o
 *   anterior (o manifesto anterior continua valido).
 * - Ao restaurar, cada arquivo e copiado para uma area temporaria e o md5 e
 *   conferido ANTES de entrar na nota; qualquer divergencia aborta.
 *
 * IO via API legacy (StorageAccessFramework): a API nova resolve mal os filhos
 * de uma arvore SAF (apontam para a raiz). Escrita binaria em chunks base64.
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';
import Constants from 'expo-constants';

import {
  BACKUP_MANIFEST,
  backupMediaName,
  baseName,
  buildManifest,
  bytesToBase64,
  isBackupMediaName,
  nameFromDocumentUri,
  orderForBackup,
  orderNotesForRestore,
  parseManifest,
  toRestoredRecording,
  type BackupFile,
  type BackupNote,
} from '@/core/backup';
import { DEFAULT_NOTEBOOK_ID } from '@/core/notebooks';
import type { Recording } from '@/core/types';

import { listRecordings, upsertRecording } from './db';
import { sessionDirectory, sessionDirUri } from './files';
import { listNotebooks, restoreLocalNotebook } from './notebooks';

export interface BackupSummary {
  notes: number;
  files: number;
  bytes: number;
}

export interface BackupInfo extends BackupSummary {
  createdAt: string;
  appVersion?: string;
}

export type BackupProgress = (done: number, total: number) => void;

export type BackupErrorCode =
  | 'folder_denied'
  | 'manifest_missing'
  | 'manifest_invalid'
  | 'corrupt'
  | 'hash_failed'
  | 'cancelled';

/** Como parar um backup/restauracao em andamento. */
export interface BackupRunOptions {
  /** Conferido entre uma nota e outra: parar nunca deixa a nota pela metade. */
  shouldStop?: () => boolean;
}

/** Erro com codigo, para a tela mostrar uma mensagem clara. */
export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode) {
    super(code);
    this.name = 'BackupError';
    this.code = code;
  }
}

/** Tamanho de cada chunk escrito no SAF (mantem a memoria baixa). */
const WRITE_CHUNK = 256 * 1024;
const STAGE_DIR = 'dyarium-restore';

function appVersion(): string | undefined {
  return Constants.expoConfig?.version ?? undefined;
}

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

function md5Of(uri: string): string {
  const hash = new File(uri).md5;
  if (!hash) throw new BackupError('hash_failed');
  return hash;
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

/** Le a pasta e resume o backup que esta nela (ou null se nao houver). */
export async function readManifestSummary(folderUri: string): Promise<BackupInfo | null> {
  const existing = await listFolder(folderUri);
  const uri = existing.get(BACKUP_MANIFEST);
  if (!uri) return null;
  const manifest = parseManifest(await Legacy.readAsStringAsync(uri));
  if (!manifest) return null;
  let files = 0;
  let bytes = 0;
  for (const note of manifest.notes) {
    files += note.files.length;
    for (const file of note.files) bytes += file.size;
  }
  return {
    notes: manifest.notes.length,
    files,
    bytes,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
  };
}

/** Copia tudo para a pasta escolhida (audio, imagens, texto no manifesto). */
export async function runBackup(
  folderUri: string,
  onProgress?: BackupProgress,
  options: BackupRunOptions = {},
): Promise<BackupSummary> {
  const recordings = orderForBackup(await listRecordings());
  const notebooks = await listNotebooks();
  const existing = await listFolder(folderUri);
  const referenced = new Set<string>();
  const notes: BackupNote[] = [];
  let files = 0;
  let bytes = 0;

  for (let i = 0; i < recordings.length; i += 1) {
    if (options.shouldStop?.()) throw new BackupError('cancelled');
    const recording = recordings[i];
    const backed: BackupFile[] = [];
    for (const file of noteFiles(recording)) {
      const md5 = md5Of(file.uri);
      const name = backupMediaName(recording.id, md5, file.name);
      referenced.add(name);
      // Ja existe com o mesmo conteudo (mesmo md5)? Nao reescreve.
      if (!existing.has(name)) {
        const safUri = await Legacy.StorageAccessFramework.createFileAsync(
          folderUri,
          name,
          mimeOf(file.name),
        );
        await writeLocalToSaf(file.uri, safUri);
        existing.set(name, safUri);
      }
      backed.push({ name, originalName: file.name, md5, size: file.size });
      files += 1;
      bytes += file.size;
    }
    notes.push({
      // Sem os caminhos absolutos: serao refeitos no restore.
      recording: { ...recording, dir: '', filePath: undefined },
      audioFile: baseName(recording.filePath),
      files: backed,
    });
    onProgress?.(i + 1, recordings.length);
  }

  // Manifesto por ultimo: so fica valido quando tudo ja foi escrito. Parar
  // antes disso mantem o manifesto anterior intacto.
  if (options.shouldStop?.()) throw new BackupError('cancelled');
  await removeChild(existing, BACKUP_MANIFEST);
  const manifestUri = await Legacy.StorageAccessFramework.createFileAsync(
    folderUri,
    BACKUP_MANIFEST,
    'application/json',
  );
  await Legacy.writeAsStringAsync(
    manifestUri,
    JSON.stringify(buildManifest(notes, new Date(), appVersion(), notebooks)),
  );
  existing.set(BACKUP_MANIFEST, manifestUri);

  // Limpa midias antigas que o manifesto novo nao referencia.
  for (const [name, uri] of [...existing]) {
    if (name === BACKUP_MANIFEST) continue;
    if (isBackupMediaName(name) && !referenced.has(name)) {
      await Legacy.deleteAsync(uri, { idempotent: true });
    }
  }

  return { notes: notes.length, files, bytes };
}

/** Restaura as notas da pasta para o aparelho, na ordem, conferindo cada arquivo. */
export async function runRestore(
  folderUri: string,
  onProgress?: BackupProgress,
  options: BackupRunOptions = {},
): Promise<BackupSummary> {
  const existing = await listFolder(folderUri);
  const manifestUri = existing.get(BACKUP_MANIFEST);
  if (!manifestUri) throw new BackupError('manifest_missing');
  const manifest = parseManifest(await Legacy.readAsStringAsync(manifestUri));
  if (!manifest) throw new BackupError('manifest_invalid');

  // Cadernos primeiro: as notas restauradas precisam de um lugar. Backups
  // antigos nao trazem cadernos; nesse caso as notas caem no padrao.
  for (const notebook of manifest.notebooks ?? []) {
    await restoreLocalNotebook(notebook);
  }
  const knownNotebooks = new Set((await listNotebooks()).map((notebook) => notebook.id));
  knownNotebooks.add(DEFAULT_NOTEBOOK_ID);

  const notes = orderNotesForRestore(manifest.notes);
  const stageRoot = new Directory(Paths.cache, STAGE_DIR);
  if (stageRoot.exists) stageRoot.delete();

  const total = notes.length;
  let files = 0;
  let bytes = 0;

  for (let i = 0; i < total; i += 1) {
    // So entre notas: uma nota em restauracao termina inteira.
    if (options.shouldStop?.()) throw new BackupError('cancelled');
    const entry = notes[i];
    const recording = entry.recording;
    const stage = new Directory(stageRoot, recording.id);
    stage.create({ intermediates: true, idempotent: true });

    // 1) Copia para a area temporaria e confere o md5 de cada arquivo.
    for (const file of entry.files) {
      const source = existing.get(file.name);
      if (!source) throw new BackupError('corrupt');
      const staged = new File(stage, file.originalName);
      if (staged.exists) staged.delete();
      await Legacy.copyAsync({ from: source, to: staged.uri });
      if (md5Of(staged.uri) !== file.md5) throw new BackupError('corrupt');
    }

    // 2) So depois de conferir tudo, poe na pasta da nota e grava no banco.
    const destination = sessionDirectory(recording.id);
    for (const file of entry.files) {
      const staged = new File(stage, file.originalName);
      const target = new File(destination, file.originalName);
      if (target.exists) target.delete();
      await staged.move(target);
    }
    stage.delete();
    // `updatedAt` = agora: a restauracao e uma mudanca local. Marca tambem que
    // esta nota e mais nova que qualquer exclusao antiga do servidor (uma nota
    // apagada e trazida de volta nao pode ser apagada de novo por causa disso).
    await upsertRecording({
      ...toRestoredRecording(recording, sessionDirUri(recording.id), entry.audioFile),
      notebookId:
        recording.notebookId && knownNotebooks.has(recording.notebookId)
          ? recording.notebookId
          : DEFAULT_NOTEBOOK_ID,
      updatedAt: new Date().toISOString(),
    });
    files += entry.files.length;
    bytes += entry.files.reduce((sum, file) => sum + file.size, 0);
    onProgress?.(i + 1, total);
  }

  if (stageRoot.exists) stageRoot.delete();
  return { notes: total, files, bytes };
}
