/**
 * Persistencia local das gravacoes em SQLite (expo-sqlite). E a fonte da
 * verdade da fila: sobrevive a restart do app e a reboot do aparelho.
 */

import * as SQLite from 'expo-sqlite';

import type {
  Recording,
  RecordingSource,
  RecordingStatus,
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
  transcript: string | null;
  transcript_language: string | null;
  transcript_status: string | null;
  transcript_segments: string | null;
  source: string | null;
  text: string | null;
  content_type: string | null;
  file_name: string | null;
  duplicate: number | null;
  archived: number | null;
  note_dirty: string | null;
  attachments: string | null;
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
];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    await db.withExclusiveTransactionAsync(async (txn) => {
      await migration.run(txn);
      await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('dyarium.db').then(async (db) => {
      await db.execAsync('PRAGMA journal_mode = WAL;');
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

function rowToRecording(row: Row): Recording {
  return {
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
    transcript: row.transcript ?? undefined,
    transcriptLanguage: row.transcript_language ?? undefined,
    transcriptStatus: (row.transcript_status as TranscriptStatus | null) ?? undefined,
    transcriptSegments: parseSegments(row.transcript_segments),
    source: (row.source as RecordingSource | null) ?? undefined,
    text: row.text ?? undefined,
    contentType: row.content_type ?? undefined,
    fileName: row.file_name ?? undefined,
    duplicate: row.duplicate ? true : undefined,
    archived: row.archived ? true : undefined,
    noteDirty: row.note_dirty ? true : undefined,
    attachments: parseAttachments(row.attachments),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertRecording(r: Recording): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO recordings (
      id, title, recorded_at, dir, file_path, segment_count, duration_ms, size_bytes,
      status, upload_id, offset, attempts, next_attempt_at, last_error, terminal, entry_id, note_id,
      transcript, transcript_language, transcript_status, transcript_segments,
      source, text, content_type, file_name, duplicate, archived, note_dirty, attachments,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      transcript = excluded.transcript,
      transcript_language = excluded.transcript_language,
      transcript_status = excluded.transcript_status,
      transcript_segments = excluded.transcript_segments,
      source = excluded.source,
      text = excluded.text,
      content_type = excluded.content_type,
      file_name = excluded.file_name,
      duplicate = excluded.duplicate,
      archived = excluded.archived,
      note_dirty = excluded.note_dirty,
      attachments = excluded.attachments,
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
      r.transcript ?? null,
      r.transcriptLanguage ?? null,
      r.transcriptStatus ?? null,
      r.transcriptSegments ? JSON.stringify(r.transcriptSegments) : null,
      r.source ?? null,
      r.text ?? null,
      r.contentType ?? null,
      r.fileName ?? null,
      r.duplicate ? 1 : null,
      r.archived ? 1 : null,
      r.noteDirty ? 1 : null,
      r.attachments ? JSON.stringify(r.attachments) : null,
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

export async function deleteRecordingRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM recordings WHERE id = ?', [id]);
}
