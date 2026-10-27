/**
 * Persistencia local das gravacoes em SQLite (expo-sqlite). E a fonte da
 * verdade da fila: sobrevive a restart do app e a reboot do aparelho.
 */

import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { ServerAnalysis, ServerAudio } from '@/core/api';
import type { AnalysisOutcome, AnalysisRun, AnalysisRuntime } from '@/core/analysisRuns';
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

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

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
  created_at: string;
  updated_at: string;
}

type MigrationDb = Pick<
  SQLite.SQLiteDatabase,
  'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync'
>;

interface Migration {
  version: number;
  run: (db: MigrationDb) => Promise<void>;
}

async function columnExists(db: MigrationDb, table: string, column: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

async function addColumn(db: MigrationDb, table: string, column: string): Promise<void> {
  if (await columnExists(db, table, column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
}

// Migracoes versionadas (PRAGMA user_version). Append-only: nunca edite uma
// migracao ja publicada; adicione uma nova.
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    run: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS recordings (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          dir TEXT NOT NULL,
          file_path TEXT,
          segment_count INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER,
          size_bytes INTEGER,
          status TEXT NOT NULL,
          upload_id TEXT,
          offset INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          last_error TEXT,
          entry_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
      `);
    },
  },
  {
    version: 2,
    run: async (db) => {
      for (const column of ['transcript', 'transcript_language', 'transcript_status']) {
        await addColumn(db, 'recordings', column);
      }
    },
  },
  {
    version: 3,
    run: async (db) => {
      for (const column of ['source', 'text', 'content_type', 'file_name', 'duplicate', 'archived']) {
        await addColumn(db, 'recordings', column);
      }
    },
  },
  {
    version: 4,
    run: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS locks (
          name TEXT PRIMARY KEY NOT NULL,
          holder TEXT NOT NULL,
          acquired_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 5,
    run: async (db) => {
      // Id da nota (corpo rico) no servidor: permite atualizar em vez de recriar.
      await addColumn(db, 'recordings', 'note_id');
    },
  },
  {
    version: 6,
    run: async (db) => {
      // Segmentos da transcricao em cache local (evita refazer fetch ao abrir).
      await addColumn(db, 'recordings', 'transcript_segments');
    },
  },
  {
    version: 7,
    run: async (db) => {
      // Falha permanente (4xx): nao retenta sozinha, so com reenvio manual.
      await addColumn(db, 'recordings', 'terminal');
    },
  },
  {
    version: 8,
    run: async (db) => {
      // Edicao local pendente numa nota ja enviada e mapa de anexos ja subidos
      // (o mapa evita reenviar a mesma imagem a cada edicao da nota).
      await addColumn(db, 'recordings', 'note_dirty');
      await addColumn(db, 'recordings', 'attachments');
    },
  },
  {
    version: 9,
    run: async (db) => {
      // Transcricao: flag "ha transcricao" e a origem (local no aparelho ou
      // recebida do servidor). Quem transcreve primeiro informa o outro.
      await addColumn(db, 'recordings', 'has_transcript');
      await addColumn(db, 'recordings', 'transcript_origin');
    },
  },
  {
    version: 10,
    run: async (db) => {
      // Ultimo snapshot das metricas de escrita: fica sempre pronto no aparelho
      // (o painel le daqui) e sincroniza com o servidor quando existe.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS metrics_snapshot (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          synced_at TEXT
        );
      `);
    },
  },
  {
    version: 11,
    run: async (db) => {
      // Versao lida de cada campo da nota no servidor. Sem isso o app so sabe
      // escrever por cima; com isso, o servidor avisa quando o texto mudou no
      // desktop e o usuario escolhe em vez de perder trabalho.
      await addColumn(db, 'recordings', 'title_version');
      await addColumn(db, 'recordings', 'recorded_at_version');
      await addColumn(db, 'recordings', 'body_version');
      // Campos que o servidor recusou (409), esperando a escolha do usuario.
      await addColumn(db, 'recordings', 'sync_conflict');
    },
  },
  {
    version: 12,
    run: async (db) => {
      // Analises (insights) ja feitas no servidor: guardadas no aparelho para o
      // painel mostrar sem refazer a analise e sem depender da rede.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS analyses (
          entry_id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          recorded_at TEXT NOT NULL DEFAULT '',
          payload TEXT NOT NULL,
          fetched_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 13,
    run: async (db) => {
      // Pilha de audios do servidor (JSON): abrir a nota mostra a ultima copia
      // enquanto a rede revalida em segundo plano, em vez de comecar vazia.
      await addColumn(db, 'recordings', 'server_audios');
    },
  },
  {
    version: 14,
    run: async (db) => {
      // Ate onde a transcricao local chegou (ms). Permite retomar de onde parou
      // depois de fechar o app, em vez de recomecar do zero.
      await addColumn(db, 'recordings', 'transcript_checkpoint_ms');
    },
  },
  {
    version: 15,
    run: async (db) => {
      // Id do audio no servidor. A transcricao local precisa dele para ser
      // exibida junto do audio certo no dashboard.
      await addColumn(db, 'recordings', 'server_attachment_id');
    },
  },
  {
    version: 16,
    run: async (db) => {
      // Analise feita no aparelho vence a do servidor (first-wins): a origem
      // evita que a leitura de fundo sobrescreva o resultado local.
      await addColumn(db, 'analyses', 'origin');
    },
  },
  {
    version: 17,
    run: async (db) => {
      // Hash do conteudo analisado: a ficha sabe quando a analise guardada e
      // de uma versao anterior da nota.
      await addColumn(db, 'analyses', 'analysis_content_hash');
    },
  },
  {
    version: 18,
    run: async (db) => {
      // Uma linha por tentativa de analise local. Diagnostico apenas: medidas e
      // resultado, nunca o texto da nota. Append-only.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS analysis_runs (
          id TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT NOT NULL,
          analysis_id TEXT,
          attachment_id TEXT,
          runtime TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 1,
          outcome TEXT NOT NULL,
          error_class TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          input_text_chars INTEGER NOT NULL DEFAULT 0,
          input_transcript_chars INTEGER NOT NULL DEFAULT 0,
          input_images INTEGER NOT NULL DEFAULT 0,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          tokens_per_second REAL NOT NULL DEFAULT 0,
          threads INTEGER,
          battery_delta_pct REAL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_analysis_runs_started ON analysis_runs(started_at);
        CREATE INDEX IF NOT EXISTS idx_analysis_runs_model ON analysis_runs(runtime, provider, model);
      `);
    },
  },
  {
    version: 19,
    run: async (db) => {
      // Cadernos locais: espelho do servidor + linhas criadas/alteradas offline
      // (`dirty`/`synced`) e tombstones (`deleted`) ate o push confirmar.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS notebooks (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '',
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          dirty INTEGER NOT NULL DEFAULT 0,
          synced INTEGER NOT NULL DEFAULT 1,
          deleted INTEGER NOT NULL DEFAULT 0
        );
      `);
      const stamp = new Date().toISOString();
      await db.runAsync(
        `INSERT OR IGNORE INTO notebooks
          (id, name, color, is_default, created_at, updated_at, dirty, synced, deleted)
         VALUES (?, ?, '', 1, ?, ?, 0, 1, 0)`,
        ['notas-ao-acaso', 'Notas ao acaso', stamp, stamp],
      );
      if (!(await columnExists(db, 'recordings', 'notebook_id'))) {
        await db.execAsync(
          "ALTER TABLE recordings ADD COLUMN notebook_id TEXT NOT NULL DEFAULT 'notas-ao-acaso'",
        );
      }
      await addColumn(db, 'recordings', 'tags');
      await addColumn(db, 'recordings', 'notebook_dirty');
      await addColumn(db, 'recordings', 'tags_dirty');
    },
  },
  {
    version: 20,
    run: async (db) => {
      // Arquivamento pendente. Sem este flag, o sync mandava `archived: false`
      // em toda gravacao e desfazia um arquivamento feito no dashboard antes do
      // pull; o pull tambem podia reverter o que o usuario acabou de arquivar.
      await addColumn(db, 'recordings', 'archived_dirty');
    },
  },
  {
    version: 21,
    run: async (db) => {
      // Revisao da transcricao por IA: modelo, versao do prompt, modo literal e
      // a estimativa de compreensao. Os textos por trecho vivem no JSON de
      // transcript_segments (`revised`), ao lado do original do whisper.
      await addColumn(db, 'recordings', 'transcript_review');
    },
  },
];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    // O SQLite web nao suporta transacao exclusiva; a comum serve para migrar e
    // tambem mantem o banco consistente se algo falhar.
    if (Platform.OS === 'web') {
      await db.withTransactionAsync(async () => {
        await migration.run(db);
        await db.execAsync(`PRAGMA user_version = ${migration.version}`);
      });
    } else {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await migration.run(txn);
        await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
      });
    }
    version = migration.version;
  }
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  return getDb();
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('dyarium.db').then(async (db) => {
      // O SQLite web (wasm) nao implementa WAL; no aparelho ele e essencial.
      if (Platform.OS !== 'web') await db.execAsync('PRAGMA journal_mode = WAL;');
      // Espera a trava liberar em vez de falhar na hora: em desenvolvimento um
      // reload pode deixar a conexao anterior presa por um instante, o que
      // antes virava "database is locked" ao iniciar a gravacao.
      await db.execAsync('PRAGMA busy_timeout = 5000;');
      await migrate(db);
      return db;
    });
  }
  return dbPromise;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
  const db = await getDb();
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
      title_version, recorded_at_version, body_version, sync_conflict, server_audios, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      updated_at = excluded.updated_at`,
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
      r.createdAt,
      r.updatedAt,
    ],
  );
}

export async function listRecordings(): Promise<Recording[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT * FROM recordings ORDER BY created_at DESC');
  return rows.map(rowToRecording);
}

export async function getRecording(id: string): Promise<Recording | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM recordings WHERE id = ?', [id]);
  return row ? rowToRecording(row) : null;
}

/** Cache da pilha de audios do servidor para uma entrada (JSON por linha). */
export async function saveServerAudios(entryId: string, audios: ServerAudio[]): Promise<void> {
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
  const db = await getDb();
  const hasTitle = patch.title !== undefined ? 1 : 0;
  const hasText = patch.text !== undefined ? 1 : 0;
  const title = patch.title ?? '';
  const text = patch.text ?? '';
  await db.runAsync(
    `UPDATE recordings
     SET title = CASE WHEN ? THEN ? ELSE title END,
         text = CASE WHEN ? THEN ? ELSE text END,
         note_dirty = CASE WHEN status = 'completed' THEN 1 ELSE note_dirty END,
         updated_at = ?
     WHERE id = ? AND (
       (? = 1 AND title <> ?) OR (? = 1 AND COALESCE(text, '') <> ?)
     )`,
    [
      hasTitle,
      title,
      hasText,
      text,
      new Date().toISOString(),
      id,
      hasTitle,
      title,
      hasText,
      text,
    ],
  );
}

export async function deleteRecordingRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM recordings WHERE id = ?', [id]);
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
  // Sem transacao exclusiva: a analise local nao pode esperar a fila de
  // background. Cada upsert e atomico e idempotente por si.
  for (const item of items) {
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
        JSON.stringify(item.analysis),
        fetchedAt,
        item.origin ?? 'server',
        item.contentHash ?? null,
      ],
    );
  }
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
  await db.runAsync(
    `DELETE FROM analyses WHERE entry_id = ? AND origin IS NOT 'local'`,
    [entryId],
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

/**
 * Move a analise de uma chave temporaria (id local da nota, antes do upload)
 * para a chave definitiva (entry id do servidor). A origem local vence; se a
 * chave de destino ja tem uma analise local, ela e mantida.
 */
export async function moveCachedAnalysis(fromKey: string, toKey: string): Promise<void> {
  if (fromKey === toKey) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
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
      return;
    }
    await db.runAsync('DELETE FROM analyses WHERE entry_id = ?', [toKey]);
    await db.runAsync('UPDATE analyses SET entry_id = ? WHERE entry_id = ?', [toKey, fromKey]);
  });
}

/**
 * Tamanho do banco local (arquivo principal + WAL/SHM, quando existirem).
 * Cai para as paginas do SQLite se o caminho do arquivo nao for encontrado.
 */
export async function databaseBytes(): Promise<number> {
  try {
    const dir = new Directory(Paths.document, 'SQLite');
    if (dir.exists) {
      let total = 0;
      for (const name of ['dyarium.db', 'dyarium.db-wal', 'dyarium.db-shm']) {
        const file = new File(dir, name);
        if (file.exists) total += file.size;
      }
      if (total > 0) return total;
    }
  } catch {
    // cai para a leitura pelas paginas do SQLite
  }

  const db = await getDb();
  const pageCount = await db.getFirstAsync<{ page_count: number }>('PRAGMA page_count');
  const pageSize = await db.getFirstAsync<{ page_size: number }>('PRAGMA page_size');
  return (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0);
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
