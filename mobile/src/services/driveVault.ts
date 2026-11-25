/**
 * O cofre do Drive visto pelo app.
 *
 * Le o formato que o web ja grava (`key.txt`, `backup.enc` v1, `state.enc` v2,
 * `manifest.json` e os `.enc` por arquivo), aplica as notas e os cadernos no
 * banco do aparelho e sobe de volta o retrato unido. Nao reescreve o layout do
 * web: o app nao e dono do `manifest.json` nem dos arquivos por nota, e sim um
 * segundo leitor e escritor do retrato.
 *
 * Regras duras:
 * - nada e apagado por ausencia;
 * - abrir o cofre nao baixa anexo: o login so aplica os metadados e a midia de
 *   uma nota chega sob demanda (`ensureAttachmentFromDrive`), quando o usuario
 *   toca no audio ou abre a imagem;
 * - a uniao e por id (nota e caderno): o `updated_at` mais novo vence, ids
 *   diferentes coexistem;
 * - o v1 (`backup.enc`) continua existindo para o app antigo; o v2
 *   (`state.enc`) leva notas completas, cadernos e preserva analises/ajustes
 *   que o app nao interpreta;
 * - a chave do Drive precisa pertencer ao mesmo cofre ja usado neste aparelho;
 * - o retrato so e gravado quando existe diferenca;
 * - nenhum token, codigo ou caminho de conta aparece em erro ou log.
 */

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
  attachmentKind,
  parseVaultManifest,
  restoreAttachments as listVaultAttachments,
  type VaultFileEntry,
  type VaultManifest,
} from '@/core/vaultManifest';
import { planVaultRestore } from '@/core/vaultRestore';
import {
  MAX_STATE_BYTES,
  mergeStateNotebooks,
  mergeStateNotes,
  notebookFromState,
  notebooksToState,
  notesSnapshotNoteFromState,
  parseVaultState,
  parseVaultSnapshot,
  recordingFromSnapshotNote,
  stateNotesFromRecordings,
  type VaultSnapshot,
  type VaultSnapshotNote,
  type VaultState,
  type VaultStateNotebook,
  type VaultStateNote,
} from '@/core/vaultSnapshot';
import type { Recording } from '@/core/types';
import { DEFAULT_NOTEBOOK_ID, type Notebook } from '@/core/notebooks';

import {
  clockNow,
  getAppFlag,
  listRecordings,
  setAppFlag,
  upsertRecording,
} from './db';
import { DriveClient, DriveError } from './driveClient';
import { getDriveAccessToken } from './driveAuth';
import { cachedAttachmentUri, saveCachedAttachment } from './attachments';
import { listNotebooks, mergeNotebookFromDrive, restoreLocalNotebook } from './notebooks';

export const VAULT_FOLDER = 'Dyarium';
export const KEY_FILE = 'key.txt';
export const BACKUP_FILE = 'backup.enc';
export const STATE_FILE = 'state.enc';
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

export type VaultStage = 'reading' | 'decrypting' | 'applying' | 'sending';

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
  /** Anexos baixados no proprio open; hoje sempre 0 (midia vem sob demanda). */
  attachments: number;
  /** Anexos que falharam no open; hoje sempre 0 (a nota avisa por anexo). */
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
  if (error instanceof Error && /Drive nao conectado/.test(error.message)) {
    return new VaultSyncError('auth', 'sessao do Google vencida');
  }
  return new VaultSyncError('corrupt', 'nao foi possivel abrir o cofre do Drive');
}

interface VaultFiles {
  rootId: string;
  code: string;
  key: Uint8Array;
  vaultId: string;
  /** Uniao das notas do v2 com as do v1, para aplicar e regravar. */
  notes: VaultStateNote[];
  /** Notas exatamente como estavam no `backup.enc` (v1), para comparar. */
  legacyNotes: VaultSnapshotNote[];
  notebooks: VaultStateNotebook[];
  analyses: VaultState['analyses'];
  settings: VaultState['settings'];
  manifest: VaultManifest | null;
  created: boolean;
  keyWritten: boolean;
  backupWritten: boolean;
  stateWritten: boolean;
  legacyBytes: number;
  stateBytes: number;
}

function sortNotes<T extends { id: string }>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortNotebooks(notebooks: readonly VaultStateNotebook[]): VaultStateNotebook[] {
  return [...notebooks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

  // O v1 e o arquivo que o app antigo entende. Le primeiro para o caso de o
  // `state.enc` ainda nao existir (cofre criado por uma versao anterior).
  let legacyNotes: VaultSnapshotNote[] = [];
  let legacyBytes = 0;
  const backup = await client.findChild(rootId, BACKUP_FILE);
  if (backup) {
    const sealed = await client.download(backup.id, MAX_BACKUP_BYTES);
    legacyBytes = sealed.length;
    const opened = openBytes(sealed, key);
    const snapshot = parseVaultSnapshot(decoder.decode(opened));
    if (snapshot.vaultId && snapshot.vaultId !== vaultId) {
      throw new VaultSyncError('corrupt', 'o retrato do Drive e de outro cofre');
    }
    legacyNotes = snapshot.notes;
  }

  // O `state.enc` e o retrato completo do web (notas com transcricao, cadernos,
  // analises e ajustes). Ele manda quando existe; o v1 entra junto na uniao para
  // nao perder o que o app antigo escreveu depois da ultima vez.
  let state: VaultState | null = null;
  let stateBytes = 0;
  const stateFile = await client.findChild(rootId, STATE_FILE);
  if (stateFile) {
    const sealed = await client.download(stateFile.id, MAX_STATE_BYTES);
    stateBytes = sealed.length;
    state = parseVaultState(decoder.decode(openBytes(sealed, key)));
    if (state.vaultId && state.vaultId !== vaultId) {
      throw new VaultSyncError('corrupt', 'o retrato do Drive e de outro cofre');
    }
  }

  const notes = mergeStateNotes(state?.notes ?? [], legacyNotes);
  const notebooks = state?.notebooks ?? [];

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
  return {
    rootId,
    code,
    key,
    vaultId,
    notes,
    legacyNotes,
    notebooks,
    analyses: state?.analyses,
    settings: state?.settings,
    manifest,
    created,
    keyWritten: !created,
    backupWritten: backup !== undefined,
    stateWritten: stateFile !== undefined,
    legacyBytes,
    stateBytes,
  };
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

/**
 * Midia do cofre disponivel para uma nota. A midia nunca entra no caminho do
 * login: `ensureAttachmentFromDrive` le a chave e o manifest e baixa somente o
 * anexo pedido, quando o usuario toca no audio ou abre a imagem.
 */
interface VaultMedia {
  vaultId: string;
  key: Uint8Array;
  manifest: VaultManifest;
  /** Nome do arquivo em `attachments/` -> id no Drive. */
  driveIds: Map<string, string>;
}

/**
 * O manifest e claro e pequeno; guardar por alguns segundos evita baixa-lo de
 * novo quando a nota abre varias imagens de uma vez. Curto de proposito: um
 * anexo enviado agora pelo outro cliente precisa aparecer na proxima abertura.
 */
const MEDIA_TTL_MS = 15_000;

let mediaCache: { at: number; value: VaultMedia } | null = null;
let mediaPending: Promise<VaultMedia | null> | null = null;

/** Esquece a chave e o manifest guardados (sair da conta, trocar de cofre). */
export function resetVaultMediaCache(): void {
  mediaCache = null;
  mediaPending = null;
}

async function loadVaultMedia(client: DriveClient): Promise<VaultMedia | null> {
  const root = await client.findChild('root', VAULT_FOLDER);
  if (!root) return null;

  const keyFile = await client.findChild(root.id, KEY_FILE);
  // Sem `key.txt` nao ha cofre para ler: a criacao e papel do login.
  if (!keyFile) return null;
  const code = normalizeRecoveryCode(decoder.decode(await client.download(keyFile.id, MAX_KEY_BYTES)).trim());
  if (!isValidRecoveryCode(code)) throw new VaultSyncError('corrupt', 'o cofre do Drive esta corrompido');
  const key = deriveVaultKey(code);
  const vaultId = vaultIdFromCode(code);
  const known = await getAppFlag(VAULT_ID_FLAG);
  if (known && known !== vaultId) {
    throw new VaultSyncError('mismatch', 'este Drive tem outro cofre');
  }

  const manifestFile = await client.findChild(root.id, MANIFEST_FILE);
  if (!manifestFile) return null;
  let manifest: VaultManifest;
  try {
    manifest = parseVaultManifest(decoder.decode(await client.download(manifestFile.id, MAX_MANIFEST_BYTES)));
  } catch {
    // Manifest ilegivel nao vira erro de player: a nota avisa que o audio nao
    // carregou e tenta de novo na proxima abertura.
    return null;
  }

  // O `id` do manifest e o id do anexo no produto, nao o id do arquivo no
  // Drive. O que liga os dois e o nome do arquivo dentro de `attachments/`.
  const folder = await client.findChild(root.id, 'attachments');
  const listed = folder ? await client.list(folder.id) : [];
  const driveIds = new Map(listed.map((file) => [file.name, file.id]));

  return { vaultId, key, manifest, driveIds };
}

/** Uma leitura de chave/manifest por vez; os anexos de uma nota dividem a mesma. */
async function mediaFor(client: DriveClient): Promise<VaultMedia | null> {
  if (mediaCache && Date.now() - mediaCache.at < MEDIA_TTL_MS) return mediaCache.value;
  if (!mediaPending) {
    const pending = loadVaultMedia(client).then((value) => {
      if (value) mediaCache = { at: Date.now(), value };
      return value;
    });
    mediaPending = pending;
    pending
      .catch(() => undefined)
      .finally(() => {
        if (mediaPending === pending) mediaPending = null;
      });
  }
  return mediaPending;
}

/**
 * Baixa o anexo do cofre, decifra e grava no cache local com o id do produto.
 * O `<id>.<ext>` e exatamente o que `attachmentUri` procura, entao o player e o
 * editor encontram o arquivo sem saber que ele veio do Drive.
 */
async function storeVaultAttachment(
  client: DriveClient,
  media: VaultMedia,
  entry: VaultFileEntry,
): Promise<string> {
  const cached = cachedAttachmentUri(entry.id);
  if (cached) return cached;
  if (!attachmentKind(entry.content_type)) throw new Error('anexo sem tipo conhecido');

  const name = entry.path.split('/').pop() ?? '';
  const driveId = media.driveIds.get(name);
  if (!driveId) throw new Error('anexo ausente no Drive');

  const sealed = await client.download(driveId, MAX_ATTACHMENT_BYTES);
  const plain = openBytes(sealed, media.key);
  // O aparelho pode ter trocado de cofre entre o toque e o fim do download.
  // Sem esta conferencia, um anexo do cofre antigo cairia no cache do novo.
  const known = await getAppFlag(VAULT_ID_FLAG);
  if (known && known !== media.vaultId) {
    throw new VaultSyncError('mismatch', 'este Drive tem outro cofre');
  }
  await saveCachedAttachment(entry.id, plain, entry.content_type ?? '');
  const uri = cachedAttachmentUri(entry.id);
  if (!uri) throw new Error('anexo nao gravado no aparelho');
  return uri;
}

export interface DriveAttachmentResult {
  /** Anexos que ficaram disponiveis no aparelho agora. */
  downloaded: number;
  /** Anexos do cofre que nao puderam ser baixados (a nota mostra o aviso). */
  failed: number;
  /** URI local do anexo pedido, quando `attachmentId` foi informado. */
  uri: string | null;
}

/** Um pedido identico em andamento e compartilhado; a falha nao fica guardada. */
const attachmentLoads = new Map<string, Promise<DriveAttachmentResult>>();

/**
 * Traz do cofre o anexo de uma nota, so quando ele e preciso.
 *
 * Com `attachmentId`, baixa somente aquele anexo (o audio que o usuario tocou).
 * Sem, baixa os anexos daquela nota (as imagens do corpo). Nada aqui toca no
 * banco de notas nem na fila do cofre: abrir o app e o login nao esperam por
 * isto, e uma falha de um anexo nao derruba os outros.
 */
export function ensureAttachmentFromDrive(
  entryId: string,
  attachmentId?: string,
): Promise<DriveAttachmentResult> {
  const cached = attachmentId ? cachedAttachmentUri(attachmentId) : null;
  if (cached) return Promise.resolve({ downloaded: 0, failed: 0, uri: cached });
  const key = `${entryId}\n${attachmentId ?? ''}`;
  const running = attachmentLoads.get(key);
  if (running) return running;
  const task = loadVaultAttachments(entryId, attachmentId);
  attachmentLoads.set(key, task);
  void task
    .catch(() => undefined)
    .finally(() => {
      if (attachmentLoads.get(key) === task) attachmentLoads.delete(key);
    });
  return task;
}

async function loadVaultAttachments(
  entryId: string,
  attachmentId?: string,
): Promise<DriveAttachmentResult> {
  try {
    const client = new DriveClient((force) => getDriveAccessToken(force));
    const media = await mediaFor(client);
    if (!media) return { downloaded: 0, failed: 0, uri: null };

    const entries = listVaultAttachments(media.manifest).filter(
      (entry) =>
        entry.entry_id === entryId && (attachmentId === undefined || entry.id === attachmentId),
    );

    let downloaded = 0;
    let failed = 0;
    let uri: string | null = null;
    for (const entry of entries) {
      try {
        const saved = await storeVaultAttachment(client, media, entry);
        downloaded += 1;
        if (entry.id === attachmentId) uri = saved;
      } catch (error) {
        // Sessao vencida e do app inteiro; arquivo ausente ou corrompido e so
        // daquele anexo.
        if (error instanceof VaultSyncError || (error instanceof DriveError && error.kind === 'auth')) {
          throw error;
        }
        failed += 1;
      }
    }
    return { downloaded, failed, uri };
  } catch (error) {
    throw asVaultError(error);
  }
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

/** Contagem por caderno para o retrato, igual ao que o web deriva do banco. */
function notebookCounts(
  notes: readonly VaultStateNote[],
): Map<string, { notes: number; chapters: number }> {
  const counts = new Map<string, { notes: number; chapters: number }>();
  for (const note of notes) {
    const id = note.notebookId ?? DEFAULT_NOTEBOOK_ID;
    const current = counts.get(id) ?? { notes: 0, chapters: 0 };
    current.notes += 1;
    if (note.chapterKind) current.chapters += 1;
    counts.set(id, current);
  }
  return counts;
}

interface PushResult {
  pushed: { notes: number; bytes: number } | null;
  mergedNotes: VaultStateNote[];
  mergedNotebooks: VaultStateNotebook[];
  legacyBytes: number;
  stateBytes: number;
}

/**
 * Sobe o retrato unido: o v1 (so notas, para o app antigo) e o v2 completo no
 * `state.enc`. Analises e ajustes que ja estavam no Drive voltam intactos: o
 * app nao os interpreta, mas tambem nao os apaga.
 */
async function pushVault(
  client: DriveClient,
  files: VaultFiles,
  options: VaultOptions,
): Promise<PushResult> {
  notifyStage(options, 'sending');
  notifyProgress(options, { stage: 'sending', done: 0, total: 1 });

  const localNotes = stateNotesFromRecordings(await listRecordings(false));
  const mergedNotes = mergeStateNotes(localNotes, files.notes);
  const localNotebooks = notebooksToState(
    await listNotebooks(),
    notebookCounts(localNotes),
  );
  const mergedNotebooks = mergeStateNotebooks(localNotebooks, files.notebooks);

  const legacy = sortNotes(mergedNotes.map(notesSnapshotNoteFromState));
  const remoteLegacy = sortNotes(files.legacyNotes);
  const legacyChanged =
    !files.backupWritten || JSON.stringify(legacy) !== JSON.stringify(remoteLegacy);

  const remoteCanonical = JSON.stringify({
    notes: sortNotes(files.notes),
    notebooks: sortNotebooks(files.notebooks),
  });
  const localCanonical = JSON.stringify({
    notes: mergedNotes,
    notebooks: mergedNotebooks,
  });
  const stateChanged = !files.stateWritten || remoteCanonical !== localCanonical;

  if (!files.keyWritten) {
    await client.put(
      files.rootId,
      KEY_FILE,
      encoder.encode(formatRecoveryCode(files.code)),
      'text/plain',
    );
    files.keyWritten = true;
  }

  let legacyBytes = files.legacyBytes;
  let stateBytes = files.stateBytes;

  if (legacyChanged) {
    const snapshot: VaultSnapshot = {
      version: 1,
      vaultId: files.vaultId,
      createdAt: new Date().toISOString(),
      notes: legacy,
    };
    const plain = encoder.encode(JSON.stringify(snapshot));
    if (plain.length > MAX_BACKUP_BYTES) {
      throw new VaultSyncError('limit', 'o retrato de notas e grande demais');
    }
    const sealed = sealBytes(plain, files.key, randomBytes);
    await client.put(files.rootId, BACKUP_FILE, sealed);
    legacyBytes = sealed.length;
    files.backupWritten = true;
    files.legacyNotes = legacy;
  }

  if (stateChanged) {
    const state: VaultState = {
      version: 2,
      vaultId: files.vaultId,
      createdAt: new Date().toISOString(),
      notes: mergedNotes,
      notebooks: mergedNotebooks,
      ...(files.analyses !== undefined ? { analyses: files.analyses } : {}),
      ...(files.settings !== undefined ? { settings: files.settings } : {}),
    };
    const plain = encoder.encode(JSON.stringify(state));
    if (plain.length > MAX_STATE_BYTES) {
      throw new VaultSyncError('limit', 'o retrato completo e grande demais');
    }
    const sealed = sealBytes(plain, files.key, randomBytes);
    await client.put(files.rootId, STATE_FILE, sealed);
    stateBytes = sealed.length;
    files.stateWritten = true;
  }

  notifyProgress(options, { stage: 'sending', done: 1, total: 1 });
  return {
    pushed:
      legacyChanged || stateChanged
        ? { notes: mergedNotes.length, bytes: legacyBytes + stateBytes }
        : null,
    mergedNotes,
    mergedNotebooks,
    legacyBytes,
    stateBytes,
  };
}

/**
 * Aplica os cadernos do retrato antes das notas: a nota restaurada precisa de
 * um caderno que exista. O mais novo por `updated_at` vence; caderno local mais
 * novo (ou apagado depois) fica como esta.
 */
async function applyVaultNotebooks(
  remote: readonly VaultStateNotebook[],
  known: Set<string>,
): Promise<number> {
  if (remote.length === 0) return 0;
  const local = new Map((await listNotebooks()).map((notebook) => [notebook.id, notebook]));
  let applied = 0;
  for (const item of remote) {
    const existing = local.get(item.id);
    if (existing && Date.parse(existing.updatedAt) >= Date.parse(item.updated_at)) {
      known.add(existing.id);
      continue;
    }
    try {
      await mergeNotebookFromDrive(notebookFromState(item));
      known.add(item.id);
      applied += 1;
    } catch {
      // Caderno que falhou nao impede as notas; a nota cai no padrao.
    }
  }
  return applied;
}

/** Etapas do passo de sincronizacao; auto-sync sobe sem reaplicar o retrato. */
export interface VaultOpenOptions extends VaultOptions {
  /** Falso no envio automatico: le, une e grava, sem reaplicar no aparelho. */
  apply?: boolean;
  /**
   * Espera o envio do retrato antes de voltar. O login passa `false`: a tela
   * abre com as notas e o envio (com o resumo novo) segue no auto-sync.
   */
  push?: boolean;
}

/**
 * Fila unica das operacoes do cofre. Duas leituras seguidas de gravacao (auto e
 * manual) precisam ver o que a outra deixou; em paralelo, a uniao calculada por
 * uma poderia nao incluir a mudanca da outra.
 */
let vaultQueue: Promise<unknown> = Promise.resolve();

function withVaultLock<T>(task: () => Promise<T>): Promise<T> {
  const run = vaultQueue.then(task, task);
  vaultQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Aplica cadernos e notas do retrato. Anexo nenhum e baixado aqui: a midia de
 * uma nota vem sob demanda, quando o usuario toca no audio ou abre a imagem.
 */
async function applyVaultNotes(
  files: VaultFiles,
  options: VaultOptions,
): Promise<VaultRestoreCounts> {
  const allNotes = await listRecordings(true);
  const localNotes = new Map(allNotes.map((note) => [note.id, note]));
  const knownNotebooks = new Set((await listNotebooks()).map((notebook) => notebook.id));
  const notebooks = await applyVaultNotebooks(files.notebooks, knownNotebooks);

  const plan = planVaultRestore({
    // A uniao v2+v1 e a lista de notas vivas do cofre.
    snapshot: {
      version: 1,
      vaultId: files.vaultId,
      createdAt: new Date().toISOString(),
      notes: files.notes,
    },
    manifest: files.manifest,
    localNotes,
    knownNotebooks,
    // O cache local so e consultado quando o usuario pede um anexo.
    existingAttachmentIds: new Set(),
  });

  const counts = await applyPlan(plan, localNotes, options);
  counts.notebooks += notebooks;
  return counts;
}

/**
 * Abre o cofre: le, aplica e (por padrao) sobe a uniao. Tambem cria o cofre
 * quando o Drive ainda nao tem `key.txt` (primeiro login de todos).
 *
 * Uma fila unica serializa abertura, envio automatico e o "sair": dois clientes
 * do mesmo aparelho lendo e gravando o mesmo retrato ao mesmo tempo poderiam
 * gravar por cima da uniao que o outro acabou de calcular.
 *
 * O login usa `push: false`: a tela abre assim que as notas sao aplicadas e o
 * envio do retrato continua em segundo plano.
 */
export async function openDriveVault(options: VaultOpenOptions = {}): Promise<VaultOpenResult> {
  return withVaultLock(() => openDriveVaultLocked(options));
}

async function openDriveVaultLocked(options: VaultOpenOptions): Promise<VaultOpenResult> {
  try {
    const client = new DriveClient((force) => getDriveAccessToken(force));
    notifyStage(options, 'reading');
    notifyProgress(options, { stage: 'reading', done: 0, total: 0 });
    const rootId = await client.ensureFolder(VAULT_FOLDER);
    const files = await readFiles(client, rootId, options);

    let restored: VaultRestoreCounts = {
      notes: 0,
      skipped: 0,
      notebooks: 0,
      attachments: 0,
      failedAttachments: 0,
    };
    const apply = options.apply !== false;
    if (apply) {
      restored = await applyVaultNotes(files, options);
    }

    // O cofre lido pertence a outro id? A midia guardada nao serve mais.
    if (mediaCache && mediaCache.value.vaultId !== files.vaultId) resetVaultMediaCache();

    let pushed: VaultOpenResult['pushed'] = null;
    let notesInVault = files.notes.length;
    let bytes = files.legacyBytes + files.stateBytes;

    if (options.push === false) {
      // Caminho do login: nada de esperar o retrato inteiro subir. O envio de
      // fundo (auto-sync) grava o retrato e atualiza o resumo.
      if (files.created) {
        // A chave e a identidade do cofre e custa uma requisicao pequena; sem
        // ela, um login novo criaria outro cofre a cada abertura.
        await client.put(
          rootId,
          KEY_FILE,
          encoder.encode(formatRecoveryCode(files.code)),
          'text/plain',
        );
        files.keyWritten = true;
      }
      if (apply) {
        notesInVault = Math.max(notesInVault, (await listRecordings(false)).length);
      }
    } else {
      const result = await pushVault(client, files, options);
      pushed = result.pushed;
      notesInVault = result.mergedNotes.length;
      bytes = result.legacyBytes + result.stateBytes;
    }

    const summary = summarize(files.manifest, notesInVault, bytes);
    await setAppFlag(VAULT_ID_FLAG, files.vaultId);
    await setAppFlag(SUMMARY_FLAG, JSON.stringify(summary));

    return { summary, restored, pushed, created: files.created };
  } catch (error) {
    throw asVaultError(error);
  }
}

/**
 * Antes de sair da conta: sobe o retrato completo, le de volta e confere que
 * toda nota e caderno locais chegaram. Qualquer falha vira erro e nada e
 * apagado; a verificacao e o que permite apagar o cache com seguranca.
 */
export async function ensureVaultBackedUp(): Promise<{ notes: number; notebooks: number }> {
  return withVaultLock(() => ensureVaultBackedUpLocked());
}

async function ensureVaultBackedUpLocked(): Promise<{ notes: number; notebooks: number }> {
  try {
    const client = new DriveClient((force) => getDriveAccessToken(force));
    const rootId = await client.ensureFolder(VAULT_FOLDER);
    const files = await readFiles(client, rootId, {});
    const pushed = await pushVault(client, files, {});

    const check = await readFiles(client, rootId, {});
    const remoteNotes = new Map(check.notes.map((note) => [note.id, note]));
    for (const note of stateNotesFromRecordings(await listRecordings(false))) {
      const remote = remoteNotes.get(note.id);
      if (!remote || Date.parse(remote.updatedAt) < Date.parse(note.updatedAt)) {
        throw new VaultSyncError('http', 'o Drive nao confirmou o retrato');
      }
    }
    const remoteNotebooks = new Map(check.notebooks.map((notebook) => [notebook.id, notebook]));
    for (const notebook of notebooksToState(await listNotebooks())) {
      const remote = remoteNotebooks.get(notebook.id);
      if (!remote || Date.parse(remote.updated_at) < Date.parse(notebook.updated_at)) {
        throw new VaultSyncError('http', 'o Drive nao confirmou os cadernos');
      }
    }
    return { notes: pushed.mergedNotes.length, notebooks: pushed.mergedNotebooks.length };
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
