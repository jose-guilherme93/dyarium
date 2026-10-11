/**
 * Persistencia local das gravacoes em SQLite (expo-sqlite). E a fonte da
 * verdade da fila: sobrevive a restart do app e a reboot do aparelho.
 */

import * as SQLite from 'expo-sqlite';

import type { Recording, RecordingSource, RecordingStatus, TranscriptStatus } from '@/core/types';

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
  entry_id: string | null;
  transcript: string | null;
  transcript_language: string | null;
  transcript_status: string | null;
  source: string | null;
  content_type: string | null;
  file_name: string | null;
  duplicate: number | null;
  created_at: string;
  updated_at: string;
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('dyarium.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
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
          transcript TEXT,
          transcript_language TEXT,
          transcript_status TEXT,
          source TEXT,
          content_type TEXT,
          file_name TEXT,
          duplicate INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
      `);
      // Migracao leve para bancos criados antes destas colunas.
      for (const column of [
        'transcript',
        'transcript_language',
        'transcript_status',
        'source',
        'content_type',
        'file_name',
        'duplicate',
      ]) {
        await db
          .execAsync(`ALTER TABLE recordings ADD COLUMN ${column} TEXT`)
          .catch(() => undefined);
      }
      return db;
    });
  }
  return dbPromise;
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
    entryId: row.entry_id ?? undefined,
    transcript: row.transcript ?? undefined,
    transcriptLanguage: row.transcript_language ?? undefined,
    transcriptStatus: (row.transcript_status as TranscriptStatus | null) ?? undefined,
    source: (row.source as RecordingSource | null) ?? undefined,
    contentType: row.content_type ?? undefined,
    fileName: row.file_name ?? undefined,
    duplicate: row.duplicate ? true : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertRecording(r: Recording): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO recordings (
      id, title, recorded_at, dir, file_path, segment_count, duration_ms, size_bytes,
      status, upload_id, offset, attempts, next_attempt_at, last_error, entry_id,
      transcript, transcript_language, transcript_status,
      source, content_type, file_name, duplicate,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      entry_id = excluded.entry_id,
      transcript = excluded.transcript,
      transcript_language = excluded.transcript_language,
      transcript_status = excluded.transcript_status,
      source = excluded.source,
      content_type = excluded.content_type,
      file_name = excluded.file_name,
      duplicate = excluded.duplicate,
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
      r.entryId ?? null,
      r.transcript ?? null,
      r.transcriptLanguage ?? null,
      r.transcriptStatus ?? null,
      r.source ?? null,
      r.contentType ?? null,
      r.fileName ?? null,
      r.duplicate ? 1 : null,
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
