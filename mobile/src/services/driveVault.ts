/**
 * O cofre do Drive visto pelo app.
 *
 * Le o formato que o web ja grava (`key.txt`, `backup.enc`, `manifest.json` e
 * os `.enc` por arquivo), aplica as notas e os anexos no banco do aparelho e
 * sobe de volta o retrato unido. Nao reescreve o layout do web: o app nao e
 * dono do `manifest.json` nem dos arquivos por nota, e sim um segundo leitor e
 * escritor do retrato.
 *
 * Regras duras:
 * - nada e apagado por ausencia;
 * - a chave do Drive precisa pertencer ao mesmo cofre ja usado neste aparelho;
 * - o retrato so e gravado quando existe diferenca, e sempre com a uniao dos
 *   dois lados (o mais novo por nota vence);
 * - nenhum token, codigo ou caminho de conta aparece em erro ou log.
 */

import { Directory, File, FileMode } from 'expo-file-system';
import { getRandomBytes } from 'expo-crypto';

import {
  deriveVaultKey,
  formatRecoveryCode,
  isValidRecoveryCode,
  newRecoveryCode,
  normalizeRecoveryCode,
  openBytes,
  sealBytes,
  vaultIdFromCode,
  type RandomBytes,
} from '@/core/vaultCode';
import {
  parseVaultManifest,
  type VaultManifest,
} from '@/core/vaultManifest';
import { planVaultRestore } from '@/core/vaultRestore';
import {
  mergeSnapshotNotes,
  parseVaultSnapshot,
  recordingFromSnapshotNote,
  snapshotFromRecordings,
  type VaultSnapshot,
  type VaultSnapshotNote,
} from '@/core/vaultSnapshot';
import type { Recording } from '@/core/types';
import type { Notebook } from '@/core/notebooks';

import {
  clockNow,
  getAppFlag,
  getRecording,
  listRecordings,
  setAppFlag,
  upsertRecording,
} from './db';
import { DriveClient, DriveError } from './driveClient';
import { getDriveAccessToken } from './driveAuth';
import { cachedAttachmentUri, saveCachedAttachment } from './attachments';
import { sessionDirUri, sessionDirectory } from './files';
import { listNotebooks, restoreLocalNotebook } from './notebooks';

export const VAULT_FOLDER = 'Dyarium';
export const KEY_FILE = 'key.txt';
export const BACKUP_FILE = 'backup.enc';
export const MANIFEST_FILE = 'manifest.json';
export const SUMMARY_FLAG = 'drive.summary';
export const VAULT_ID_FLAG = 'drive.vaultId';

const MAX_KEY_BYTES = 4096;
const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const randomBytes: RandomBytes = (length) => getRandomBytes(length);

export type VaultStage = 'reading' | 'decrypting' | 'applying' | 'attachments' | 'sending';

export interface VaultProgress {
  stage: VaultStage;
  done: number;
  total: number;
}

export interface VaultOptions {
  onStage?: (stage: VaultStage) => void;
  onProgress?: (progress: VaultProgress) => void;
}

export interface VaultSummary {
  notes: number;
  attachments: number;
  bytes: number;
  at: string;
}

export interface VaultRestoreCounts {
  notes: number;
  skipped: number;
  notebooks: number;
  attachments: number;
  failedAttachments: number;
}

export interface VaultOpenResult {
  summary: VaultSummary;
  restored: VaultRestoreCounts;
  pushed: { notes: number; bytes: number } | null;
  created: boolean;
}

export type VaultErrorKind = 'auth' | 'config' | 'mismatch' | 'corrupt' | 'limit' | 'network' | 'http';

export class VaultSyncError extends Error {
  readonly kind: VaultErrorKind;

  constructor(kind: VaultErrorKind, message: string) {
    super(message);
    this.name = 'VaultSyncError';
    this.kind = kind;
  }
}

function notifyStage(options: VaultOptions, stage: VaultStage): void {
  try {
    options.onStage?.(stage);
  } catch {
    // a tela e so aviso; um callback quebrado nao derruba o sync
  }
}

function notifyProgress(options: VaultOptions, progress: VaultProgress): void {
  try {
    options.onProgress?.(progress);
  } catch {
    // idem
  }
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  'audio/aac': 'aac',
  'audio/adts': 'aac',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'audio/x-wav': 'wav',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function extensionFor(contentType: string | undefined): string {
  const base = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSION_BY_TYPE[base] ?? 'bin';
}

function writeBytes(directory: Directory, name: string, bytes: Uint8Array): boolean {
  const file = new File(directory, name);
  if (file.exists) return false;
  file.create({ intermediates: true, overwrite: true });
  const handle = file.open(FileMode.Append);
  try {
    handle.writeBytes(bytes);
  } finally {
    handle.close();
  }
  return true;
}

function asVaultError(error: unknown): VaultSyncError {
  if (error instanceof VaultSyncError) return error;
  if (error instanceof DriveError) {
    if (error.kind === 'auth') return new VaultSyncError('auth', 'sessao do Google vencida');
    if (error.kind === 'config') return new VaultSyncError('config', 'Google nao configurado');
    if (error.kind === 'limit') return new VaultSyncError('limit', 'arquivo grande demais');
    if (error.kind === 'network') return new VaultSyncError('network', 'sem conexao com o Drive');
    return new VaultSyncError('http', 'o Drive recusou a operacao');
  }
  if (error instanceof Error && /codigo de recuperacao invalido/.test(error.message)) {
    return new VaultSyncError('corrupt', 'o cofre do Drive esta corrompido');
  }
  return new VaultSyncError('corrupt', 'nao foi possivel abrir o cofre do Drive');
}

interface VaultFiles {
  rootId: string;
  code: string;
  key: Uint8Array;
  vaultId: string;
  snapshot: VaultSnapshot;
  manifest: VaultManifest | null;
  created: boolean;
  keyWritten: boolean;
}

async function readKey(
  client: DriveClient,
  rootId: string,
): Promise<{ code: string; key: Uint8Array; created: boolean }> {
  const file = await client.findChild(rootId, KEY_FILE);
  if (!file) {
    const code = newRecoveryCode(randomBytes);
    return { code, key: deriveVaultKey(code), created: true };
  }
  const bytes = await client.download(file.id, MAX_KEY_BYTES);
  const code = normalizeRecoveryCode(decoder.decode(bytes).trim());
  if (!isValidRecoveryCode(code)) throw new VaultSyncError('corrupt', 'o cofre do Drive esta corrompido');
  return { code, key: deriveVaultKey(code), created: false };
}

async function readFiles(client: DriveClient, rootId: string, options: VaultOptions): Promise<VaultFiles> {
  const { code, key, created } = await readKey(client, rootId);
  const vaultId = vaultIdFromCode(code);
  const known = await getAppFlag(VAULT_ID_FLAG);
  if (known && known !== vaultId) {
    // O aparelho ja pertence a outro cofre. Misturar os dois mandaria notas
    // deste diario para o Drive de outra conta.
    throw new VaultSyncError('mismatch', 'este Drive tem outro cofre');
  }
  if (created && known) {
    throw new VaultSyncError('mismatch', 'o cofre deste aparelho nao esta neste Drive');
  }

  notifyStage(options, 'decrypting');
  notifyProgress(options, { stage: 'decrypting', done: 0, total: 1 });

  let snapshot: VaultSnapshot = {
    version: 1,
    vaultId,
    createdAt: new Date().toISOString(),
    notes: [],
  };
  const backup = await client.findChild(rootId, BACKUP_FILE);
  if (backup) {
    const sealed = await client.download(backup.id, MAX_BACKUP_BYTES);
    const opened = openBytes(sealed, key);
    snapshot = parseVaultSnapshot(decoder.decode(opened));
    if (snapshot.vaultId && snapshot.vaultId !== vaultId) {
      throw new VaultSyncError('corrupt', 'o retrato do Drive e de outro cofre');
    }
  }

  let manifest: VaultManifest | null = null;
  const manifestFile = await client.findChild(rootId, MANIFEST_FILE);
  if (manifestFile) {
    try {
      manifest = parseVaultManifest(decoder.decode(await client.download(manifestFile.id, MAX_MANIFEST_BYTES)));
    } catch {
      // Sem manifest ainda da para restaurar as notas do retrato; os anexos
      // ficam para a proxima sincronizacao.
      manifest = null;
    }
  }

  notifyProgress(options, { stage: 'decrypting', done: 1, total: 1 });
  return { rootId, code, key, vaultId, snapshot, manifest, created, keyWritten: !created };
}

async function applyPlan(
  plan: ReturnType<typeof planVaultRestore>,
  localNotes: Map<string, Recording>,
  options: VaultOptions,
): Promise<VaultRestoreCounts> {
  let notebooks = 0;
  for (const item of plan.notebooks) {
    try {
      await restoreLocalNotebook({
        id: item.id,
        name: item.name,
        color: '',
        isDefault: false,
        kind: item.kind,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies Notebook);
      notebooks += 1;
    } catch {
      // Caderno que falhou nao impede as notas; a nota cai no padrao.
    }
  }

  notifyStage(options, 'applying');
  notifyProgress(options, { stage: 'applying', done: 0, total: plan.notes.length });
  let applied = 0;
  for (const [index, note] of plan.notes.entries()) {
    const existing = localNotes.get(note.id) ?? null;
    await upsertRecording(recordingFromSnapshotNote(note, existing, await clockNow()));
    applied += 1;
    notifyProgress(options, { stage: 'applying', done: index + 1, total: plan.notes.length });
  }
  return {
    notes: applied,
    skipped: plan.skippedNotes,
    notebooks,
    attachments: 0,
    failedAttachments: 0,
  };
}

async function restoreAttachments(
  client: DriveClient,
  rootId: string,
  plan: ReturnType<typeof planVaultRestore>,
  options: VaultOptions,
): Promise<{ restored: number; failed: number }> {
  if (plan.attachments.length === 0) return { restored: 0, failed: 0 };
  notifyStage(options, 'attachments');
  notifyProgress(options, { stage: 'attachments', done: 0, total: plan.attachments.length });

  // O `id` do manifest e o id do anexo no produto, nao o id do arquivo no
  // Drive. O que liga os dois e o nome do arquivo dentro de `attachments/`.
  const folderId = await client.ensureFolder('attachments', rootId);
  const listed = await client.list(folderId);
  const driveIds = new Map(listed.map((file) => [file.name, file.id]));

  let restored = 0;
  let failed = 0;

  for (const [index, entry] of plan.attachments.entries()) {
    const owner = entry.entry_id;
    const kind = entry.content_type?.startsWith('audio/') ? 'audio' : 'image';
    try {
      if (!owner) throw new Error('anexo sem dono');
      if (kind === 'image' && cachedAttachmentUri(entry.id)) {
        notifyProgress(options, {
          stage: 'attachments',
          done: index + 1,
          total: plan.attachments.length,
        });
        continue;
      }
      const name = entry.path.split('/').pop() ?? '';
      const driveId = driveIds.get(name);
      if (!driveId) throw new Error('anexo ausente no Drive');
      if (kind === 'audio') {
        const localName = `drive-${entry.id}.${extensionFor(entry.content_type)}`;
        const directory = sessionDirectory(owner);
        if (new File(directory, localName).exists) {
          notifyProgress(options, {
            stage: 'attachments',
            done: index + 1,
            total: plan.attachments.length,
          });
          continue;
        }
        const bytes = await client.download(driveId, MAX_ATTACHMENT_BYTES);
        writeBytes(directory, localName, bytes);
        const note = await getRecording(owner);
        if (note) {
          await upsertRecording({
            ...note,
            dir: sessionDirUri(owner),
            filePath: new File(directory, localName).uri,
            fileName: localName,
            contentType: entry.content_type,
            sizeBytes: bytes.length,
            status: 'completed',
            source: note.source ?? 'share',
          });
        }
      } else {
        const bytes = await client.download(driveId, MAX_ATTACHMENT_BYTES);
        await saveCachedAttachment(entry.id, bytes, entry.content_type ?? '');
      }
      restored += 1;
    } catch (error) {
      if (error instanceof DriveError && error.kind === 'auth') throw error;
      failed += 1;
    }
    notifyProgress(options, {
      stage: 'attachments',
      done: index + 1,
      total: plan.attachments.length,
    });
  }
  return { restored, failed };
}

function summarize(
  manifest: VaultManifest | null,
  notes: number,
  backupBytes: number,
): VaultSummary {
  if (!manifest) {
    return { notes, attachments: 0, bytes: backupBytes, at: new Date().toISOString() };
  }
  let layoutNotes = 0;
  let attachments = 0;
  let bytes = 0;
  for (const file of manifest.files) {
    if (file.kind === 'note' || file.kind === 'chapter') layoutNotes += 1;
    if (file.kind === 'attachment') attachments += 1;
    bytes += file.size;
  }
  return {
    // O retrato e a verdade do que esta no Drive; o layout pode estar um passo
    // atras (o app acabou de subir notas que o web ainda nao reorganizou).
    notes: Math.max(notes, layoutNotes),
    attachments,
    bytes: Math.max(bytes, backupBytes),
    at: new Date().toISOString(),
  };
}

async function pushSnapshot(
  client: DriveClient,
  files: VaultFiles,
  options: VaultOptions,
): Promise<{ pushed: { notes: number; bytes: number } | null; merged: VaultSnapshotNote[]; backupBytes: number }> {
  notifyStage(options, 'sending');
  notifyProgress(options, { stage: 'sending', done: 0, total: 1 });

  const local = snapshotFromRecordings(await listRecordings(false));
  const merged = mergeSnapshotNotes(local, files.snapshot.notes);
  const remoteSorted = [...files.snapshot.notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const unchanged = JSON.stringify(merged) === JSON.stringify(remoteSorted);

  if (!files.keyWritten) {
    await client.put(
      files.rootId,
      KEY_FILE,
      encoder.encode(formatRecoveryCode(files.code)),
      'text/plain',
    );
    files.keyWritten = true;
  }

  let backupBytes = 0;
  let pushed: { notes: number; bytes: number } | null = null;
  if (!unchanged) {
    const snapshot: VaultSnapshot = {
      version: 1,
      vaultId: files.vaultId,
      createdAt: new Date().toISOString(),
      notes: merged,
    };
    const sealed = sealBytes(encoder.encode(JSON.stringify(snapshot)), files.key, randomBytes);
    await client.put(files.rootId, BACKUP_FILE, sealed);
    backupBytes = sealed.length;
    pushed = { notes: merged.length, bytes: sealed.length };
  } else {
    const backup = await client.findChild(files.rootId, BACKUP_FILE);
    const size = backup?.size ? Number(backup.size) : 0;
    backupBytes = Number.isFinite(size) ? size : 0;
  }

  notifyProgress(options, { stage: 'sending', done: 1, total: 1 });
  return { pushed, merged, backupBytes };
}

/**
 * Abre o cofre: le, aplica e sobe a uniao. Tambem cria o cofre quando o Drive
 * ainda nao tem `key.txt` (primeiro login de todos).
 */
export async function openDriveVault(options: VaultOptions = {}): Promise<VaultOpenResult> {
  try {
    const client = new DriveClient((force) => getDriveAccessToken(force));
    notifyStage(options, 'reading');
    notifyProgress(options, { stage: 'reading', done: 0, total: 0 });
    const rootId = await client.ensureFolder(VAULT_FOLDER);
    const files = await readFiles(client, rootId, options);
    const backup = await client.findChild(rootId, BACKUP_FILE);

    const allNotes = await listRecordings(true);
    const localNotes = new Map(allNotes.map((note) => [note.id, note]));
    const knownNotebooks = new Set((await listNotebooks()).map((notebook) => notebook.id));
    const plan = planVaultRestore({
      snapshot: files.snapshot,
      manifest: files.manifest,
      localNotes,
      knownNotebooks,
      // A checagem do cache e feita no download, onde o id ja e candidato e o
      // custo de olhar o disco e pequeno.
      existingAttachmentIds: new Set(),
    });

    const counts = await applyPlan(plan, localNotes, options);
    const attachments = await restoreAttachments(client, files.rootId, plan, options);
    counts.attachments = attachments.restored;
    counts.failedAttachments = attachments.failed;

    const { pushed, merged, backupBytes } = await pushSnapshot(client, files, options);
    const summary = summarize(files.manifest, merged.length, backupBytes || Number(backup?.size ?? 0));
    await setAppFlag(VAULT_ID_FLAG, files.vaultId);
    await setAppFlag(SUMMARY_FLAG, JSON.stringify(summary));

    return { summary, restored: counts, pushed, created: files.created };
  } catch (error) {
    throw asVaultError(error);
  }
}

/** Ultimo resumo conhecido; nao toca na rede. */
export async function readVaultSummary(): Promise<VaultSummary | null> {
  try {
    const raw = await getAppFlag(SUMMARY_FLAG);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultSummary;
    if (
      typeof parsed?.notes !== 'number' ||
      typeof parsed?.attachments !== 'number' ||
      typeof parsed?.bytes !== 'number' ||
      typeof parsed?.at !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
