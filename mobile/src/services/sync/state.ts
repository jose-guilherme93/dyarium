/**
 * Estado de sincronizacao por ambiente. Fica no SQLite, nao no SecureStore: e
 * dado operacional (id remoto, versoes, offset) e precisa sobreviver a um
 * reinicio sem bloquear o boot.
 */

import { getDatabase } from '@/services/db';

export interface ServerInstanceRow {
  id: string;
  baseUrl: string;
  label: string;
  contract: string;
  createdAt: string;
  lastSyncAt?: string;
}

export interface EntrySyncRow {
  serverId: string;
  recordingId: string;
  remoteEntryId?: string;
  noteId?: string;
  titleVersion?: string;
  recordedAtVersion?: string;
  bodyVersion?: string;
  uploadId?: string;
  uploadOffset: number;
  attachmentRefs?: string;
  primaryAttachmentId?: string;
  syncedTitle?: string;
  syncedRecordedAt?: string;
  syncedBodyHash?: string;
  syncedNotebookId?: string;
  syncedTags?: string;
  syncedArchived?: number;
  syncedAuthor?: string;
  syncedAt?: string;
  lastError?: string;
  deletedAt?: string;
  tombstonePushedAt?: string;
}

export interface TombstoneRow {
  id: string;
  kind: 'entry' | 'notebook';
  deletedAt: string;
  origin: string;
}

interface ServerDbRow {
  id: string;
  base_url: string;
  label: string | null;
  contract: string;
  created_at: string;
  last_sync_at: string | null;
}

interface EntrySyncDbRow {
  server_id: string;
  recording_id: string;
  remote_entry_id: string | null;
  note_id: string | null;
  title_version: string | null;
  recorded_at_version: string | null;
  body_version: string | null;
  upload_id: string | null;
  upload_offset: number;
  attachment_refs: string | null;
  primary_attachment_id: string | null;
  synced_title: string | null;
  synced_recorded_at: string | null;
  synced_body_hash: string | null;
  synced_notebook_id: string | null;
  synced_tags: string | null;
  synced_archived: number | null;
  synced_author: string | null;
  synced_at: string | null;
  last_error: string | null;
  deleted_at: string | null;
  tombstone_pushed_at: string | null;
}

function toServer(row: ServerDbRow): ServerInstanceRow {
  return {
    id: row.id,
    baseUrl: row.base_url,
    label: row.label ?? '',
    contract: row.contract,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at ?? undefined,
  };
}

function toEntrySync(row: EntrySyncDbRow): EntrySyncRow {
  return {
    serverId: row.server_id,
    recordingId: row.recording_id,
    remoteEntryId: row.remote_entry_id ?? undefined,
    noteId: row.note_id ?? undefined,
    titleVersion: row.title_version ?? undefined,
    recordedAtVersion: row.recorded_at_version ?? undefined,
    bodyVersion: row.body_version ?? undefined,
    uploadId: row.upload_id ?? undefined,
    uploadOffset: row.upload_offset,
    attachmentRefs: row.attachment_refs ?? undefined,
    primaryAttachmentId: row.primary_attachment_id ?? undefined,
    syncedTitle: row.synced_title ?? undefined,
    syncedRecordedAt: row.synced_recorded_at ?? undefined,
    syncedBodyHash: row.synced_body_hash ?? undefined,
    syncedNotebookId: row.synced_notebook_id ?? undefined,
    syncedTags: row.synced_tags ?? undefined,
    syncedArchived: row.synced_archived ?? undefined,
    syncedAuthor: row.synced_author ?? undefined,
    syncedAt: row.synced_at ?? undefined,
    lastError: row.last_error ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    tombstonePushedAt: row.tombstone_pushed_at ?? undefined,
  };
}

export async function upsertServer(row: ServerInstanceRow): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO server_instance (id, base_url, label, contract, created_at, last_sync_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       base_url = excluded.base_url,
       label = excluded.label,
       contract = excluded.contract,
       last_sync_at = COALESCE(excluded.last_sync_at, server_instance.last_sync_at)`,
    [
      row.id,
      row.baseUrl,
      row.label,
      row.contract,
      row.createdAt,
      row.lastSyncAt ?? null,
    ],
  );
}

export async function listServers(): Promise<ServerInstanceRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ServerDbRow>(
    'SELECT id, base_url, label, contract, created_at, last_sync_at FROM server_instance ORDER BY created_at ASC',
  );
  return rows.map(toServer);
}

export async function touchServerSync(id: string, at: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE server_instance SET last_sync_at = ? WHERE id = ?', [at, id]);
}

export async function getEntrySync(
  serverId: string,
  recordingId: string,
): Promise<EntrySyncRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<EntrySyncDbRow>(
    'SELECT * FROM entry_sync WHERE server_id = ? AND recording_id = ?',
    [serverId, recordingId],
  );
  return row ? toEntrySync(row) : null;
}

export async function listEntrySync(serverId: string): Promise<EntrySyncRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<EntrySyncDbRow>(
    'SELECT * FROM entry_sync WHERE server_id = ?',
    [serverId],
  );
  return rows.map(toEntrySync);
}

export async function upsertEntrySync(row: EntrySyncRow): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO entry_sync (
      server_id, recording_id, remote_entry_id, note_id,
      title_version, recorded_at_version, body_version,
      upload_id, upload_offset, attachment_refs, primary_attachment_id,
      synced_title, synced_recorded_at, synced_body_hash, synced_notebook_id,
      synced_tags, synced_archived, synced_author, synced_at, last_error,
      deleted_at, tombstone_pushed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id, recording_id) DO UPDATE SET
      remote_entry_id = excluded.remote_entry_id,
      note_id = excluded.note_id,
      title_version = excluded.title_version,
      recorded_at_version = excluded.recorded_at_version,
      body_version = excluded.body_version,
      upload_id = excluded.upload_id,
      upload_offset = excluded.upload_offset,
      attachment_refs = excluded.attachment_refs,
      primary_attachment_id = excluded.primary_attachment_id,
      synced_title = excluded.synced_title,
      synced_recorded_at = excluded.synced_recorded_at,
      synced_body_hash = excluded.synced_body_hash,
      synced_notebook_id = excluded.synced_notebook_id,
      synced_tags = excluded.synced_tags,
      synced_archived = excluded.synced_archived,
      synced_author = excluded.synced_author,
      synced_at = excluded.synced_at,
      last_error = excluded.last_error,
      deleted_at = excluded.deleted_at,
      tombstone_pushed_at = excluded.tombstone_pushed_at`,
    [
      row.serverId,
      row.recordingId,
      row.remoteEntryId ?? null,
      row.noteId ?? null,
      row.titleVersion ?? null,
      row.recordedAtVersion ?? null,
      row.bodyVersion ?? null,
      row.uploadId ?? null,
      row.uploadOffset ?? 0,
      row.attachmentRefs ?? null,
      row.primaryAttachmentId ?? null,
      row.syncedTitle ?? null,
      row.syncedRecordedAt ?? null,
      row.syncedBodyHash ?? null,
      row.syncedNotebookId ?? null,
      row.syncedTags ?? null,
      row.syncedArchived ?? null,
      row.syncedAuthor ?? null,
      row.syncedAt ?? null,
      row.lastError ?? null,
      row.deletedAt ?? null,
      row.tombstonePushedAt ?? null,
    ],
  );
}

export async function deleteEntrySync(serverId: string, recordingId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM entry_sync WHERE server_id = ? AND recording_id = ?', [
    serverId,
    recordingId,
  ]);
}

export async function putTombstone(row: TombstoneRow): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO tombstones (id, kind, deleted_at, origin) VALUES (?, ?, ?, ?)
     ON CONFLICT(id, kind) DO UPDATE SET
       deleted_at = excluded.deleted_at,
       origin = excluded.origin
     WHERE excluded.deleted_at >= tombstones.deleted_at`,
    [row.id, row.kind, row.deletedAt, row.origin],
  );
}

export async function removeTombstone(id: string, kind: 'entry' | 'notebook'): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM tombstones WHERE id = ? AND kind = ?', [id, kind]);
}

export async function listTombstones(kind: 'entry' | 'notebook'): Promise<TombstoneRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    kind: 'entry' | 'notebook';
    deleted_at: string;
    origin: string;
  }>('SELECT id, kind, deleted_at, origin FROM tombstones WHERE kind = ? ORDER BY deleted_at ASC', [
    kind,
  ]);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    deletedAt: row.deleted_at,
    origin: row.origin,
  }));
}

export interface NotebookSyncRow {
  serverId: string;
  notebookId: string;
  syncedName?: string;
  syncedColor?: string;
  syncedAt?: string;
  deletedAt?: string;
  tombstonePushedAt?: string;
}

export async function upsertNotebookSync(row: NotebookSyncRow): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO notebook_sync (
       server_id, notebook_id, synced_name, synced_color, synced_at,
       deleted_at, tombstone_pushed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, notebook_id) DO UPDATE SET
       synced_name = excluded.synced_name,
       synced_color = excluded.synced_color,
       synced_at = excluded.synced_at,
       deleted_at = excluded.deleted_at,
       tombstone_pushed_at = excluded.tombstone_pushed_at`,
    [
      row.serverId,
      row.notebookId,
      row.syncedName ?? null,
      row.syncedColor ?? null,
      row.syncedAt ?? null,
      row.deletedAt ?? null,
      row.tombstonePushedAt ?? null,
    ],
  );
}

export async function listNotebookSync(serverId: string): Promise<NotebookSyncRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    server_id: string;
    notebook_id: string;
    synced_name: string | null;
    synced_color: string | null;
    synced_at: string | null;
    deleted_at: string | null;
    tombstone_pushed_at: string | null;
  }>('SELECT * FROM notebook_sync WHERE server_id = ?', [serverId]);
  return rows.map((row) => ({
    serverId: row.server_id,
    notebookId: row.notebook_id,
    syncedName: row.synced_name ?? undefined,
    syncedColor: row.synced_color ?? undefined,
    syncedAt: row.synced_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    tombstonePushedAt: row.tombstone_pushed_at ?? undefined,
  }));
}

/**
 * Quantas notas vivas aquele ambiente ja confirmou. A tela de servidores usa o
 * numero para mostrar o estado sem uma frase: "248/250" diz tudo.
 */
export async function countSyncedNotes(baseUrl: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM entry_sync es
     JOIN server_instance si ON si.id = es.server_id
     WHERE si.base_url = ? AND es.remote_entry_id IS NOT NULL AND es.deleted_at IS NULL`,
    [baseUrl],
  );
  return row?.total ?? 0;
}
