import {
  CONFLICT_BACKUPS_STORE,
  DRAFTS_STORE,
  storeDelete,
  storeGet,
  storeList,
  storeSet,
} from "./idb";

/** Estado de uma pendencia local do capitulo. */
export type DraftState = "local" | "offline" | "conflict";

export interface ChapterDraft {
  markdown: string;
  baseVersion: string;
  noteId: string;
  updatedAt: number;
  state: DraftState;
}

export interface ConflictBackup {
  markdown: string;
  noteId: string;
  createdAt: number;
}

const BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function readDraft(entryId: string): Promise<ChapterDraft | undefined> {
  return storeGet<ChapterDraft>(DRAFTS_STORE, entryId);
}

export async function writeDraft(entryId: string, draft: ChapterDraft): Promise<void> {
  await storeSet(DRAFTS_STORE, entryId, draft);
}

export function clearDraft(entryId: string): Promise<void> {
  return storeDelete(DRAFTS_STORE, entryId);
}

export async function listDrafts(): Promise<Array<[string, ChapterDraft]>> {
  return storeList<ChapterDraft>(DRAFTS_STORE);
}

export async function backupConflict(entryId: string, backup: ConflictBackup): Promise<void> {
  await storeSet(CONFLICT_BACKUPS_STORE, `${entryId}:${backup.createdAt}`, backup);
}

/** Remove backups com mais de sete dias. Roda no boot da casa do livro. */
export async function cleanupConflictBackups(now = Date.now()): Promise<void> {
  const entries = await storeList<ConflictBackup>(CONFLICT_BACKUPS_STORE);
  for (const [key, backup] of entries) {
    if (!backup || now - backup.createdAt > BACKUP_RETENTION_MS) {
      await storeDelete(CONFLICT_BACKUPS_STORE, key);
    }
  }
}
