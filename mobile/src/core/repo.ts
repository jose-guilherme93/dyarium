/**
 * Repositorio do cofre: todo o SQL do produto, sem driver.
 *
 * Nucleo puro: nenhuma importacao de expo, React Native, arquivo ou servico. O
 * banco e a identidade entram pela porta `./port`, que o app liga ao
 * expo-sqlite e o navegador liga ao wa-sqlite. E por aqui que os dois clientes
 * leem e escrevem as mesmas tabelas com as mesmas regras.
 */

import type { ServerAnalysis, ServerAudio } from '@/core/api';
import type { BackupKnowledge } from '@/core/backup';
import type { ChunkExtraction } from '@/core/analysisChunk';
import type { AnalysisOutcome, AnalysisRun, AnalysisRuntime } from '@/core/analysisRuns';
import { deriveEntityLinks, ownerKey } from '@/core/graphEntities';
import { entityNameKey, type EntityRejection } from '@/core/entities';
import { formatHlc, nextHlc, nodeFrom, observeHlc, parseHlc, type Hlc } from '@/core/hlc';
import type { GraphLayout } from '@/core/graphLayout';
import { isEntityKind, type EntityKind, type EntityLink, type GraphEntity } from '@/core/graphModel';
import { newId } from '@/core/id';
import { DEFAULT_NOTEBOOK_ID } from '@/core/notebooks';
import type {
  ConflictField,
  Recording,
  RecordingSource,
  RecordingStatus,
  TranscriptOrigin,
  TranscriptReview,
  TranscriptSegment,
  TranscriptStatus,
} from '@/core/types';

import {
  cancelActivity,
  currentDeviceIdentity,
  getDb,
  getDbForUI,
  type Database,
} from './port';

interface Row {
  id: string;
  title: string;
  recorded_at: string;
  dir: string;
  file_path: string | null;
  segment_count: number;
  duration_ms: number | null;
  size_bytes: number | null;
  status: string;
  upload_id: string | null;
  offset: number;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  terminal: string | null;
  entry_id: string | null;
  note_id: string | null;
  server_attachment_id: string | null;
  transcript: string | null;
  transcript_language: string | null;
  transcript_status: string | null;
  transcript_segments: string | null;
  transcript_review: string | null;
  transcript_checkpoint_ms: string | null;
  has_transcript: string | null;
  transcript_origin: string | null;
  source: string | null;
  text: string | null;
  content_type: string | null;
  file_name: string | null;
  duplicate: number | null;
  archived: number | null;
  author: string | null;
  author_dirty: string | null;
  deleted_at: string | null;
  notebook_id: string | null;
  tags: string | null;
  notebook_dirty: string | null;
  tags_dirty: string | null;
  archived_dirty: string | null;
  note_dirty: string | null;
  attachments: string | null;
  title_version: string | null;
  recorded_at_version: string | null;
  body_version: string | null;
  sync_conflict: string | null;
  server_audios: string | null;
  capture_source_id: string | null;
  capture_start_ms: number | null;
  created_at: string;
  updated_at: string;
  updated_hlc: string | null;
  summary_detail: string | null;
  summary_detail_dirty: number | null;
  icon: string | null;
  chapter_kind: string | null;
  chapter_position: number | null;
  chapter_status: string | null;
  chapter_goal_words: number | null;
  chapter_synopsis: string | null;
  chapter_beats: string | null;
  chapter_notes: string | null;
}

/**
 * Fila unica das escritas do mapa.
 *
 * `withTransactionAsync` usa a mesma conexao do banco: duas transacoes
 * simultaneas (uma analise salvando enquanto a outbox aplica o catalogo)
 * falhariam com "transaction within a transaction". A fila mantem a ordem e
 * deixa o resto das gravacoes correr normal.
 */
let graphWriteQueue: Promise<unknown> = Promise.resolve();

function withGraphWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = graphWriteQueue.then(task, task);
  graphWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Marca local que nao pertence a nenhuma nota (ex.: aviso ja ocultado).
 * Fora do backup de proposito: reinstalar o app reabre a conversa.
 */
export async function getAppFlag(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_flags WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setAppFlag(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO app_flags (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/**
 * Relogio de versao do aparelho: o relogio hibrido logico que carimba as
 * edicoes locais e aprende com as versoes que chegam do servidor.
 *
 * Vive aqui, ao lado de `app_flags`, porque o carimbo e preciso dentro do
 * `upsertRecording`. Importar `services/clock` daqui criava um ciclo
 * `db -> clock -> db`, que o Metro avisa poder entregar valores nao
 * inicializados. O estado fica no SQLite, nao so na memoria: um reinicio no
 * meio de uma edicao nao pode reemitir a mesma versao.
 */
const HLC_STATE_KEY = 'hlc.clock';
const HLC_PERSIST_EVERY_MS = 1000;

let clockState: Hlc | null = null;
let clockLoaded = false;
let clockPersistedPhysical = 0;
let clockPersistInFlight = false;
let clockNodeCache = '';

async function loadClock(): Promise<Hlc | null> {
  if (clockLoaded) return clockState;
  clockLoaded = true;
  try {
    clockState = parseHlc(await getAppFlag(HLC_STATE_KEY));
  } catch {
    clockState = null;
  }
  return clockState;
}

/** Grava o estado no banco, no maximo uma vez por segundo. */
function persistClock(): void {
  if (!clockState || clockPersistInFlight) return;
  if (
    clockPersistedPhysical > 0 &&
    clockState.physical - clockPersistedPhysical < HLC_PERSIST_EVERY_MS
  ) {
    return;
  }
  clockPersistedPhysical = clockState.physical;
  clockPersistInFlight = true;
  const value = formatHlc(clockState);
  void setAppFlag(HLC_STATE_KEY, value)
    .catch(() => undefined)
    .finally(() => {
      clockPersistInFlight = false;
    });
}

async function node(): Promise<string> {
  if (!clockNodeCache) clockNodeCache = nodeFrom((await currentDeviceIdentity()).id);
  return clockNodeCache;
}

/** Proxima versao local: sempre depois da ultima emitida ou observada. */
export async function clockNow(): Promise<string> {
  const last = await loadClock();
  clockState = nextHlc(last, Date.now(), await node());
  persistClock();
  return formatHlc(clockState);
}

/**
 * Avanca o relogio com versoes recebidas (do servidor ou de outro ambiente).
 * Uma edicao feita depois desta leitura fica necessariamente mais nova, mesmo
 * que o relogio do aparelho esteja atrasado.
 */
export async function observeVersions(
  ...versions: (string | null | undefined)[]
): Promise<void> {
  let last = await loadClock();
  for (const version of versions) {
    const parsed = parseHlc(version);
    if (!parsed) continue;
    last = observeHlc(last, parsed);
  }
  if (last && last !== clockState) {
    clockState = last;
    persistClock();
  }
}

/** Nome do aparelho nas versoes e na origem dos tombstones. */
export async function clockNode(): Promise<string> {
  return node();
}

/**
 * Ultimo recorte do mapa, em JSON, para o mapa abrir sem ler as tabelas. O
 * desenho e o mesmo de antes; a leitura fresca roda por tras e so troca o
 * recorte quando algo mudou de verdade.
 */
export async function saveGraphSnapshotCache(key: string, json: string): Promise<void> {
  await setAppFlag(`graph_snapshot:${key}`, json);
}

export async function loadGraphSnapshotCache(key: string): Promise<string | null> {
  return getAppFlag(`graph_snapshot:${key}`);
}

/**
 * Adquire uma trava nomeada no banco, para nunca haver dois workers (primeiro
 * plano e background task) processando a fila ao mesmo tempo. Devolve um token
 * quando adquirida, ou null quando outra instancia detem a trava (e ela nao
 * expirou). A trava expira sozinha apos `ttlMs` (worker morto nao trava a fila).
 */
export async function acquireLock(name: string, ttlMs = 120_000): Promise<string | null> {
  const db = await getDb();
  const holder = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  let acquired = false;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const existing = await txn.getFirstAsync<{ acquired_at: number }>(
      'SELECT acquired_at FROM locks WHERE name = ?',
      [name],
    );
    if (existing && now - existing.acquired_at < ttlMs) {
      return;
    }
    await txn.runAsync(
      `INSERT INTO locks (name, holder, acquired_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, acquired_at = excluded.acquired_at`,
      [name, holder, now],
    );
    acquired = true;
  });
  return acquired ? holder : null;
}

export async function releaseLock(name: string, holder: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM locks WHERE name = ? AND holder = ?', [name, holder]);
}

function parseSegments(raw: string | null): TranscriptSegment[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TranscriptSegment[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Estado da revisao por IA, em JSON; ausente quando nunca houve revisao. */
function parseReview(raw: string | null): TranscriptReview | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed as TranscriptReview;
  } catch {
    return undefined;
  }
}

/** Pilha de audios do servidor cacheada em JSON; vazia quando nunca foi lida. */
function parseServerAudios(raw: string | null): ServerAudio[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ServerAudio[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Tags da nota gravadas como JSON de nomes. */
function parseTags(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const tags = parsed.filter((value): value is string => typeof value === 'string' && value.trim() !== '');
    return tags.length > 0 ? tags : undefined;
  } catch {
    return undefined;
  }
}

function parseAttachments(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Campos em conflito gravados como JSON; lista vazia quando nao ha conflito. */
function parseConflict(raw: string | null): ConflictField[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const fields = parsed.filter(
      (value): value is ConflictField =>
        value === 'title' || value === 'recorded_at' || value === 'body',
    );
    return fields.length > 0 ? fields : undefined;
  } catch {
    return undefined;
  }
}

/** Cache de um JSON pesado: so parseia quando alguem pede o campo. */
function lazyParsed<T>(
  raw: string | null,
  parse: (raw: string | null) => T | undefined,
): () => T | undefined {
  let loaded = false;
  let value: T | undefined;
  return () => {
    if (!loaded) {
      value = parse(raw);
      loaded = true;
    }
    return value;
  };
}

function rowToRecording(row: Row): Recording {
  const recording: Recording = {
    id: row.id,
    title: row.title,
    recordedAt: row.recorded_at,
    dir: row.dir,
    filePath: row.file_path ?? undefined,
    segmentCount: row.segment_count,
    durationMs: row.duration_ms ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    status: row.status as RecordingStatus,
    uploadId: row.upload_id ?? undefined,
    offset: row.offset,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    lastError: row.last_error ?? undefined,
    terminal: row.terminal ? true : undefined,
    entryId: row.entry_id ?? undefined,
    noteId: row.note_id ?? undefined,
    serverAttachmentId: row.server_attachment_id ?? undefined,
    transcript: row.transcript ?? undefined,
    transcriptLanguage: row.transcript_language ?? undefined,
    transcriptStatus: (row.transcript_status as TranscriptStatus | null) ?? undefined,
    transcriptCheckpointMs:
      row.transcript_checkpoint_ms && Number.isFinite(Number(row.transcript_checkpoint_ms))
        ? Number(row.transcript_checkpoint_ms)
        : undefined,
    hasTranscript: row.has_transcript ? true : undefined,
    transcriptOrigin: (row.transcript_origin as TranscriptOrigin | null) ?? undefined,
    source: (row.source as RecordingSource | null) ?? undefined,
    text: row.text ?? undefined,
    contentType: row.content_type ?? undefined,
    fileName: row.file_name ?? undefined,
    duplicate: row.duplicate ? true : undefined,
    archived: row.archived ? true : undefined,
    author: (row.author as Recording['author']) ?? '',
    authorDirty: row.author_dirty ? true : undefined,
    summaryDetail: (row.summary_detail === 'full' ? 'full' : 'concise') as Recording['summaryDetail'],
    summaryDetailDirty: (row.summary_detail_dirty ?? 0) === 1 ? true : undefined,
    icon: row.icon ?? '',
    chapterKind: row.chapter_kind ?? '',
    chapterPosition: row.chapter_position ?? 0,
    chapterStatus: row.chapter_status ?? '',
    chapterGoalWords: row.chapter_goal_words ?? 0,
    chapterSynopsis: row.chapter_synopsis ?? '',
    chapterBeats: row.chapter_beats ?? '',
    chapterNotes: row.chapter_notes ?? '',
    deletedAt: row.deleted_at ?? undefined,
    notebookId: row.notebook_id ?? DEFAULT_NOTEBOOK_ID,
    tags: parseTags(row.tags),
    notebookDirty: row.notebook_dirty ? true : undefined,
    tagsDirty: row.tags_dirty ? true : undefined,
    archivedDirty: row.archived_dirty ? true : undefined,
    noteDirty: row.note_dirty ? true : undefined,
    titleVersion: row.title_version ?? undefined,
    recordedAtVersion: row.recorded_at_version ?? undefined,
    bodyVersion: row.body_version ?? undefined,
    syncConflict: parseConflict(row.sync_conflict),
    captureSourceId: row.capture_source_id ?? undefined,
    captureStartMs: row.capture_start_ms ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedHlc: row.updated_hlc ?? undefined,
  };

  // Segmentos, anexos e a pilha de audios so sao usados ao abrir a nota. Na
  // home, parsear esses JSONs de todas as notas era trabalho de boot sem uso.
  const segments = lazyParsed(row.transcript_segments, parseSegments);
  const attachments = lazyParsed(row.attachments, parseAttachments);
  const serverAudios = lazyParsed(row.server_audios, parseServerAudios);
  Object.defineProperties(recording, {
    transcriptSegments: { enumerable: true, configurable: true, get: segments },
    transcriptReview: {
      enumerable: true,
      configurable: true,
      get: () => parseReview(row.transcript_review),
    },
    attachments: { enumerable: true, configurable: true, get: attachments },
    serverAudios: { enumerable: true, configurable: true, get: serverAudios },
  });

  return recording;
}

export async function upsertRecording(r: Recording): Promise<void> {
  invalidateRecordingsCache();
  const db = await getDb();
  // Ja existe: a versao do relogio so avanca quando o conteudo muda. Atualizar
  // progresso de upload ou transcricao nao invalida a edicao que esta la.
  const previous = await db.getFirstAsync<{
    title: string;
    recorded_at: string;
    text: string | null;
    deleted_at: string | null;
    updated_hlc: string | null;
  }>('SELECT title, recorded_at, text, deleted_at, updated_hlc FROM recordings WHERE id = ?', [
    r.id,
  ]);
  const contentMoved =
    !previous ||
    previous.title !== r.title ||
    previous.recorded_at !== r.recordedAt ||
    (previous.text ?? '') !== (r.text ?? '') ||
    // Restaurar tambem e uma mudanca: sem carimbo novo, o tombstone de outro
    // ambiente (mais antigo que a exclusao, mais novo que o conteudo) venceria
    // e apagaria a nota de novo.
    (previous.deleted_at ?? '') !== (r.deletedAt ?? '');
  const updatedHlc =
    r.updatedHlc ?? (contentMoved ? await clockNow() : previous?.updated_hlc ?? undefined);
  await db.runAsync(
    `INSERT INTO recordings (
      id, title, recorded_at, dir, file_path, segment_count, duration_ms, size_bytes,
      status, upload_id, offset, attempts, next_attempt_at, last_error, terminal, entry_id, note_id,
      server_attachment_id,
      transcript, transcript_language, transcript_status, transcript_segments,
      transcript_review, transcript_checkpoint_ms,
      has_transcript, transcript_origin,
      source, text, content_type, file_name, duplicate, archived,
      notebook_id, tags, notebook_dirty, tags_dirty, archived_dirty,
      note_dirty, attachments,
      title_version, recorded_at_version, body_version, sync_conflict, server_audios,
      capture_source_id, capture_start_ms, created_at, updated_at, deleted_at, author, author_dirty,
      summary_detail, summary_detail_dirty, icon, updated_hlc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      recorded_at = excluded.recorded_at,
      dir = excluded.dir,
      file_path = excluded.file_path,
      segment_count = excluded.segment_count,
      duration_ms = excluded.duration_ms,
      size_bytes = excluded.size_bytes,
      status = excluded.status,
      upload_id = excluded.upload_id,
      offset = excluded.offset,
      attempts = excluded.attempts,
      next_attempt_at = excluded.next_attempt_at,
      last_error = excluded.last_error,
      terminal = excluded.terminal,
      entry_id = excluded.entry_id,
      note_id = excluded.note_id,
      server_attachment_id = excluded.server_attachment_id,
      transcript = excluded.transcript,
      transcript_language = excluded.transcript_language,
      transcript_status = excluded.transcript_status,
      transcript_segments = excluded.transcript_segments,
      transcript_checkpoint_ms = excluded.transcript_checkpoint_ms,
      has_transcript = excluded.has_transcript,
      transcript_origin = excluded.transcript_origin,
      source = excluded.source,
      text = excluded.text,
      content_type = excluded.content_type,
      file_name = excluded.file_name,
      duplicate = excluded.duplicate,
      archived = excluded.archived,
      notebook_id = excluded.notebook_id,
      tags = excluded.tags,
      notebook_dirty = excluded.notebook_dirty,
      tags_dirty = excluded.tags_dirty,
      archived_dirty = excluded.archived_dirty,
      note_dirty = excluded.note_dirty,
      attachments = excluded.attachments,
      title_version = excluded.title_version,
      recorded_at_version = excluded.recorded_at_version,
      body_version = excluded.body_version,
      sync_conflict = excluded.sync_conflict,
      server_audios = excluded.server_audios,
      capture_source_id = excluded.capture_source_id,
      capture_start_ms = excluded.capture_start_ms,
      deleted_at = excluded.deleted_at,
      author = excluded.author,
      author_dirty = excluded.author_dirty,
      summary_detail = excluded.summary_detail,
      summary_detail_dirty = excluded.summary_detail_dirty,
      icon = excluded.icon,
      updated_at = excluded.updated_at,
      updated_hlc = excluded.updated_hlc`,
    [
      r.id,
      r.title,
      r.recordedAt,
      r.dir,
      r.filePath ?? null,
      r.segmentCount,
      r.durationMs ?? null,
      r.sizeBytes ?? null,
      r.status,
      r.uploadId ?? null,
      r.offset,
      r.attempts,
      r.nextAttemptAt ?? null,
      r.lastError ?? null,
      r.terminal ? 1 : null,
      r.entryId ?? null,
      r.noteId ?? null,
      r.serverAttachmentId ?? null,
      r.transcript ?? null,
      r.transcriptLanguage ?? null,
      r.transcriptStatus ?? null,
      r.transcriptSegments ? JSON.stringify(r.transcriptSegments) : null,
      r.transcriptReview ? JSON.stringify(r.transcriptReview) : null,
      r.transcriptCheckpointMs ?? null,
      r.hasTranscript ? 1 : null,
      r.transcriptOrigin ?? null,
      r.source ?? null,
      r.text ?? null,
      r.contentType ?? null,
      r.fileName ?? null,
      r.duplicate ? 1 : null,
      r.archived ? 1 : null,
      r.notebookId ?? DEFAULT_NOTEBOOK_ID,
      r.tags && r.tags.length > 0 ? JSON.stringify(r.tags) : null,
      r.notebookDirty ? 1 : null,
      r.tagsDirty ? 1 : null,
      r.archivedDirty ? 1 : null,
      r.noteDirty ? 1 : null,
      r.attachments ? JSON.stringify(r.attachments) : null,
      r.titleVersion ?? null,
      r.recordedAtVersion ?? null,
      r.bodyVersion ?? null,
      r.syncConflict && r.syncConflict.length > 0 ? JSON.stringify(r.syncConflict) : null,
      r.serverAudios ? JSON.stringify(r.serverAudios) : null,
      r.captureSourceId ?? null,
      r.captureStartMs ?? null,
      r.createdAt,
      r.updatedAt,
      r.deletedAt ?? null,
      r.author ?? '',
      r.authorDirty ? '1' : null,
      r.summaryDetail ?? 'concise',
      r.summaryDetailDirty ? 1 : 0,
      r.icon ?? '',
      updatedHlc ?? null,
    ],
  );
}

/**
 * Leitura recente da biblioteca.
 *
 * Varias etapas da sincronizacao pedem a lista quase juntas (fila, transcricoes,
 * pull, reconciliacao). Cada uma fazia o `SELECT *` e montava todos os
 * `Recording` de novo na thread de JS, em rajadas durante a abertura do app.
 * O cache vale um instante curto e toda escrita o derruba.
 */
let recordingsCache: { at: number; includeDeleted: boolean; list: Recording[] } | null = null;
const RECORDINGS_CACHE_MS = 1_000;

function invalidateRecordingsCache(): void {
  recordingsCache = null;
}

export async function listRecordings(includeDeleted = false): Promise<Recording[]> {
  if (
    recordingsCache &&
    recordingsCache.includeDeleted === includeDeleted &&
    Date.now() - recordingsCache.at < RECORDINGS_CACHE_MS
  ) {
    // Copia rasa: o array e compartilhado entre as etapas da sincronizacao e
    // nenhuma delas pode ordenar/mexer no cache de outra.
    return recordingsCache.list.slice();
  }
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    includeDeleted
      ? 'SELECT * FROM recordings ORDER BY created_at DESC'
      : 'SELECT * FROM recordings WHERE deleted_at IS NULL ORDER BY created_at DESC',
  );
  const list = rows.map(rowToRecording);
  recordingsCache = { at: Date.now(), includeDeleted, list };
  return list;
}

/**
 * Sessoes que ficaram "gravando" depois de o app morrer viram "interrompida".
 *
 * Um UPDATE so: a varredura anterior lia a biblioteca inteira no boot, montava
 * cada Recording (com transcricao e segmentos) e regravava linha por linha para
 * trocar um campo. Devolve quantas linhas mudaram.
 */
export async function markInterruptedRecordings(now = new Date().toISOString()): Promise<number> {
  invalidateRecordingsCache();
  const db = await getDb();
  const result = await db.runAsync(
    "UPDATE recordings SET status = 'interrupted', updated_at = ? WHERE status = 'recording'",
    [now],
  );
  return result.changes ?? 0;
}

/** Notas na lixeira, da mais recentemente apagada para a mais antiga. */
export async function listTrashedRecordings(): Promise<Recording[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM recordings WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC',
  );
  return rows.map(rowToRecording);
}

/** Quantas notas esperam na lixeira (para o atalho nas Opcoes). */
export async function countTrashedRecordings(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM recordings WHERE deleted_at IS NOT NULL',
  );
  return row?.total ?? 0;
}

export async function getRecording(id: string): Promise<Recording | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM recordings WHERE id = ?', [id]);
  return row ? rowToRecording(row) : null;
}

/** Cache da pilha de audios do servidor para uma entrada (JSON por linha). */
export async function saveServerAudios(entryId: string, audios: ServerAudio[]): Promise<void> {
  invalidateRecordingsCache();
  const db = await getDb();
  await db.runAsync(
    'UPDATE recordings SET server_audios = ? WHERE entry_id = ?',
    [JSON.stringify(audios), entryId],
  );
}

/** Atualiza so o titulo/texto (autosave), sem ler/reescrever os JSONs pesados. */
export async function updateRecordingNote(
  id: string,
  patch: { title?: string; text?: string },
): Promise<void> {
  if (patch.title === undefined && patch.text === undefined) return;
  invalidateRecordingsCache();
  const db = await getDb();
  const hasTitle = patch.title !== undefined ? 1 : 0;
  const hasText = patch.text !== undefined ? 1 : 0;
  const title = patch.title ?? '';
  const text = patch.text ?? '';
  // Esta escrita nao passa pelo `upsertRecording`; o carimbo do relogio tem de
  // sair aqui tambem, senao a edicao feita no editor nao teria versao propria.
  const stamp = await clockNow();
  await db.runAsync(
    `UPDATE recordings
     SET title = CASE WHEN ? THEN ? ELSE title END,
         text = CASE WHEN ? THEN ? ELSE text END,
         note_dirty = CASE WHEN status = 'completed' THEN 1 ELSE note_dirty END,
         updated_at = ?,
         updated_hlc = ?
     WHERE id = ? AND (
       (? = 1 AND title <> ?) OR (? = 1 AND COALESCE(text, '') <> ?)
     )`,
    [
      hasTitle,
      title,
      hasText,
      text,
      new Date().toISOString(),
      stamp,
      id,
      hasTitle,
      title,
      hasText,
      text,
    ],
  );
}

export async function deleteRecordingRow(id: string): Promise<void> {
  invalidateRecordingsCache();
  const db = await getDb();
  await withGraphWrite(() =>
    db.withTransactionAsync(async () => {
      const row = await db.getFirstAsync<{ entry_id: string | null }>(
        'SELECT entry_id FROM recordings WHERE id = ?',
        [id],
      );
      await db.runAsync('DELETE FROM recordings WHERE id = ?', [id]);
      // A nota saiu da biblioteca: a atividade de transcricao fica no historico
      // (so o usuario apaga), mas e marcada como interrompida para nao tentar
      // de novo.
      cancelActivity(`transcription:${id}`, 'Nota apagada');
      // A nota saiu da biblioteca: as relacoes dela nao podem continuar no mapa,
      // seja qual for a chave que a analise usava (local ou do servidor). Se
      // outra linha ainda representa a mesma entrada (duplicata importada), os
      // vinculos ficam para ela.
      await db.runAsync('DELETE FROM entry_entities WHERE entry_id = ?', [id]);
      if (row?.entry_id) {
        const survivor = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM recordings WHERE entry_id = ? LIMIT 1',
          [row.entry_id],
        );
        if (!survivor) {
          await db.runAsync('DELETE FROM entry_entities WHERE entry_id = ?', [row.entry_id]);
        }
      }
    }),
  );
}

// --- Modo escritor: capitulos, ritmo e links da nota -------------------------

/** Campos de planejamento do capitulo. So as chaves presentes sao gravadas. */
export interface ChapterFields {
  chapterKind?: string;
  chapterPosition?: number;
  chapterStatus?: string;
  chapterGoalWords?: number;
  chapterSynopsis?: string;
  chapterBeats?: string;
  chapterNotes?: string;
}

/** Campo do `ChapterFields` e a coluna correspondente em `recordings`. */
const CHAPTER_COLUMNS: [keyof ChapterFields, string][] = [
  ['chapterKind', 'chapter_kind'],
  ['chapterPosition', 'chapter_position'],
  ['chapterStatus', 'chapter_status'],
  ['chapterGoalWords', 'chapter_goal_words'],
  ['chapterSynopsis', 'chapter_synopsis'],
  ['chapterBeats', 'chapter_beats'],
  ['chapterNotes', 'chapter_notes'],
];

/**
 * Atualiza so o planejamento do capitulo (um campo por vez, como o painel
 * manda), sem tocar no texto nem nos JSONs pesados da nota.
 */
export async function updateChapterFields(id: string, fields: ChapterFields): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [campo, coluna] of CHAPTER_COLUMNS) {
    const valor = fields[campo];
    if (valor === undefined) continue;
    sets.push(`${coluna} = ?`);
    params.push(valor);
  }
  if (sets.length === 0) return;
  invalidateRecordingsCache();
  const db = await getDb();
  await db.runAsync(`UPDATE recordings SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

/**
 * Proxima posicao livre do livro: fim da lista (passo de 1024), contando so as
 * notas vivas. Entrar no meio depende do arrastar, que reescreve a lista toda.
 */
export async function nextChapterPosition(notebookId: string): Promise<number> {
  if (!notebookId) return 1024;
  const db = await getDb();
  const row = await db.getFirstAsync<{ max_position: number | null }>(
    `SELECT MAX(chapter_position) AS max_position
       FROM recordings
      WHERE notebook_id = ? AND deleted_at IS NULL`,
    [notebookId],
  );
  const ultima = Number(row?.max_position ?? 0);
  return (Number.isFinite(ultima) && ultima > 0 ? ultima : 0) + 1024;
}

/**
 * Grava a ordem inteira do livro de uma vez, numa transacao: metade reordenada
 * nunca aparece. `updated_at` sobe porque a lista mudou no aparelho.
 */
export async function replaceChapterOrder(
  notebookId: string,
  chapters: Array<{ id: string; chapterKind: string; chapterStatus: string; position: number }>,
): Promise<void> {
  if (!notebookId || chapters.length === 0) return;
  invalidateRecordingsCache();
  const db = await getDb();
  const stamp = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const chapter of chapters) {
      await db.runAsync(
        `UPDATE recordings
            SET chapter_kind = ?,
                chapter_status = ?,
                chapter_position = ?,
                updated_at = ?
          WHERE id = ? AND notebook_id = ?`,
        [
          chapter.chapterKind,
          chapter.chapterStatus,
          chapter.position,
          stamp,
          chapter.id,
          notebookId,
        ],
      );
    }
  });
}

/**
 * Soma (ou desconta) as palavras liquidas de um dia no ritmo do livro. Apagar
 * tambem conta: o numero mostra o que a sessao escreveu, nao o tamanho do texto.
 */
export async function addWritingWords(
  notebookId: string,
  day: string,
  delta: number,
): Promise<void> {
  if (!notebookId || !day || !Number.isFinite(delta) || delta === 0) return;
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO writing_days (notebook_id, day, words) VALUES (?, ?, ?)
     ON CONFLICT(notebook_id, day) DO UPDATE SET words = words + excluded.words`,
    [notebookId, day, Math.trunc(delta)],
  );
}

/**
 * Chave de dia no relogio do escritor (YYYY-MM-DD). O servidor tambem conta no
 * dia local: escrever as 22h em UTC-3 e "hoje", nao amanha.
 */
function dayKey(date: Date): string {
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mes}-${dia}`;
}

/**
 * Ritmo do livro nos ultimos `days` dias (1..90), terminando hoje.
 * Dias sem escrita vem com zero, do mais antigo ao mais novo, para a faixa nao
 * encolher; palavra negativa (dia so com corte) aparece como zero.
 */
export async function listWritingDays(
  notebookId: string,
  days: number,
  today: Date = new Date(),
): Promise<Array<{ day: string; words: number }>> {
  const span = Math.min(90, Math.max(1, Math.trunc(Number.isFinite(days) ? days : 1)));
  const fim = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const chaves: string[] = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    // setDate anda no calendario local, sem erro de fuso nem de horario de verao.
    const dia = new Date(fim);
    dia.setDate(fim.getDate() - i);
    chaves.push(dayKey(dia));
  }
  if (!notebookId) return chaves.map((day) => ({ day, words: 0 }));
  const db = await getDb();
  const rows = await db.getAllAsync<{ day: string; words: number }>(
    `SELECT day, words FROM writing_days
      WHERE notebook_id = ? AND day >= ? AND day <= ?`,
    [notebookId, chaves[0], chaves[chaves.length - 1]],
  );
  const porDia = new Map<string, number>();
  for (const row of rows) {
    const palavras = Number(row.words);
    porDia.set(row.day, Number.isFinite(palavras) ? palavras : 0);
  }
  return chaves.map((day) => ({ day, words: Math.max(0, porDia.get(day) ?? 0) }));
}

/** Link de uma nota: referencia interna (to_entry_id) ou URL externa. */
export interface EntryLinkRow {
  id: string;
  from_entry_id: string;
  to_entry_id: string;
  url: string;
  label: string;
  title: string;
  created_at: string;
}

/** Links que saem da nota, na ordem em que foram criados. */
export async function listEntryLinks(entryId: string): Promise<EntryLinkRow[]> {
  if (!entryId) return [];
  const db = await getDbForUI();
  return db.getAllAsync<EntryLinkRow>(
    `SELECT id, from_entry_id, to_entry_id, url, label, title, created_at
       FROM entry_links
      WHERE from_entry_id = ?
      ORDER BY created_at ASC, id ASC`,
    [entryId],
  );
}

/** Grava o link; repetir o mesmo id atualiza em vez de estourar. */
export async function insertEntryLink(link: EntryLinkRow): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO entry_links (id, from_entry_id, to_entry_id, url, label, title, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       from_entry_id = excluded.from_entry_id,
       to_entry_id = excluded.to_entry_id,
       url = excluded.url,
       label = excluded.label,
       title = excluded.title,
       created_at = excluded.created_at`,
    [
      link.id,
      link.from_entry_id,
      link.to_entry_id,
      link.url,
      link.label,
      link.title,
      link.created_at,
    ],
  );
}

export async function deleteEntryLink(id: string): Promise<void> {
  if (!id) return;
  const db = await getDb();
  await db.runAsync('DELETE FROM entry_links WHERE id = ?', [id]);
}

export interface StoredMetricsSnapshot {
  payload: string;
  generatedAt: string;
  syncedAt: string | null;
}

/**
 * Guarda o ultimo snapshot das metricas de escrita. Fica no aparelho mesmo sem
 * servidor: o painel le daqui e, quando houver servidor, e isto que sobe.
 */
export async function saveMetricsSnapshot(
  payload: string,
  generatedAt: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO metrics_snapshot (id, payload, generated_at, synced_at) VALUES (1, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at`,
    [payload, generatedAt],
  );
}

export async function loadMetricsSnapshot(): Promise<StoredMetricsSnapshot | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    payload: string;
    generated_at: string;
    synced_at: string | null;
  }>('SELECT payload, generated_at, synced_at FROM metrics_snapshot WHERE id = 1');
  if (!row) return null;
  return { payload: row.payload, generatedAt: row.generated_at, syncedAt: row.synced_at };
}

/** Marca o snapshot como enviado (o valor local continua valendo para o painel). */
export async function markMetricsSynced(syncedAt: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE metrics_snapshot SET synced_at = ? WHERE id = 1', [syncedAt]);
}

/** Quem produziu a analise guardada: o servidor ou o modelo do aparelho. */
export type AnalysisOrigin = 'server' | 'local';

/** Analise de uma nota, guardada no aparelho para a ficha e o painel. */
export interface CachedAnalysis {
  entryId: string;
  title: string;
  recordedAt: string;
  /** Origem; ausente equivale a 'server' (dados de versoes anteriores). */
  origin?: AnalysisOrigin;
  /** Hash do conteudo analisado (so a analise local preenche). */
  contentHash?: string;
  analysis: ServerAnalysis;
}

/**
 * Salva as analises. Upsert por entrada: a mais nova substitui a anterior. O
 * resultado local vence o do servidor (first-wins) e o servidor nunca
 * sobrescreve uma analise feita no aparelho.
 */
export async function saveCachedAnalyses(items: CachedAnalysis[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const fetchedAt = new Date().toISOString();
  const owners = await ownerKeysFor(db);
  // Uma transacao para o lote inteiro: antes era uma por analise, e num pull
  // com dezenas de analises novas o banco ficava segurando a conexao por
  // segundos, atrasando a leitura do mapa que estava abrindo.
  await withGraphWrite(() =>
    db.withTransactionAsync(async () => {
      for (const item of items) {
        const payload = JSON.stringify(item.analysis);
        await db.runAsync(
          `INSERT INTO analyses (
             entry_id, title, recorded_at, payload, fetched_at, origin, analysis_content_hash
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(entry_id) DO UPDATE SET
             title = excluded.title,
             recorded_at = excluded.recorded_at,
             payload = excluded.payload,
             fetched_at = excluded.fetched_at,
             origin = excluded.origin,
             analysis_content_hash = excluded.analysis_content_hash
           WHERE excluded.origin = 'local' OR analyses.origin IS NOT 'local'`,
          [
            item.entryId,
            item.title,
            item.recordedAt,
            payload,
            fetchedAt,
            item.origin ?? 'server',
            item.contentHash ?? null,
          ],
        );
        const kept = await db.getFirstAsync<{ payload: string }>(
          'SELECT payload FROM analyses WHERE entry_id = ?',
          [item.entryId],
        );
        // A analise local vence: se o upsert foi recusado, os vinculos seguem
        // os da analise que ficou, nao os da tentativa descartada.
        if (kept?.payload === payload) {
          await replaceEntryEntities(db, item.entryId, item.analysis, fetchedAt, owners);
        }
      }
    }),
  );
}

interface CachedAnalysisRow {
  entry_id: string;
  title: string;
  recorded_at: string;
  payload: string;
  origin: string | null;
  analysis_content_hash: string | null;
}

function toCachedAnalysis(row: CachedAnalysisRow): CachedAnalysis | null {
  try {
    return {
      entryId: row.entry_id,
      title: row.title,
      recordedAt: row.recorded_at,
      origin: row.origin === 'local' ? 'local' : 'server',
      contentHash: row.analysis_content_hash ?? undefined,
      analysis: JSON.parse(row.payload) as ServerAnalysis,
    };
  } catch {
    // Payload invalido (versao antiga/corrompido): ignora a linha.
    return null;
  }
}

/** Analises guardadas no aparelho, da nota mais recente para a mais antiga. */
export async function listCachedAnalyses(): Promise<CachedAnalysis[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CachedAnalysisRow>(
    'SELECT entry_id, title, recorded_at, payload, origin, analysis_content_hash FROM analyses ORDER BY recorded_at DESC',
  );
  const out: CachedAnalysis[] = [];
  for (const row of rows) {
    const item = toCachedAnalysis(row);
    if (item) out.push(item);
  }
  return out;
}

/**
 * Apaga a analise que veio do servidor. A analise local fica: ela descreve o
 * texto do aparelho e so o proprio app a invalida (hash do conteudo).
 *
 * Serve para quando o servidor deixa de ter analise (o audio e a transcricao
 * foram apagados); manter a copia mostraria a medida de um texto que nao existe.
 */
export async function deleteCachedServerAnalysis(entryId: string): Promise<void> {
  const db = await getDb();
  await withGraphWrite(() =>
    db.withTransactionAsync(async () => {
      await db.runAsync(
        `DELETE FROM analyses WHERE entry_id = ? AND origin IS NOT 'local'`,
        [entryId],
      );
      // Sem analise nenhuma, nao ha relacao para provar: os vinculos saem junto
      // para o mapa nao mostrar uma entidade que veio de um texto apagado.
      const left = await db.getFirstAsync<{ entry_id: string }>(
        'SELECT entry_id FROM analyses WHERE entry_id = ? LIMIT 1',
        [entryId],
      );
      if (!left) await db.runAsync('DELETE FROM entry_entities WHERE entry_id = ?', [entryId]);
    }),
  );
}

/** Analise guardada de uma nota. */
export async function getCachedAnalysis(entryId: string): Promise<CachedAnalysis | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CachedAnalysisRow>(
    'SELECT entry_id, title, recorded_at, payload, origin, analysis_content_hash FROM analyses WHERE entry_id = ?',
    [entryId],
  );
  return row ? toCachedAnalysis(row) : null;
}

/** Linha leve do mapa: sem texto, sem transcricao e sem o JSON da analise. */
export interface GraphRecordingRow {
  localId: string;
  entryId?: string;
  title: string;
  recordedAt: string;
  notebookId: string;
  author?: string;
  archived: boolean;
  definitive?: { key: string; origin: string };
  local?: { key: string; origin: string };
}

/**
 * Le so o que o desenho precisa de cada nota: identificacao, caderno e a chave
 * da analise. Nenhum payload e parseado para abrir o mapa; o tom do Humor e os
 * trechos sao lidos sob demanda.
 */
export async function listGraphRecordings(): Promise<GraphRecordingRow[]> {
  const tOpen = Date.now();
  const db = await getDb();
  const tQuery = Date.now();
  // O SQLite monta o JSON e devolve UMA linha: 400 notas viravam ~4400
  // valores atravessando a ponte uma vez por campo (segundos no dev build).
  const row = await db.getFirstAsync<{ data: string | null }>(`
    SELECT json_group_array(json_object(
      'localId', r.id,
      'entryId', r.entry_id,
      'title', r.title,
      'recordedAt', r.recorded_at,
      'notebookId', COALESCE(r.notebook_id, ''),
      'author', COALESCE(r.author, ''),
      'archived', COALESCE(r.archived, 0),
      'defKey', ad.entry_id,
      'defOrigin', ad.origin,
      'localKey', al.entry_id,
      'localOrigin', al.origin
    )) AS data
    FROM recordings r
    LEFT JOIN analyses ad ON ad.entry_id = r.entry_id
    LEFT JOIN analyses al ON al.entry_id = r.id
    WHERE r.deleted_at IS NULL
    ORDER BY r.recorded_at DESC
  `);
  const parsed: {
    localId: string;
    entryId: string | null;
    title: string;
    recordedAt: string;
    notebookId: string;
    author: string;
    archived: number;
    defKey: string | null;
    defOrigin: string | null;
    localKey: string | null;
    localOrigin: string | null;
  }[] = row?.data ? JSON.parse(row.data) : [];
  if (__DEV__) {
    console.log(`[db] recordings open ${tQuery - tOpen}ms query ${Date.now() - tQuery}ms`);
  }
  return parsed.map((item) => ({
    localId: item.localId,
    entryId: item.entryId ?? undefined,
    title: item.title,
    recordedAt: item.recordedAt,
    notebookId: item.notebookId ?? '',
    author: item.author || undefined,
    archived: item.archived === 1,
    definitive: item.defKey
      ? { key: item.defKey, origin: item.defOrigin ?? 'server' }
      : undefined,
    local: item.localKey
      ? { key: item.localKey, origin: item.localOrigin ?? 'server' }
      : undefined,
  }));
}

export interface GraphEntryDetail {
  text?: string;
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

/** Texto/transcricao/segmentos so das notas que o painel vai mostrar. */
export async function loadGraphEntryDetails(
  localIds: string[],
): Promise<Record<string, GraphEntryDetail>> {
  const ids = [...new Set(localIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const db = await getDbForUI();
  const out: Record<string, GraphEntryDetail> = {};
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const rows = await db.getAllAsync<{
      id: string;
      text: string | null;
      transcript: string | null;
      transcript_segments: string | null;
    }>(
      `SELECT id, text, transcript, transcript_segments
       FROM recordings WHERE id IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const row of rows) {
      out[row.id] = {
        text: row.text ?? undefined,
        transcript: row.transcript ?? undefined,
        transcriptSegments: parseSegments(row.transcript_segments),
      };
    }
  }
  return out;
}

/** Leitura/resumo da analise das notas do painel, sem parsear o payload. */
export async function loadAnalysisComments(
  entryIds: string[],
): Promise<Record<string, { reading: string; summary: string }>> {
  const ids = [...new Set(entryIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const db = await getDbForUI();
  const out: Record<string, { reading: string; summary: string }> = {};
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const rows = await db.getAllAsync<{
      entry_id: string;
      reading: string | null;
      summary: string | null;
    }>(
      `SELECT entry_id,
         CASE WHEN json_valid(payload) THEN json_extract(payload, '$.reading') END AS reading,
         CASE WHEN json_valid(payload) THEN json_extract(payload, '$.summary') END AS summary
       FROM analyses WHERE entry_id IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const row of rows) {
      out[row.entry_id] = { reading: row.reading ?? '', summary: row.summary ?? '' };
    }
  }
  return out;
}

/** Tom por nota, lido do payload só quando a aba Humor é aberta. */
export async function loadAnalysisSentiments(
  entryIds: string[],
): Promise<Record<string, number>> {
  const ids = [...new Set(entryIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const db = await getDb();
  const out: Record<string, number> = {};
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const rows = await db.getAllAsync<{ entry_id: string; sentiment: number | null }>(
      `SELECT entry_id,
         CASE WHEN json_valid(payload) THEN json_extract(payload, '$.sentiment') END AS sentiment
       FROM analyses WHERE entry_id IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const row of rows) {
      if (typeof row.sentiment === 'number') out[row.entry_id] = row.sentiment;
    }
  }
  return out;
}

/** Resultado da leitura de um bloco, guardado para retomada e cache. */
export interface StoredAnalysisChunk {
  entryId: string;
  blockIndex: number;
  blockHash: string;
  promptVersion: number;
  model: string;
  /** `ok` quando o modelo respondeu e a ancora aceitou; `rejected` quando nao. */
  status: 'ok' | 'rejected';
  /** Itens que o codigo descartou por nao existirem no bloco. */
  dropped: number;
  extraction: ChunkExtraction;
}

interface AnalysisChunkRow {
  entry_id: string;
  block_index: number;
  block_hash: string;
  prompt_version: number;
  model: string;
  status: string;
  dropped: number;
  payload: string;
}

/** Blocos ja lidos de uma nota, inclusive os recusados. */
export async function listAnalysisChunks(entryId: string): Promise<StoredAnalysisChunk[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AnalysisChunkRow>(
    `SELECT entry_id, block_index, block_hash, prompt_version, model, status, dropped, payload
     FROM analysis_chunks WHERE entry_id = ? ORDER BY block_index`,
    [entryId],
  );
  const out: StoredAnalysisChunk[] = [];
  for (const row of rows) {
    try {
      out.push({
        entryId: row.entry_id,
        blockIndex: row.block_index,
        blockHash: row.block_hash,
        promptVersion: row.prompt_version,
        model: row.model,
        status: row.status === 'ok' ? 'ok' : 'rejected',
        dropped: row.dropped,
        extraction: JSON.parse(row.payload) as ChunkExtraction,
      });
    } catch {
      // Linha corrompida: o bloco sera lido de novo.
    }
  }
  return out;
}

/** Grava os blocos lidos. Upsert por indice: o hash decide se ainda vale. */
export async function saveAnalysisChunks(chunks: StoredAnalysisChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  for (const chunk of chunks) {
    await db.runAsync(
      `INSERT INTO analysis_chunks (
         entry_id, block_index, block_hash, prompt_version, model, status, dropped, payload, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entry_id, block_index) DO UPDATE SET
         block_hash = excluded.block_hash,
         prompt_version = excluded.prompt_version,
         model = excluded.model,
         status = excluded.status,
         dropped = excluded.dropped,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      [
        chunk.entryId,
        chunk.blockIndex,
        chunk.blockHash,
        chunk.promptVersion,
        chunk.model,
        chunk.status,
        chunk.dropped,
        JSON.stringify(chunk.extraction),
        updatedAt,
      ],
    );
  }
}

/** Apaga os blocos de uma nota: usado no "analisar de novo" (recomeco). */
export async function deleteAnalysisChunks(entryId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM analysis_chunks WHERE entry_id = ?', [entryId]);
}

/** Ultimo `analysis_at` do servidor ja buscado para a entrada. */
export async function getAnalysisSyncAt(entryId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ source_at: string }>(
    'SELECT source_at FROM analysis_sync WHERE entry_id = ?',
    [entryId],
  );
  return row?.source_at ?? null;
}

/** Ultimo `transcript_at` do servidor ja trazido para a entrada. */
export async function getTranscriptSyncAt(entryId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ source_at: string }>(
    'SELECT source_at FROM transcript_sync WHERE entry_id = ?',
    [entryId],
  );
  return row?.source_at ?? null;
}

/** Marca a atualizacao da transcricao como ja trazida para o banco. */
export async function setTranscriptSyncAt(entryId: string, sourceAt: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO transcript_sync (entry_id, source_at) VALUES (?, ?)
     ON CONFLICT(entry_id) DO UPDATE SET source_at = excluded.source_at`,
    [entryId, sourceAt],
  );
}

/** Marcador de transcricao por ambiente (a mesma nota pode ter versoes). */
export async function getTranscriptSyncAtEnv(
  serverId: string,
  entryId: string,
): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ source_at: string }>(
    'SELECT source_at FROM transcript_sync_env WHERE server_id = ? AND entry_id = ?',
    [serverId, entryId],
  );
  return row?.source_at ?? null;
}

export async function setTranscriptSyncAtEnv(
  serverId: string,
  entryId: string,
  sourceAt: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO transcript_sync_env (server_id, entry_id, source_at) VALUES (?, ?, ?)
     ON CONFLICT(server_id, entry_id) DO UPDATE SET source_at = excluded.source_at`,
    [serverId, entryId, sourceAt],
  );
}

/** Marcador de analise por ambiente. */
export async function getAnalysisSyncAtEnv(
  serverId: string,
  entryId: string,
): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ source_at: string }>(
    'SELECT source_at FROM analysis_sync_env WHERE server_id = ? AND entry_id = ?',
    [serverId, entryId],
  );
  return row?.source_at ?? null;
}

export async function setAnalysisSyncAtEnv(
  serverId: string,
  entryId: string,
  sourceAt: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO analysis_sync_env (server_id, entry_id, source_at) VALUES (?, ?, ?)
     ON CONFLICT(server_id, entry_id) DO UPDATE SET source_at = excluded.source_at`,
    [serverId, entryId, sourceAt],
  );
}

/** Marca a atualizacao da analise do servidor como ja trazida para o banco. */
export async function setAnalysisSyncAt(entryId: string, sourceAt: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO analysis_sync (entry_id, source_at) VALUES (?, ?)
     ON CONFLICT(entry_id) DO UPDATE SET source_at = excluded.source_at`,
    [entryId, sourceAt],
  );
}

/**
 * Uma linha do historico do centro de atividade. Sem funcoes: as acoes
 * (`parar`, `tentar de novo`) so existem enquanto o processo esta vivo.
 */
export interface StoredActivityRow {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  status: string;
  progress: number | null;
  startedAt: number;
  finishedAt: number | null;
  seen: number;
}

/** Grava (ou atualiza) uma atividade no historico local. */
export async function saveActivityRow(row: StoredActivityRow): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO activity_log
       (id, kind, title, detail, status, progress, started_at, finished_at, seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       detail = excluded.detail,
       status = excluded.status,
       progress = excluded.progress,
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       seen = excluded.seen`,
    [
      row.id,
      row.kind,
      row.title,
      row.detail,
      row.status,
      row.progress,
      row.startedAt,
      row.finishedAt,
      row.seen,
    ],
  );
}

/** Historico do centro de atividade, do mais recente para o mais antigo. */
export async function listActivityRows(limit: number): Promise<StoredActivityRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    kind: string;
    title: string;
    detail: string | null;
    status: string;
    progress: number | null;
    started_at: number;
    finished_at: number | null;
    seen: number;
  }>(
    `SELECT id, kind, title, detail, status, progress, started_at, finished_at, seen
     FROM activity_log ORDER BY started_at DESC LIMIT ?`,
    [Math.max(1, Math.round(limit))],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    status: row.status,
    progress: row.progress,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    seen: row.seen,
  }));
}

export async function deleteActivityRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM activity_log WHERE id = ?`, [id]);
}

export async function deleteFinishedActivityRows(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM activity_log WHERE status <> 'running'`);
}

export async function markActivityRowsSeen(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE activity_log SET seen = 1 WHERE status <> 'running'`);
}

/** Mantem o historico limitado, sem apagar o que ainda esta rodando. */
export async function pruneActivityRows(keep: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM activity_log WHERE status <> 'running' AND id NOT IN (
       SELECT id FROM activity_log ORDER BY started_at DESC LIMIT ?
     )`,
    [Math.max(1, Math.round(keep))],
  );
}

/**
 * Move a analise de uma chave temporaria (id local da nota, antes do upload)
 * para a chave definitiva (entry id do servidor). A origem local vence; se a
 * chave de destino ja tem uma analise local, ela e mantida.
 */
export async function moveCachedAnalysis(fromKey: string, toKey: string): Promise<void> {
  if (fromKey === toKey) return;
  const db = await getDb();
  await withGraphWrite(() =>
    db.withTransactionAsync(async () => {
      const source = await db.getFirstAsync<{ origin: string | null }>(
        'SELECT origin FROM analyses WHERE entry_id = ?',
        [fromKey],
      );
      if (!source) return;
      const target = await db.getFirstAsync<{ origin: string | null }>(
        'SELECT origin FROM analyses WHERE entry_id = ?',
        [toKey],
      );
      // Destino local ou origem de destino mais forte: mantem o destino.
      if (target && (target.origin === 'local' || source.origin !== 'local')) {
        await db.runAsync('DELETE FROM analyses WHERE entry_id = ?', [fromKey]);
        await db.runAsync('DELETE FROM entry_entities WHERE entry_id = ?', [fromKey]);
        return;
      }
      await db.runAsync('DELETE FROM analyses WHERE entry_id = ?', [toKey]);
      await db.runAsync('UPDATE analyses SET entry_id = ? WHERE entry_id = ?', [toKey, fromKey]);
      // As relacoes seguem a analise: sem isso o mapa perderia a nota ou
      // mostraria os vinculos da analise descartada.
      await db.runAsync('DELETE FROM entry_entities WHERE entry_id = ?', [toKey]);
      await db.runAsync('UPDATE entry_entities SET entry_id = ? WHERE entry_id = ?', [toKey, fromKey]);
    }),
  );
}

interface AnalysisRunRow {
  id: string;
  entry_id: string;
  analysis_id: string | null;
  attachment_id: string | null;
  runtime: string;
  provider: string;
  model: string;
  attempt: number;
  outcome: string;
  error_class: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  input_text_chars: number;
  input_transcript_chars: number;
  input_images: number;
  prompt_tokens: number;
  completion_tokens: number;
  tokens_per_second: number;
  threads: number | null;
  battery_delta_pct: number | null;
}

/** Grava as tentativas de analise do aparelho. Idempotente por id. */
export async function saveAnalysisRuns(runs: AnalysisRun[]): Promise<void> {
  if (runs.length === 0) return;
  const db = await getDb();
  const createdAt = new Date().toISOString();
  for (const run of runs) {
    await db.runAsync(
      `INSERT OR IGNORE INTO analysis_runs (
        id, entry_id, analysis_id, attachment_id, runtime, provider, model, attempt,
        outcome, error_class, started_at, finished_at, duration_ms, input_text_chars,
        input_transcript_chars, input_images, prompt_tokens, completion_tokens,
        tokens_per_second, threads, battery_delta_pct, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.entryId,
        run.analysisId ?? null,
        run.attachmentId ?? null,
        run.runtime,
        run.provider,
        run.model,
        run.attempt,
        run.outcome,
        run.errorClass ?? null,
        run.startedAt,
        run.finishedAt,
        run.durationMs,
        run.inputTextChars,
        run.inputTranscriptChars,
        run.inputImages,
        run.promptTokens,
        run.completionTokens,
        run.tokensPerSecond,
        run.threads ?? null,
        run.batteryDeltaPct ?? null,
        createdAt,
      ],
    );
  }
}

/** Execucoes de analise guardadas no aparelho, da mais recente para a antiga. */
export async function listAnalysisRuns(limit = 1000): Promise<AnalysisRun[]> {
  const db = await getDb();
  const capped = Math.max(1, Math.min(limit, 5000));
  const rows = await db.getAllAsync<AnalysisRunRow>(
    `SELECT id, entry_id, analysis_id, attachment_id, runtime, provider, model, attempt,
      outcome, error_class, started_at, finished_at, duration_ms, input_text_chars,
      input_transcript_chars, input_images, prompt_tokens, completion_tokens,
      tokens_per_second, threads, battery_delta_pct
     FROM analysis_runs ORDER BY started_at DESC LIMIT ?`,
    [capped],
  );
  return rows.map((row) => ({
    id: row.id,
    entryId: row.entry_id,
    analysisId: row.analysis_id ?? undefined,
    attachmentId: row.attachment_id ?? undefined,
    runtime: row.runtime as AnalysisRuntime,
    provider: row.provider,
    model: row.model,
    attempt: row.attempt,
    outcome: row.outcome as AnalysisOutcome,
    errorClass: row.error_class ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    inputTextChars: row.input_text_chars,
    inputTranscriptChars: row.input_transcript_chars,
    inputImages: row.input_images,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    tokensPerSecond: row.tokens_per_second,
    threads: row.threads ?? undefined,
    batteryDeltaPct: row.battery_delta_pct ?? undefined,
  }));
}

/**
 * Entidades e relacoes do mapa.
 *
 * A derivacao mora no aparelho, mas o formato e o do servidor: as mesmas quatro
 * tabelas (`entities`, `entity_aliases`, `entry_entities`, `owner_aliases`).
 * Assim renomear, mesclar, trocar o icone e "sou eu" valem nos dois lados, e a
 * analise futura que ainda disser o nome antigo cai na mesma entidade.
 */

const AUTHOR_SETTINGS_KEY = 'author_settings';
const ENTITIES_BACKFILL_KEY = 'entities_backfilled_v1';
const ENTITIES_CURSOR_KEY = 'entities_backfill_cursor';

interface OwnerAliasRow {
  name: string;
}

/** Le o nome do dono do cache de configuracoes, sem importar o servico (ciclo). */
async function readOwnerSettings(db: Database): Promise<{ ownerName: string }> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_flags WHERE key = ?',
    [AUTHOR_SETTINGS_KEY],
  );
  if (!row) return { ownerName: '' };
  try {
    const parsed = JSON.parse(row.value) as { ownerName?: unknown };
    return { ownerName: typeof parsed.ownerName === 'string' ? parsed.ownerName : '' };
  } catch {
    return { ownerName: '' };
  }
}

/** Chaves do dono, como o servidor monta em `ownerPersonKeys`. */
async function ownerKeysFor(db: Database): Promise<Set<string>> {
  const keys = new Set<string>();
  const { ownerName } = await readOwnerSettings(db);
  // O servidor usa "Você" quando o dono ainda nao escolheu um nome; a mesma
  // chave evita que uma analise crie uma pessoa chamada "Você".
  keys.add(ownerKey(ownerName.trim() || 'Você'));
  const rows = await db.getAllAsync<OwnerAliasRow>('SELECT name FROM owner_aliases');
  for (const row of rows) {
    const key = ownerKey(row.name);
    if (key) keys.add(key);
  }
  return keys;
}

/** Chave de comparacao de `(kind, name_key)`, a mesma da tabela de rejeicoes. */
function rejectionLookupKey(kind: string, nameKey: string): string {
  return `${kind}\u0000${nameKey}`;
}

/** Todos os nomes rejeitados, para o filtro antes de persistir um vinculo. */
async function rejectedEntityKeys(db: Database): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ kind: string; name_key: string }>(
    'SELECT kind, name_key FROM entity_rejections',
  );
  return new Set(rows.map((row) => rejectionLookupKey(row.kind, row.name_key)));
}

/**
 * Grava (ou atualiza) a rejeicao local. A chave e `(kind, name_key)`: uma nova
 * grafia do mesmo nome atualiza o texto e o relogio sem duplicar a linha.
 */
async function upsertLocalEntityRejection(
  db: Database,
  kind: EntityKind,
  name: string,
  now: string,
  updatedAt = now,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.runAsync(
    `INSERT INTO entity_rejections (kind, name, name_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (kind, name_key) DO UPDATE SET
       name = excluded.name,
       updated_at = excluded.updated_at`,
    [kind, trimmed, entityNameKey(trimmed), now, updatedAt],
  );
}

/** Nome exibido no centro do mapa. Vazio quando o dono ainda nao escolheu. */
export async function getOwnerName(): Promise<string> {
  const db = await getDb();
  const { ownerName } = await readOwnerSettings(db);
  return ownerName.trim();
}

/** Entidade canonica local, no mesmo formato do no do mapa. */
export async function listLocalEntities(): Promise<GraphEntity[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    kind: string;
    name: string;
    label: string;
    icon: string;
    updated_at: string;
  }>('SELECT id, kind, name, label, icon, updated_at FROM entities ORDER BY kind, name');
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as EntityKind,
    name: row.name,
    label: row.label ?? '',
    icon: row.icon ?? '',
    updatedAt: row.updated_at ?? '',
  }));
}

/** Nomes recusados pelo dono, com o relogio do sync. */
export async function listEntityRejections(): Promise<EntityRejection[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    kind: string;
    name: string;
    name_key: string;
    updated_at: string;
  }>(
    'SELECT kind, name, name_key, updated_at FROM entity_rejections ORDER BY kind, name',
  );
  return rows.map((row) => ({
    kind: row.kind as EntityKind,
    name: row.name,
    nameKey: row.name_key,
    updatedAt: row.updated_at ?? '',
  }));
}

/** Ligacoes nota -> entidade, com a chave da analise (local ou do servidor). */
export async function listEntityLinks(): Promise<EntityLink[]> {
  const db = await getDb();
  // Uma linha JSON em vez de uma por vinculo: cada campo atravessava a ponte
  // separado e 850 vinculos custavam quase um segundo no dev build.
  const row = await db.getFirstAsync<{ data: string | null }>(`
    SELECT json_group_array(json_object(
      'entryId', entry_id,
      'entityId', entity_id,
      'count', count,
      'relation', relation,
      'sentiment', sentiment
    )) AS data
    FROM entry_entities
  `);
  const rows: {
    entryId: string;
    entityId: string;
    count: number;
    relation: string | null;
    sentiment: number | null;
  }[] = row?.data ? JSON.parse(row.data) : [];
  return rows.map((item) => ({
    entryId: item.entryId,
    entityId: item.entityId,
    count: item.count,
    relation: item.relation ?? undefined,
    sentiment: item.sentiment ?? undefined,
  }));
}

/** Grafias antigas por entidade, para casar trechos sem perder o nome atual. */
export async function listEntityAliases(): Promise<Record<string, string[]>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ entity_id: string; name: string }>(
    'SELECT entity_id, name FROM entity_aliases ORDER BY created_at, name',
  );
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    (out[row.entity_id] ??= []).push(row.name);
  }
  return out;
}

/** Grafias que o dono marcou como "sou eu". */
export async function listOwnerAliases(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OwnerAliasRow>('SELECT name FROM owner_aliases ORDER BY name');
  return rows.map((row) => row.name);
}

/**
 * Le tudo o que o aparelho sabe alem da nota e da midia: analises, blocos ja
 * lidos e o estado do mapa (entidades, aliases, vinculos, dono, rejeicoes e
 * posicoes). O servico de backup grava isso no manifesto; sem esse estado uma
 * restauracao devolveria as notas sem ficha e sem mapa.
 */
export async function exportBackupKnowledge(
  dbArg?: Database,
): Promise<BackupKnowledge> {
  const db = dbArg ?? (await getDb());
  const analyses = await db.getAllAsync<{
    entry_id: string;
    title: string;
    recorded_at: string;
    payload: string;
    fetched_at: string;
    origin: string | null;
    analysis_content_hash: string | null;
  }>(
    `SELECT entry_id, title, recorded_at, payload, fetched_at, origin, analysis_content_hash
     FROM analyses ORDER BY recorded_at`,
  );
  const chunks = await db.getAllAsync<{
    entry_id: string;
    block_index: number;
    block_hash: string;
    prompt_version: number;
    model: string;
    status: string;
    dropped: number;
    payload: string;
    updated_at: string;
  }>(
    `SELECT entry_id, block_index, block_hash, prompt_version, model, status, dropped,
            payload, updated_at
     FROM analysis_chunks ORDER BY entry_id, block_index`,
  );
  const entities = await db.getAllAsync<{
    id: string;
    kind: string;
    name: string;
    label: string;
    icon: string;
    created_at: string;
    updated_at: string;
  }>('SELECT id, kind, name, label, icon, created_at, updated_at FROM entities ORDER BY created_at');
  const aliases = await db.getAllAsync<{
    id: string;
    entity_id: string;
    kind: string;
    name: string;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT id, entity_id, kind, name, created_at, updated_at FROM entity_aliases ORDER BY created_at',
  );
  const links = await db.getAllAsync<{
    entry_id: string;
    entity_id: string;
    count: number;
    relation: string | null;
    sentiment: number | null;
    created_at: string;
  }>(
    `SELECT entry_id, entity_id, count, relation, sentiment, created_at
     FROM entry_entities ORDER BY entry_id, entity_id`,
  );
  const owners = await db.getAllAsync<{
    name: string;
    created_at: string;
    updated_at: string;
  }>('SELECT name, created_at, updated_at FROM owner_aliases ORDER BY name');
  const rejections = await db.getAllAsync<{
    kind: string;
    name: string;
    name_key: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT kind, name, name_key, created_at, updated_at
     FROM entity_rejections ORDER BY kind, name_key`,
  );
  const layouts = await db.getAllAsync<{ key: string; data: string; updated_at: string }>(
    'SELECT key, data, updated_at FROM graph_layout ORDER BY key',
  );
  const transcriptMarks = await db.getAllAsync<{ entry_id: string; source_at: string }>(
    'SELECT entry_id, source_at FROM transcript_sync ORDER BY entry_id',
  );
  const analysisMarks = await db.getAllAsync<{ entry_id: string; source_at: string }>(
    'SELECT entry_id, source_at FROM analysis_sync ORDER BY entry_id',
  );
  const transcriptMarksEnv = await db.getAllAsync<{
    server_id: string;
    entry_id: string;
    source_at: string;
  }>('SELECT server_id, entry_id, source_at FROM transcript_sync_env ORDER BY server_id, entry_id');
  const analysisMarksEnv = await db.getAllAsync<{
    server_id: string;
    entry_id: string;
    source_at: string;
  }>('SELECT server_id, entry_id, source_at FROM analysis_sync_env ORDER BY server_id, entry_id');

  const authorRow = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_flags WHERE key = ?',
    [AUTHOR_SETTINGS_KEY],
  );
  let author: BackupKnowledge['author'];
  if (authorRow) {
    try {
      const parsed = JSON.parse(authorRow.value) as {
        ownerName?: unknown;
        allNotesMine?: unknown;
      };
      author = {
        ownerName: typeof parsed.ownerName === 'string' ? parsed.ownerName : '',
        allNotesMine: parsed.allNotesMine !== false,
      };
    } catch {
      // Configuracao ilegivel: o backup segue sem ela; o servidor repoe.
    }
  }

  return {
    analyses: analyses.map((row) => ({
      entryId: row.entry_id,
      title: row.title,
      recordedAt: row.recorded_at,
      payload: row.payload,
      fetchedAt: row.fetched_at,
      origin: row.origin === 'local' ? 'local' : 'server',
      contentHash: row.analysis_content_hash ?? undefined,
    })),
    analysisChunks: chunks.map((row) => ({
      entryId: row.entry_id,
      blockIndex: row.block_index,
      blockHash: row.block_hash,
      promptVersion: row.prompt_version,
      model: row.model,
      status: row.status,
      dropped: row.dropped,
      payload: row.payload,
      updatedAt: row.updated_at,
    })),
    entities: entities.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      label: row.label ?? '',
      icon: row.icon ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? '',
    })),
    entityAliases: aliases.map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      kind: row.kind,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? '',
    })),
    entryEntities: links.map((row) => ({
      entryId: row.entry_id,
      entityId: row.entity_id,
      count: row.count,
      relation: row.relation ?? undefined,
      sentiment: typeof row.sentiment === 'number' ? row.sentiment : undefined,
      createdAt: row.created_at,
    })),
    ownerAliases: owners.map((row) => ({
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? '',
    })),
    entityRejections: rejections.map((row) => ({
      kind: row.kind,
      name: row.name,
      nameKey: row.name_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? '',
    })),
    graphLayout: layouts.map((row) => ({
      key: row.key,
      data: row.data,
      updatedAt: row.updated_at,
    })),
    transcriptSync: transcriptMarks.map((row) => ({
      entryId: row.entry_id,
      sourceAt: row.source_at,
    })),
    analysisSync: analysisMarks.map((row) => ({
      entryId: row.entry_id,
      sourceAt: row.source_at,
    })),
    transcriptSyncEnv: transcriptMarksEnv.map((row) => ({
      serverId: row.server_id,
      entryId: row.entry_id,
      sourceAt: row.source_at,
    })),
    analysisSyncEnv: analysisMarksEnv.map((row) => ({
      serverId: row.server_id,
      entryId: row.entry_id,
      sourceAt: row.source_at,
    })),
    author,
  };
}

/**
 * Grava o conhecimento restaurado. Nada sobrescreve o que ja existe no
 * aparelho (`INSERT OR IGNORE`): restaurar duas vezes, ou depois de uma analise
 * nova, nunca perde o trabalho mais recente.
 */
export async function importBackupKnowledge(
  knowledge: BackupKnowledge,
  dbArg?: Database,
): Promise<void> {
  const db = dbArg ?? (await getDb());
  await withGraphWrite(() =>
    db.withTransactionAsync(async () => {
      // Entidades antes dos vinculos: um alias/vínculo aponta para o id delas.
      for (const entity of knowledge.entities) {
        // O manifesto pode vir de qualquer pasta: tipo fora dos quatro
        // conhecidos e nome vazio nao entram (o mapa e a analise so trabalham
        // com `EntityKind` fechado).
        if (!isEntityKind(entity.kind)) continue;
        const name = entity.name.trim();
        if (!name) continue;
        await db.runAsync(
          `INSERT OR IGNORE INTO entities (id, kind, name, label, icon, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            entity.id,
            entity.kind,
            name,
            entity.label,
            entity.icon,
            entity.createdAt,
            entity.updatedAt,
          ],
        );
      }
      for (const alias of knowledge.entityAliases) {
        if (!isEntityKind(alias.kind)) continue;
        const name = alias.name.trim();
        if (!name) continue;
        await db.runAsync(
          `INSERT OR IGNORE INTO entity_aliases (id, entity_id, kind, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [alias.id, alias.entityId, alias.kind, name, alias.createdAt, alias.updatedAt],
        );
      }
      for (const link of knowledge.entryEntities) {
        await db.runAsync(
          `INSERT OR IGNORE INTO entry_entities
             (entry_id, entity_id, count, relation, sentiment, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            link.entryId,
            link.entityId,
            Math.max(1, link.count),
            link.relation ?? null,
            typeof link.sentiment === 'number' ? link.sentiment : null,
            link.createdAt,
          ],
        );
      }
      for (const owner of knowledge.ownerAliases) {
        const name = owner.name.trim();
        if (!name) continue;
        await db.runAsync(
          `INSERT OR IGNORE INTO owner_aliases (name, created_at, updated_at)
           VALUES (?, ?, ?)`,
          [name, owner.createdAt, owner.updatedAt],
        );
      }
      for (const rejection of knowledge.entityRejections) {
        if (!isEntityKind(rejection.kind)) continue;
        const name = rejection.name.trim();
        if (!name) continue;
        // A chave e derivada do nome, nunca aceita do manifesto: um name_key
        // arbitrario poderia bloquear entidades que o dono nunca recusou.
        await db.runAsync(
          `INSERT OR IGNORE INTO entity_rejections (kind, name, name_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            rejection.kind,
            name,
            entityNameKey(name),
            rejection.createdAt,
            rejection.updatedAt,
          ],
        );
      }
      for (const analysis of knowledge.analyses) {
        await db.runAsync(
          `INSERT OR IGNORE INTO analyses
             (entry_id, title, recorded_at, payload, fetched_at, origin, analysis_content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            analysis.entryId,
            analysis.title,
            analysis.recordedAt,
            analysis.payload,
            analysis.fetchedAt,
            analysis.origin,
            analysis.contentHash ?? null,
          ],
        );
      }
      for (const chunk of knowledge.analysisChunks) {
        await db.runAsync(
          `INSERT OR IGNORE INTO analysis_chunks
             (entry_id, block_index, block_hash, prompt_version, model, status, dropped, payload, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.entryId,
            chunk.blockIndex,
            chunk.blockHash,
            chunk.promptVersion,
            chunk.model,
            chunk.status,
            chunk.dropped,
            chunk.payload,
            chunk.updatedAt,
          ],
        );
      }
      for (const layout of knowledge.graphLayout) {
        await db.runAsync(
          `INSERT OR IGNORE INTO graph_layout (key, data, updated_at) VALUES (?, ?, ?)`,
          [layout.key, layout.data, layout.updatedAt],
        );
      }
      // Marcadores do que ja foi trocado: sem eles o primeiro sync acharia que
      // nunca viu transcricao/analise e baixaria tudo de novo.
      for (const mark of knowledge.transcriptSync) {
        await db.runAsync(
          `INSERT OR IGNORE INTO transcript_sync (entry_id, source_at) VALUES (?, ?)`,
          [mark.entryId, mark.sourceAt],
        );
      }
      for (const mark of knowledge.analysisSync) {
        await db.runAsync(
          `INSERT OR IGNORE INTO analysis_sync (entry_id, source_at) VALUES (?, ?)`,
          [mark.entryId, mark.sourceAt],
        );
      }
      for (const mark of knowledge.transcriptSyncEnv) {
        await db.runAsync(
          `INSERT OR IGNORE INTO transcript_sync_env (server_id, entry_id, source_at)
           VALUES (?, ?, ?)`,
          [mark.serverId, mark.entryId, mark.sourceAt],
        );
      }
      for (const mark of knowledge.analysisSyncEnv) {
        await db.runAsync(
          `INSERT OR IGNORE INTO analysis_sync_env (server_id, entry_id, source_at)
           VALUES (?, ?, ?)`,
          [mark.serverId, mark.entryId, mark.sourceAt],
        );
      }
      if (knowledge.author) {
        await db.runAsync(
          `INSERT OR IGNORE INTO app_flags (key, value) VALUES (?, ?)`,
          [AUTHOR_SETTINGS_KEY, JSON.stringify(knowledge.author)],
        );
      }
      // Os vinculos vieram do backup: o backfill nao deve rederivar por cima
      // (perderia relacao/sentimento editados a mao). Quando so ha analises, o
      // marcador fica como esta e o mapa deriva os vinculos sozinho.
      if (knowledge.entryEntities.length > 0) {
        await db.runAsync(
          `INSERT INTO app_flags (key, value) VALUES (?, 'true')
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [ENTITIES_BACKFILL_KEY],
        );
      }
      // Recorte antigo do mapa mostraria o estado de antes da restauracao.
      await db.runAsync("DELETE FROM app_flags WHERE key LIKE 'graph_snapshot:%'");
    }),
  );
}

/** Resolve um nome para o id canonico, seguindo alias e ignorando caixa. */
async function resolveEntityId(
  db: Database,
  kind: EntityKind,
  rawName: string,
  now: string,
): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const found = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM entities WHERE kind = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1',
    [kind, name],
  );
  if (found) return found.id;
  const alias = await db.getFirstAsync<{ entity_id: string }>(
    'SELECT entity_id FROM entity_aliases WHERE kind = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1',
    [kind, name],
  );
  if (alias) return alias.entity_id;
  const id = newId('ent_');
  await db.runAsync(
    `INSERT INTO entities (id, kind, name, icon, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?)`,
    [id, kind, name, now, now],
  );
  return id;
}

/** Substitui os vinculos de uma nota, como `SaveRichAnalysis` faz no servidor. */
async function replaceEntryEntities(
  db: Database,
  entryId: string,
  analysis: ServerAnalysis,
  now: string,
  owners: ReadonlySet<string>,
): Promise<void> {
  await db.runAsync('DELETE FROM entry_entities WHERE entry_id = ?', [entryId]);
  const rejected = await rejectedEntityKeys(db);
  for (const link of deriveEntityLinks(analysis, owners)) {
    // A rejeicao do dono e aplicada por script antes de persistir: o vinculo
    // nem chega ao banco. A camada de gramatica continua no `deriveEntityLinks`.
    if (rejected.has(rejectionLookupKey(link.kind, entityNameKey(link.name)))) continue;
    const entityId = await resolveEntityId(db, link.kind, link.name, now);
    if (!entityId) continue;
    await db.runAsync(
      `INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (entry_id, entity_id) DO UPDATE SET
         count = excluded.count,
         relation = excluded.relation,
         sentiment = excluded.sentiment`,
      [
        entryId,
        entityId,
        Math.max(1, link.count),
        link.relation?.trim() || null,
        typeof link.sentiment === 'number' ? link.sentiment : null,
        now,
      ],
    );
  }
}

/**
 * Deriva as entidades das analises guardadas antes da versao 30. Roda uma vez,
 * em lotes, no primeiro mapa aberto; nao atrasa o boot nem segura uma analise
 * nova por todo o backfill (cada lote e uma transacao).
 */
let backfillPromise: Promise<number> | null = null;

export function ensureEntityDerivation(force = false): Promise<number> {
  if (backfillPromise) return backfillPromise;
  backfillPromise = runEntityBackfill(force).finally(() => {
    backfillPromise = null;
  });
  return backfillPromise;
}

async function runEntityBackfill(force = false): Promise<number> {
  const db = await getDb();
  if (!force && (await getAppFlag(ENTITIES_BACKFILL_KEY)) === 'true') return 0;
  const owners = await ownerKeysFor(db);
  // Sem `force` continua de onde parou; com `force` refaz do comeco, que e o
  // caso do mapa vazio com analises guardadas (marcador antigo, vinculos nunca
  // gravados).
  let cursor = force ? 0 : Number(await getAppFlag(ENTITIES_CURSOR_KEY)) || 0;
  let processed = 0;
  for (;;) {
    const rows = await db.getAllAsync<{
      rowid: number;
      entry_id: string;
      payload: string;
      fetched_at: string;
    }>(
      'SELECT rowid, entry_id, payload, fetched_at FROM analyses WHERE rowid > ? ORDER BY rowid LIMIT 10',
      [cursor],
    );
    if (rows.length === 0) break;
    const parsed: { entryId: string; analysis: ServerAnalysis; at: string }[] = [];
    for (const row of rows) {
      try {
        parsed.push({
          entryId: row.entry_id,
          analysis: JSON.parse(row.payload) as ServerAnalysis,
          at: row.fetched_at,
        });
      } catch {
        // Payload invalido: a proxima analise da nota refaz os vinculos.
      }
    }
    await withGraphWrite(() =>
      db.withTransactionAsync(async () => {
        for (const item of parsed) {
          await replaceEntryEntities(db, item.entryId, item.analysis, item.at, owners);
        }
      }),
    );
    processed += parsed.length;
    cursor = rows[rows.length - 1].rowid;
    await withGraphWrite(async () => setAppFlag(ENTITIES_CURSOR_KEY, String(cursor)));
    // Devolve o controle ao JS entre lotes: o mapa ja esta aberto e precisa
    // continuar respondendo a pinca e ao arrasto enquanto o backfill roda.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await withGraphWrite(async () => setAppFlag(ENTITIES_BACKFILL_KEY, 'true'));
  return processed;
}

/** Reconstroi as relacoes de uma nota apos uma mudanca de alias/entidade. */
export async function refreshEntryEntities(entryId: string): Promise<void> {
  await withGraphWrite(async () => {
    const db = await getDb();
    const row = await db.getFirstAsync<{ payload: string; fetched_at: string }>(
      'SELECT payload, fetched_at FROM analyses WHERE entry_id = ?',
      [entryId],
    );
    if (!row) return;
    try {
      const analysis = JSON.parse(row.payload) as ServerAnalysis;
      const owners = await ownerKeysFor(db);
      await replaceEntryEntities(db, entryId, analysis, row.fetched_at, owners);
    } catch {
      // Payload invalido: a proxima analise refaz os vinculos.
    }
  });
}

interface LocalEntityRow {
  id: string;
  kind: string;
  name: string;
  label: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

function toLocalEntity(row: LocalEntityRow): GraphEntity {
  return {
    id: row.id,
    kind: row.kind as EntityKind,
    name: row.name,
    label: row.label ?? '',
    icon: row.icon ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

async function findEntityIdByName(
  db: Database,
  kind: EntityKind,
  rawName: string,
): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM entities WHERE kind = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1',
    [kind, name],
  );
  if (row) return row.id;
  const alias = await db.getFirstAsync<{ entity_id: string }>(
    'SELECT entity_id FROM entity_aliases WHERE kind = ? AND lower(name) = lower(?) ORDER BY created_at LIMIT 1',
    [kind, name],
  );
  return alias?.entity_id ?? null;
}

/** Entidade, vinculos, aliases e rejeicao anterior capturados para o desfazer. */
export interface LocalEntitySnapshot {
  entity: {
    id: string;
    kind: EntityKind;
    name: string;
    label: string;
    icon: string;
    created_at: string;
    updated_at: string;
  };
  links: {
    entry_id: string;
    count: number;
    relation: string | null;
    sentiment: number | null;
  }[];
  aliases: {
    id: string;
    kind: EntityKind;
    name: string;
    created_at: string;
    updated_at: string;
  }[];
  /** Rejeicao de (kind, name_key) que existia antes da operacao, se havia. */
  rejection: EntityRejection | null;
}

interface LocalEntitySnapshotRelationRow {
  entry_id: string;
  count: number;
  relation: string | null;
  sentiment: number | null;
}

interface LocalEntitySnapshotAliasRow {
  id: string;
  kind: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface LocalEntitySnapshotRejectionRow {
  kind: string;
  name: string;
  name_key: string;
  updated_at: string;
}

/**
 * Captura o estado de uma entidade para o "Desfazer" de 5 s.
 *
 * O snapshot vive **somente em memoria** na tela que fez a exclusao/troca de
 * tipo; nao e historico persistente e nao sincroniza. Para a troca de tipo com
 * mesclagem, capture tambem o snapshot da entidade de destino antes de mudar.
 */
export async function snapshotEntityForUndo(
  kind: EntityKind,
  name: string,
): Promise<LocalEntitySnapshot | null> {
  const trimmedName = name.trim();
  if (!isEntityKind(kind) || trimmedName === '') return null;
  const db = await getDb();
  const entityId = await findEntityIdByName(db, kind, trimmedName);
  if (!entityId) return null;
  const entity = await db.getFirstAsync<LocalEntityRow>(
    'SELECT id, kind, name, label, icon, created_at, updated_at FROM entities WHERE id = ?',
    [entityId],
  );
  if (!entity) return null;

  const links = await db.getAllAsync<LocalEntitySnapshotRelationRow>(
    'SELECT entry_id, count, relation, sentiment FROM entry_entities WHERE entity_id = ? ORDER BY entry_id',
    [entityId],
  );
  const aliases = await db.getAllAsync<LocalEntitySnapshotAliasRow>(
    'SELECT id, kind, name, created_at, updated_at FROM entity_aliases WHERE entity_id = ? ORDER BY created_at, name',
    [entityId],
  );
  const rejectionRow = await db.getFirstAsync<LocalEntitySnapshotRejectionRow>(
    'SELECT kind, name, name_key, updated_at FROM entity_rejections WHERE kind = ? AND name_key = ?',
    [entity.kind, entityNameKey(entity.name)],
  );

  return {
    entity: {
      id: entity.id,
      kind: entity.kind as EntityKind,
      name: entity.name,
      label: entity.label ?? '',
      icon: entity.icon ?? '',
      created_at: entity.created_at,
      updated_at: entity.updated_at,
    },
    links: links.map((link) => ({
      entry_id: link.entry_id,
      count: link.count,
      relation: link.relation,
      sentiment: link.sentiment,
    })),
    aliases: aliases.map((alias) => ({
      id: alias.id,
      kind: alias.kind as EntityKind,
      name: alias.name,
      created_at: alias.created_at,
      updated_at: alias.updated_at,
    })),
    rejection: rejectionRow
      ? {
          kind: rejectionRow.kind as EntityKind,
          name: rejectionRow.name,
          nameKey: rejectionRow.name_key,
          updatedAt: rejectionRow.updated_at,
        }
      : null,
  };
}

/**
 * Restaura um ou mais snapshots capturados por `snapshotEntityForUndo`.
 *
 * Serve para desfazer tanto a exclusao quanto a troca de tipo. Na troca com
 * mesclagem, passe os dois snapshots (origem e destino); o restore limpa os
 * ids/(kind, name) atuais que conflitam antes de reinserir entidades, aliases,
 * vinculos e a rejeicao anterior. O snapshot vive em memoria por 5 s; nao e um
 * historico persistente.
 */
export async function restoreEntitySnapshot(
  snapshot: LocalEntitySnapshot | readonly LocalEntitySnapshot[],
): Promise<void> {
  const snapshots = (
    Array.isArray(snapshot) ? snapshot : [snapshot]
  ) as readonly LocalEntitySnapshot[];
  if (snapshots.length === 0) return;
  await withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      // Junta os ids que precisam sair: o id do snapshot e qualquer entidade
      // atual que ocupe o mesmo (kind, name), inclusive com id diferente.
      const clearIds = new Set<string>();
      for (const item of snapshots) {
        clearIds.add(item.entity.id);
        const conflicts = await db.getAllAsync<{ id: string }>(
          'SELECT id FROM entities WHERE id = ? OR (kind = ? AND lower(name) = lower(?))',
          [item.entity.id, item.entity.kind, item.entity.name],
        );
        for (const row of conflicts) clearIds.add(row.id);
      }
      for (const id of clearIds) {
        await db.runAsync('DELETE FROM entry_entities WHERE entity_id = ?', [id]);
        await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ?', [id]);
        await db.runAsync('DELETE FROM entities WHERE id = ?', [id]);
      }

      // A exclusao/troca de tipo gravou uma rejeicao do tipo de origem. Ela sai
      // para a entidade poder voltar; a rejeicao anterior, se havia, volta no
      // fim. Cada snapshot cobre a sua propria chave.
      for (const item of snapshots) {
        await db.runAsync(
          'DELETE FROM entity_rejections WHERE kind = ? AND name_key = ?',
          [item.entity.kind, entityNameKey(item.entity.name)],
        );
      }

      for (const item of snapshots) {
        await db.runAsync(
          `INSERT INTO entities (id, kind, name, label, icon, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            item.entity.id,
            item.entity.kind,
            item.entity.name,
            item.entity.label,
            item.entity.icon,
            item.entity.created_at,
            item.entity.updated_at,
          ],
        );
      }

      for (const item of snapshots) {
        for (const alias of item.aliases) {
          // Nome de alias e unico por tipo (NOCASE): uma grafia tomada por
          // outra entidade depois da operacao precisa sair antes.
          await db.runAsync(
            'DELETE FROM entity_aliases WHERE id = ? OR (kind = ? AND lower(name) = lower(?))',
            [alias.id, alias.kind, alias.name],
          );
          await db.runAsync(
            `INSERT INTO entity_aliases (id, entity_id, kind, name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              alias.id,
              item.entity.id,
              alias.kind,
              alias.name,
              alias.created_at,
              alias.updated_at,
            ],
          );
        }
      }

      for (const item of snapshots) {
        for (const link of item.links) {
          await db.runAsync(
            `INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (entry_id, entity_id) DO UPDATE SET
               count = excluded.count,
               relation = excluded.relation,
               sentiment = excluded.sentiment`,
            [
              link.entry_id,
              item.entity.id,
              link.count,
              link.relation,
              link.sentiment,
              item.entity.updated_at || now,
            ],
          );
        }
      }

      for (const item of snapshots) {
        const rejection = item.rejection;
        if (!rejection) continue;
        await db.runAsync(
          `INSERT INTO entity_rejections (kind, name, name_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (kind, name_key) DO UPDATE SET
             name = excluded.name,
             updated_at = excluded.updated_at`,
          [
            rejection.kind,
            rejection.name,
            rejection.nameKey || entityNameKey(rejection.name),
            rejection.updatedAt || now,
            rejection.updatedAt || now,
          ],
        );
      }
    });
  });
}


async function addEntityAlias(
  db: Database,
  kind: EntityKind,
  name: string,
  entityId: string,
  now: string,
): Promise<void> {
  const alias = name.trim();
  if (!alias) return;
  await db.runAsync(
    `INSERT INTO entity_aliases (id, entity_id, kind, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, name) DO UPDATE SET entity_id = excluded.entity_id, updated_at = excluded.updated_at`,
    [newId('eal_'), entityId, kind, alias, now, now],
  );
}

async function enqueueEntityOp(
  db: Database,
  operation:
    | 'rename'
    | 'icon'
    | 'self'
    | 'label'
    | 'kind'
    | 'delete'
    | 'reject'
    | 'unreject',
  entity: { id: string; kind: EntityKind; name: string },
  now: string,
  extra: { nextName?: string; icon?: string; label?: string; nextKind?: EntityKind } = {},
): Promise<void> {
  await db.runAsync(
    `INSERT INTO entity_outbox
       (id, operation, entity_id, kind, name, next_name, icon, label, next_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('eop_'),
      operation,
      entity.id,
      entity.kind,
      entity.name,
      extra.nextName ?? null,
      extra.icon ?? null,
      extra.label ?? null,
      extra.nextKind ?? null,
      now,
    ],
  );
}

/** Move tudo de uma entidade para outra, como `mergeEntity` no servidor. */
async function mergeEntitiesInto(
  db: Database,
  sourceId: string,
  targetId: string,
  kind: EntityKind,
  sourceName: string,
  now: string,
  addSourceAlias = true,
): Promise<void> {
  const links = await db.getAllAsync<{
    entry_id: string;
    count: number;
    relation: string | null;
    sentiment: number | null;
  }>('SELECT entry_id, count, relation, sentiment FROM entry_entities WHERE entity_id = ?', [
    sourceId,
  ]);
  for (const link of links) {
    await db.runAsync(
      `INSERT INTO entry_entities (entry_id, entity_id, count, relation, sentiment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (entry_id, entity_id) DO UPDATE SET
         count = count + excluded.count,
         relation = COALESCE(entry_entities.relation, excluded.relation),
         sentiment = COALESCE(entry_entities.sentiment, excluded.sentiment)`,
      [link.entry_id, targetId, link.count, link.relation, link.sentiment, now],
    );
  }
  await db.runAsync('DELETE FROM entry_entities WHERE entity_id = ?', [sourceId]);
  const aliases = await db.getAllAsync<{ kind: string; name: string }>(
    'SELECT kind, name FROM entity_aliases WHERE entity_id = ?',
    [sourceId],
  );
  for (const alias of aliases) {
    await addEntityAlias(db, alias.kind as EntityKind, alias.name, targetId, now);
  }
  await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ?', [sourceId]);
  // O icone personalizado sobrevive quando o alvo ainda usa o do tipo.
  await db.runAsync(
    `UPDATE entities SET icon = (SELECT icon FROM entities WHERE id = ?)
     WHERE id = ? AND icon = '' AND (SELECT icon FROM entities WHERE id = ?) <> ''`,
    [sourceId, targetId, sourceId],
  );
  await db.runAsync('DELETE FROM entities WHERE id = ?', [sourceId]);
  await db.runAsync('UPDATE entities SET updated_at = ? WHERE id = ?', [now, targetId]);
  if (addSourceAlias) await addEntityAlias(db, kind, sourceName, targetId, now);
}

/**
 * Renomeia (ou mescla, quando o nome ja existe) uma entidade local. O nome
 * antigo vira alias, como no servidor. Devolve a entidade sobrevivente.
 */
export async function renameLocalEntity(
  kind: EntityKind,
  name: string,
  nextName: string,
): Promise<GraphEntity> {
  const trimmed = nextName.trim();
  if (!trimmed || trimmed.length > 200) throw new Error('nome inválido');
  return withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    let survivorId = '';
    await db.withTransactionAsync(async () => {
      const sourceId = await findEntityIdByName(db, kind, name);
      if (!sourceId) throw new Error('entidade não encontrada');
      const targetId = await findEntityIdByName(db, kind, trimmed);
      if (!targetId || targetId === sourceId) {
        await db.runAsync('UPDATE entities SET name = ?, updated_at = ? WHERE id = ?', [
          trimmed,
          now,
          sourceId,
        ]);
        if (name.trim().toLowerCase() !== trimmed.toLowerCase()) {
          await addEntityAlias(db, kind, name, sourceId, now);
        }
        survivorId = sourceId;
      } else {
        await mergeEntitiesInto(db, sourceId, targetId, kind, name, now);
        survivorId = targetId;
      }
      const row = await db.getFirstAsync<LocalEntityRow>(
        'SELECT id, kind, name, label, icon, created_at, updated_at FROM entities WHERE id = ?',
        [survivorId],
      );
      // O outbox guarda o nome que o servidor conhece (o antigo), nao o novo:
      // e por ele que o PATCH encontra a entidade no outro lado.
      if (row) {
        await enqueueEntityOp(
          db,
          'rename',
          { id: row.id, kind, name: name.trim() },
          now,
          { nextName: trimmed },
        );
      }
    });
    const row = await db.getFirstAsync<LocalEntityRow>(
      'SELECT id, kind, name, label, icon, created_at, updated_at FROM entities WHERE id = ?',
      [survivorId],
    );
    if (!row) throw new Error('entidade não encontrada');
    return toLocalEntity(row);
  });
}

/** Troca o icone monocromatico; vazio volta ao icone do tipo. */
export async function setLocalEntityIcon(
  kind: EntityKind,
  name: string,
  icon: string,
): Promise<GraphEntity> {
  return withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    const id = await findEntityIdByName(db, kind, name);
    if (!id) throw new Error('entidade não encontrada');
    await db.runAsync('UPDATE entities SET icon = ?, updated_at = ? WHERE id = ?', [icon, now, id]);
    const row = await db.getFirstAsync<LocalEntityRow>(
      'SELECT id, kind, name, label, icon, created_at, updated_at FROM entities WHERE id = ?',
      [id],
    );
    if (!row) throw new Error('entidade não encontrada');
    await enqueueEntityOp(db, 'icon', toLocalEntity(row), now, { icon });
    return toLocalEntity(row);
  });
}

async function readLocalEntity(db: Database, id: string): Promise<LocalEntityRow | null> {
  return db.getFirstAsync<LocalEntityRow>(
    'SELECT id, kind, name, label, icon, created_at, updated_at FROM entities WHERE id = ?',
    [id],
  );
}

/** Copia os aliases de uma entidade para o novo tipo e remove os do tipo antigo. */
async function moveEntityAliasesKindLocal(
  db: Database,
  entityId: string,
  oldKind: EntityKind,
  newKind: EntityKind,
  now: string,
): Promise<void> {
  const aliases = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM entity_aliases WHERE entity_id = ? AND kind = ? ORDER BY name',
    [entityId, oldKind],
  );
  for (const alias of aliases) {
    await db.runAsync(
      `INSERT OR IGNORE INTO entity_aliases (id, entity_id, kind, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId('eal_'), entityId, newKind, alias.name, now, now],
    );
  }
  await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ? AND kind = ?', [
    entityId,
    oldKind,
  ]);
}

/**
 * Move uma entidade local para outro tipo, como `ChangeEntityKind` no servidor:
 * se o tipo destino ja tem o mesmo nome, mescla os vinculos; senao troca o tipo
 * e leva os aliases. Devolve o id da sobrevivente.
 */
async function changeEntityKindLocal(
  db: Database,
  sourceId: string,
  fromKind: EntityKind,
  toKind: EntityKind,
  lookupName: string,
  canonicalName: string,
  now: string,
): Promise<string> {
  const targetId = await findEntityIdByName(db, toKind, lookupName);
  if (targetId && targetId !== sourceId) {
    await mergeEntitiesInto(db, sourceId, targetId, toKind, canonicalName, now, false);
    return targetId;
  }
  await db.runAsync('UPDATE entities SET kind = ?, updated_at = ? WHERE id = ?', [
    toKind,
    now,
    sourceId,
  ]);
  await moveEntityAliasesKindLocal(db, sourceId, fromKind, toKind, now);
  return sourceId;
}

/** Rotulo livre de exibicao; vazio limpa. Nao muda tipo, metrica nem sync. */
export async function setEntityLabel(
  kind: EntityKind,
  name: string,
  label: string,
): Promise<GraphEntity> {
  const trimmedName = name.trim();
  const trimmedLabel = label.trim();
  if (!isEntityKind(kind) || trimmedName === '' || Array.from(trimmedLabel).length > 80) {
    throw new Error('rotulo inválido');
  }
  return withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    let id = '';
    await db.withTransactionAsync(async () => {
      id = (await findEntityIdByName(db, kind, trimmedName)) ?? '';
      if (!id) throw new Error('entidade não encontrada');
      await db.runAsync('UPDATE entities SET label = ?, updated_at = ? WHERE id = ?', [
        trimmedLabel,
        now,
        id,
      ]);
      await enqueueEntityOp(db, 'label', { id, kind, name: trimmedName }, now, {
        label: trimmedLabel,
      });
    });
    const row = await readLocalEntity(db, id);
    if (!row) throw new Error('entidade não encontrada');
    return toLocalEntity(row);
  });
}

/**
 * Troca o tipo de uma entidade local. Move os vinculos, mescla se o tipo
 * destino ja tem o mesmo nome e grava a rejeicao do tipo antigo.
 */
export async function changeEntityKind(
  kind: EntityKind,
  name: string,
  newKind: EntityKind,
): Promise<GraphEntity> {
  const trimmedName = name.trim();
  if (!isEntityKind(kind) || !isEntityKind(newKind) || trimmedName === '' || kind === newKind) {
    throw new Error('tipo inválido');
  }
  return withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    let survivorId = '';
    await db.withTransactionAsync(async () => {
      const sourceId = await findEntityIdByName(db, kind, trimmedName);
      if (!sourceId) throw new Error('entidade não encontrada');
      const canonicalRow = await db.getFirstAsync<{ name: string }>(
        'SELECT name FROM entities WHERE id = ?',
        [sourceId],
      );
      const canonical = canonicalRow?.name ?? trimmedName;
      survivorId = await changeEntityKindLocal(
        db,
        sourceId,
        kind,
        newKind,
        trimmedName,
        canonical,
        now,
      );
      await upsertLocalEntityRejection(db, kind, canonical, now);
      await enqueueEntityOp(db, 'kind', { id: survivorId, kind, name: trimmedName }, now, {
        nextKind: newKind,
      });
    });
    const row = await readLocalEntity(db, survivorId);
    if (!row) throw new Error('entidade não encontrada');
    return toLocalEntity(row);
  });
}

/**
 * Exclui a entidade, os vinculos e os aliases e grava a rejeicao do tipo. O
 * desfazer restaura tudo no servidor; aqui a rejeicao impede a analise de
 * recriar o nome.
 */
export async function deleteEntityAndReject(
  kind: EntityKind,
  name: string,
): Promise<void> {
  const trimmedName = name.trim();
  if (!isEntityKind(kind) || trimmedName === '') throw new Error('entidade inválida');
  await withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      const id = await findEntityIdByName(db, kind, trimmedName);
      if (!id) throw new Error('entidade não encontrada');
      const canonicalRow = await db.getFirstAsync<{ name: string }>(
        'SELECT name FROM entities WHERE id = ?',
        [id],
      );
      const canonical = canonicalRow?.name ?? trimmedName;
      await db.runAsync('DELETE FROM entry_entities WHERE entity_id = ?', [id]);
      await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ?', [id]);
      await db.runAsync('DELETE FROM entities WHERE id = ?', [id]);
      await upsertLocalEntityRejection(db, kind, canonical, now);
      await enqueueEntityOp(db, 'delete', { id, kind, name: trimmedName }, now);
    });
  });
}

/** Diz que o nome nunca e entidade daquele tipo; aplicado antes de persistir. */
export async function addEntityRejection(
  kind: EntityKind,
  name: string,
): Promise<void> {
  const trimmedName = name.trim();
  if (!isEntityKind(kind) || trimmedName === '') throw new Error('rejeição inválida');
  await withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      await upsertLocalEntityRejection(db, kind, trimmedName, now);
      await enqueueEntityOp(
        db,
        'reject',
        { id: '', kind, name: trimmedName },
        now,
      );
    });
  });
}

/** Libera um nome rejeitado; remover uma rejeicao ausente e no-op. */
export async function removeEntityRejection(
  kind: EntityKind,
  name: string,
): Promise<void> {
  const trimmedName = name.trim();
  if (!isEntityKind(kind) || trimmedName === '') throw new Error('rejeição inválida');
  await withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM entity_rejections WHERE kind = ? AND name_key = ?', [
        kind,
        entityNameKey(trimmedName),
      ]);
      await enqueueEntityOp(
        db,
        'unreject',
        { id: '', kind, name: trimmedName },
        now,
      );
    });
  });
}

/**
 * "Sou eu": a pessoa duplicada some do mapa e todas as grafias dela passam a
 * resolver para o dono. O centro e a unica representacao do diarista.
 */
export async function claimLocalSelf(name: string): Promise<string> {
  const db = await getDb();
  const now = new Date().toISOString();
  let owner = '';
  let affected: string[] = [];
  await withGraphWrite(() =>
    db.withTransactionAsync(async () => {
      const id = await findEntityIdByName(db, 'person', name);
      if (!id) throw new Error('entidade não encontrada');
      // So as notas que mencionavam esta pessoa precisam ser redigeradas.
      const rows = await db.getAllAsync<{ entry_id: string }>(
        'SELECT DISTINCT entry_id FROM entry_entities WHERE entity_id = ?',
        [id],
      );
      affected = rows.map((row) => row.entry_id);
      const canonical = await db.getFirstAsync<{ name: string }>(
        'SELECT name FROM entities WHERE id = ?',
        [id],
      );
      const aliases = await db.getAllAsync<{ name: string }>(
        'SELECT name FROM entity_aliases WHERE entity_id = ?',
        [id],
      );
      const names = [canonical?.name ?? name, ...aliases.map((alias) => alias.name)].filter(Boolean);
      for (const alias of names) {
        await db.runAsync(
          `INSERT INTO owner_aliases (name, created_at, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET updated_at = excluded.updated_at`,
          [alias, now, now],
        );
      }
      const row = await db.getFirstAsync<LocalEntityRow>(
        'SELECT id, kind, name, label, icon, created_at, updated_at FROM entities WHERE id = ?',
        [id],
      );
      if (row) await enqueueEntityOp(db, 'self', toLocalEntity(row), now);
      await db.runAsync('DELETE FROM entry_entities WHERE entity_id = ?', [id]);
      await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ?', [id]);
      await db.runAsync('DELETE FROM entities WHERE id = ?', [id]);
      owner = (await readOwnerSettings(db)).ownerName.trim();
    }),
  );
  // Os nomes agora sao do dono: as analises antigas e as novas nao recriam a
  // pessoa, e o grafo precisa refletir isso sem esperar a proxima analise.
  for (const entryId of affected) await refreshEntryEntities(entryId);
  return owner || 'Você';
}

export interface EntityOutboxItem {
  id: string;
  operation:
    | 'rename'
    | 'icon'
    | 'self'
    | 'label'
    | 'kind'
    | 'delete'
    | 'reject'
    | 'unreject';
  entityId: string;
  kind: EntityKind;
  name: string;
  nextName?: string;
  icon?: string;
  label?: string;
  nextKind?: EntityKind;
  attempts: number;
  lastError?: string;
}

export async function listEntityOutbox(limit = 50): Promise<EntityOutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    operation: string;
    entity_id: string;
    kind: string;
    name: string;
    next_name: string | null;
    icon: string | null;
    label: string | null;
    next_kind: string | null;
    attempts: number;
    last_error: string | null;
  }>('SELECT * FROM entity_outbox ORDER BY created_at LIMIT ?', [limit]);
  return rows.map((row) => ({
    id: row.id,
    operation: row.operation as EntityOutboxItem['operation'],
    entityId: row.entity_id,
    kind: row.kind as EntityKind,
    name: row.name,
    nextName: row.next_name ?? undefined,
    icon: row.icon ?? undefined,
    label: row.label ?? undefined,
    nextKind: (row.next_kind as EntityKind | null) ?? undefined,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
  }));
}

export async function deleteEntityOutbox(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM entity_outbox WHERE id = ?', [id]);
}

export async function markEntityOutboxAttempt(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE entity_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?',
    [error.slice(0, 300), id],
  );
}

/** Layout guardado: reabrir o mapa nao refaz a conta para o mesmo conjunto. */
export async function loadGraphLayout(key: string): Promise<GraphLayout | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM graph_layout WHERE key = ?',
    [key],
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.data) as GraphLayout;
    if (!parsed.positions || !parsed.bounds || parsed.key !== key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveGraphLayout(layout: GraphLayout): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO graph_layout (key, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [layout.key, JSON.stringify(layout), new Date().toISOString()],
  );
  await db.runAsync(
    `DELETE FROM graph_layout WHERE key NOT IN (
       SELECT key FROM graph_layout ORDER BY updated_at DESC LIMIT 12
     )`,
  );
}

/** Estado de uma entidade vindo de `GET /api/v1/entities`. */
export interface RemoteEntityState {
  id: string;
  kind: EntityKind;
  name: string;
  label: string;
  icon: string;
  updatedAt: string;
  aliases: string[];
}

function entityKey(kind: string, name: string): string {
  return `${kind}\u0000${entityNameKey(name)}`;
}

/**
 * Escrita que o aparelho tem e aquele ambiente ainda nao: nome, icone ou
 * rotulo novos. Quem chama empurra com o endpoint daquele ambiente, usando o
 * nome que ele conhece como chave.
 */
export interface EntityPush {
  kind: EntityKind;
  /** Nome que o ambiente conhece; e a chave do PATCH. */
  name: string;
  /** Nome que deve ficar; ausente quando so o icone ou o rotulo muda. */
  renameTo?: string;
  /** Icone que deve ficar; ausente quando so o nome ou o rotulo muda. */
  icon?: string;
  /** Rotulo que deve ficar; ausente quando so o nome ou o icone muda. */
  label?: string;
}

/** Chaves de rejeicao com operacao pendente na outbox, para o LWW local. */
async function pendingRejectionKeys(db: Database): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ kind: string; name: string }>(
    "SELECT kind, name FROM entity_outbox WHERE operation IN ('reject', 'unreject')",
  );
  return new Set(rows.map((row) => rejectionLookupKey(row.kind, entityNameKey(row.name))));
}

/**
 * Aplica o catalogo do servidor no banco local.
 *
 * O nome e a chave de encontro: a entidade local que tem o nome antigo e
 * fundida na sobrevivente do servidor, e os aliases remotos passam a resolver
 * as analises futuras. Entidades com operacao pendente na outbox ficam
 * intocadas: a escrita local ainda vai subir. A rejeicao remota vence por
 * `updated_at` e propaga a exclusao e a troca de tipo.
 */
export async function applyRemoteEntities(
  remote: RemoteEntityState[],
  pendingEntityIds: ReadonlySet<string> = new Set(),
  remoteRejections: readonly EntityRejection[] = [],
): Promise<EntityPush[]> {
  if (remote.length === 0 && remoteRejections.length === 0) return [];
  const pushes: EntityPush[] = [];
  await withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      const locals = await db.getAllAsync<LocalEntityRow>(
        'SELECT id, kind, name, label, icon, created_at, updated_at FROM entities',
      );
      const localById = new Map(locals.map((row) => [row.id, row]));
      const localByName = new Map(locals.map((row) => [entityKey(row.kind, row.name), row]));
      const matched = new Set<string>();
      const localIdForRemote = new Map<string, string>();
      const targetByAlias = new Map<string, RemoteEntityState>();
      const remoteByName = new Map<string, RemoteEntityState[]>();

      for (const item of remote) {
        for (const alias of item.aliases) targetByAlias.set(entityKey(item.kind, alias), item);
        const key = entityNameKey(item.name);
        const list = remoteByName.get(key);
        if (list) list.push(item);
        else remoteByName.set(key, [item]);
      }

      // Rejeicoes primeiro: elas decidem se a entidade local que o catalogo nao
      // lista foi excluida ou trocou de tipo naquele ambiente.
      const pendingKeys = await pendingRejectionKeys(db);
      const localRejections = await db.getAllAsync<{
        kind: string;
        name: string;
        name_key: string;
        updated_at: string;
      }>('SELECT kind, name, name_key, updated_at FROM entity_rejections');
      const localRejectionByKey = new Map(
        localRejections.map((row) => [
          rejectionLookupKey(row.kind, row.name_key),
          row,
        ]),
      );
      const winningRejections = new Map<string, EntityRejection>();
      for (const rejection of remoteRejections) {
        const nameKey = rejection.nameKey || entityNameKey(rejection.name);
        const key = rejectionLookupKey(rejection.kind, nameKey);
        if (pendingKeys.has(key)) continue;
        const local = localRejectionByKey.get(key);
        // A escrita mais nova vence; o relogio local so perde quando o remoto
        // e de fato mais novo.
        if (local && newerThan(local.updated_at, rejection.updatedAt)) continue;
        await upsertLocalEntityRejection(
          db,
          rejection.kind,
          rejection.name,
          now,
          rejection.updatedAt || now,
        );
        winningRejections.set(key, rejection);
      }

      for (const item of remote) {
        const kind = item.kind;
        // Nome primeiro: se o servidor mesclou duas entidades, a sobrevivente
        // pode ter o nome que aqui ainda e de outra bola. Casar pelo nome evita
        // violar o unico (kind, name) ao renomear.
        let local = localByName.get(entityKey(kind, item.name)) ?? localById.get(item.id);
        if (!local) {
          for (const alias of item.aliases) {
            const hit = localByName.get(entityKey(kind, alias));
            if (hit) {
              local = hit;
              break;
            }
          }
        }
        if (!local) {
          const hit = await db.getFirstAsync<{ entity_id: string }>(
            'SELECT entity_id FROM entity_aliases WHERE kind = ? AND lower(name) = lower(?) LIMIT 1',
            [kind, item.name],
          );
          if (hit) local = localById.get(hit.entity_id);
        }

        if (local && pendingEntityIds.has(local.id)) {
          matched.add(local.id);
          localIdForRemote.set(item.id, local.id);
          continue;
        }

        // A ultima edicao vence tambem aqui: se o aparelho renomeou (ou trocou o
        // icone/rotulo) depois da ultima mudanca naquele ambiente, o catalogo de
        // la nao desfaz a escolha. Ela e empurrada de volta com o nome que o
        // ambiente conhece.
        if (local && newerThan(local.updated_at, item.updatedAt)) {
          const sameName = entityNameKey(local.name) === entityNameKey(item.name);
          if (!sameName) {
            pushes.push({ kind, name: item.name, renameTo: local.name });
          }
          if (local.icon !== item.icon) {
            pushes.push({ kind, name: item.name, icon: local.icon });
          }
          if ((local.label ?? '') !== (item.label ?? '')) {
            pushes.push({ kind, name: item.name, label: local.label ?? '' });
          }
          matched.add(local.id);
          localIdForRemote.set(item.id, local.id);
          continue;
        }

        const updatedAt = item.updatedAt || now;
        const previousName = local?.name;
        if (local && local.kind !== kind) {
          // O tipo mudou naquele ambiente: leva os vinculos ou mescla na
          // entidade que ja existia no destino.
          const conflict = localByName.get(entityKey(kind, item.name));
          if (conflict && conflict.id !== local.id) {
            await mergeEntitiesInto(db, local.id, conflict.id, kind, local.name, now, false);
            local = conflict;
          } else {
            await changeEntityKindLocal(
              db,
              local.id,
              local.kind as EntityKind,
              kind,
              item.name,
              local.name,
              now,
            );
          }
        }
        if (!local) {
          await db.runAsync(
            `INSERT INTO entities (id, kind, name, label, icon, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               kind = excluded.kind, name = excluded.name, label = excluded.label,
               icon = excluded.icon, updated_at = excluded.updated_at`,
            [item.id, kind, item.name, item.label, item.icon, updatedAt, updatedAt],
          );
          local = {
            id: item.id,
            kind,
            name: item.name,
            label: item.label,
            icon: item.icon,
            created_at: updatedAt,
            updated_at: updatedAt,
          };
        } else {
          await db.runAsync(
            'UPDATE entities SET kind = ?, name = ?, label = ?, icon = ?, updated_at = ? WHERE id = ?',
            [kind, item.name, item.label, item.icon, updatedAt, local.id],
          );
        }

        // Aliases remotos substituem os locais desta entidade: o servidor e a
        // lista completa de grafias que ainda resolvem para ela. O nome
        // anterior do aparelho fica, para uma renomeacao local nao perder a
        // grafia.
        await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ?', [local.id]);
        for (const alias of item.aliases) {
          await addEntityAlias(db, kind, alias, local.id, now);
        }
        if (previousName && entityNameKey(previousName) !== entityNameKey(item.name)) {
          await addEntityAlias(db, kind, previousName, local.id, now);
        }
        matched.add(local.id);
        localIdForRemote.set(item.id, local.id);
      }

      for (const local of locals) {
        if (matched.has(local.id)) continue;
        if (pendingEntityIds.has(local.id)) continue;

        // Entidade local que o servidor nao lista, mas cujo nome virou alias de
        // outra: foi mesclada no painel. Funde aqui tambem.
        const target = targetByAlias.get(entityKey(local.kind, local.name));
        if (target) {
          const targetLocalId = localIdForRemote.get(target.id);
          if (targetLocalId && targetLocalId !== local.id) {
            await mergeEntitiesInto(
              db,
              local.id,
              targetLocalId,
              local.kind as EntityKind,
              local.name,
              now,
            );
            matched.add(local.id);
            continue;
          }
        }

        // Rejeicao remota vencendo para este (kind, nome): ou o tipo mudou no
        // outro ambiente (ha uma entidade de mesmo nome em outro tipo) ou a
        // entidade foi excluida la. Nos dois casos a local nao fica.
        const rejection = winningRejections.get(
          rejectionLookupKey(local.kind, entityNameKey(local.name)),
        );
        if (!rejection) continue;
        const moved = (remoteByName.get(entityNameKey(local.name)) ?? []).find(
          (item) => item.kind !== local.kind,
        );
        const movedLocalId = moved ? localIdForRemote.get(moved.id) : undefined;
        if (moved && movedLocalId && movedLocalId !== local.id) {
          await mergeEntitiesInto(
            db,
            local.id,
            movedLocalId,
            moved.kind,
            local.name,
            now,
            false,
          );
          matched.add(local.id);
          continue;
        }
        await db.runAsync('DELETE FROM entry_entities WHERE entity_id = ?', [local.id]);
        await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ?', [local.id]);
        await db.runAsync('DELETE FROM entities WHERE id = ?', [local.id]);
        matched.add(local.id);
      }
    });
  });
  return pushes;
}

/** `a` e um horario posterior a `b`? Vazio ou ilegivel nao vence. */
function newerThan(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = Date.parse(a ?? '');
  const right = Date.parse(b ?? '');
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return left > right;
}

/** Grava as grafias "sou eu" do servidor e remove a pessoa duplicada local. */
export async function applyRemoteOwnerAliases(names: string[]): Promise<void> {
  if (names.length === 0) return;
  await withGraphWrite(async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      for (const name of names) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        await db.runAsync(
          `INSERT INTO owner_aliases (name, created_at, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET updated_at = excluded.updated_at`,
          [trimmed, now, now],
        );
        const person = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM entities WHERE kind = ? AND lower(name) = lower(?) LIMIT 1',
          ['person', trimmed],
        );
        if (!person) continue;
        await db.runAsync('DELETE FROM entry_entities WHERE entity_id = ?', [person.id]);
        await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ?', [person.id]);
        await db.runAsync('DELETE FROM entities WHERE id = ?', [person.id]);
      }
    });
  });
}

export interface EntityPanelRow {
  /** `recordings.id` (chave local). */
  id: string;
  text?: string;
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
  reading?: string;
  summary?: string;
}

/**
 * Detalhe das notas + leitura da analise em UMA consulta.
 *
 * A analise local (`a`) vive sob `recordings.id` e a do servidor (`b`) sob o
 * `entry_id`; a local vence e a do servidor cobre quando ela esta vazia. Chunks
 * de 100 mantem o `IN` curto, como em `loadGraphEntryDetails`.
 */
export async function loadEntityPanelRows(
  ids: string[],
): Promise<Record<string, EntityPanelRow>> {
  const localIds = [...new Set(ids.filter(Boolean))];
  if (localIds.length === 0) return {};
  const db = await getDbForUI();
  const out: Record<string, EntityPanelRow> = {};
  for (let offset = 0; offset < localIds.length; offset += 100) {
    const chunk = localIds.slice(offset, offset + 100);
    const rows = await db.getAllAsync<{
      id: string;
      text: string | null;
      transcript: string | null;
      transcript_segments: string | null;
      reading: string | null;
      summary: string | null;
      remote_reading: string | null;
      remote_summary: string | null;
    }>(
      `SELECT r.id,
         r.text,
         r.transcript,
         r.transcript_segments,
         CASE WHEN json_valid(a.payload) THEN json_extract(a.payload, '$.reading') END AS reading,
         CASE WHEN json_valid(a.payload) THEN json_extract(a.payload, '$.summary') END AS summary,
         CASE WHEN json_valid(b.payload) THEN json_extract(b.payload, '$.reading') END AS remote_reading,
         CASE WHEN json_valid(b.payload) THEN json_extract(b.payload, '$.summary') END AS remote_summary
       FROM recordings r
       LEFT JOIN analyses a ON a.entry_id = r.id
       LEFT JOIN analyses b ON b.entry_id = r.entry_id AND b.entry_id <> r.id
       WHERE r.id IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const row of rows) {
      const reading = (row.reading ?? '').trim() || (row.remote_reading ?? '').trim();
      const summary = (row.summary ?? '').trim() || (row.remote_summary ?? '').trim();
      out[row.id] = {
        id: row.id,
        text: row.text ?? undefined,
        transcript: row.transcript ?? undefined,
        transcriptSegments: parseSegments(row.transcript_segments),
        reading: reading || undefined,
        summary: summary || undefined,
      };
    }
  }
  return out;
}

