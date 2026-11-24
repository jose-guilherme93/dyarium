/**
 * O retrato do cofre (`backup.enc`): as notas que o web grava no Drive.
 *
 * Este modulo le exatamente o formato do web (`web/src/local/backup.ts`) e
 * decide o que aplicar no banco do aparelho. Restaurar nao e editar: o
 * `updatedAt` da nota continua o do retrato; quem chama refaz o carimbo HLC.
 *
 * Nada aqui apaga nota. O retrato e uma lista de notas vivas; ausencia pode
 * significar "o outro cliente ainda nao subiu", nunca "foi apagada". Por isso
 * so entram escritas, nunca remocoes.
 */

import { DEFAULT_NOTEBOOK_ID } from './notebooks';
import type { AuthorRole, Recording } from './types';

export const SNAPSHOT_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
export const MAX_NOTES = 50_000;
export const MAX_TEXT = 2 * 1024 * 1024;
export const MAX_TITLE = 512;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface VaultSnapshotNote {
  id: string;
  title: string;
  recordedAt: string;
  updatedAt: string;
  notebookId?: string;
  tags?: string[];
  archived?: boolean;
  icon?: string;
  author?: string;
  text?: string;
}

export interface VaultSnapshot {
  version: 1;
  vaultId?: string;
  createdAt: string;
  notes: VaultSnapshotNote[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const utf8 = new TextEncoder();

function bad(message = 'retrato do cofre invalido'): never {
  throw new SnapshotError(message);
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) bad();
  if (!Number.isFinite(Date.parse(value))) bad();
  return value;
}

function safeText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) bad();
  return value;
}

function safeOptionalString(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max || CONTROL.test(value)) bad();
  return value;
}

function safeId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value) || value.includes('..')) bad();
  return value;
}

function parseNote(raw: unknown): VaultSnapshotNote {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) bad();
  const item = raw as Record<string, unknown>;
  const tags = item.tags;
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > 100) bad();
    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.length === 0 || tag.length > 64 || CONTROL.test(tag)) bad();
    }
  }
  if (item.archived !== undefined && typeof item.archived !== 'boolean') bad();
  return {
    id: safeId(item.id),
    title: safeOptionalString(item.title, MAX_TITLE) ?? '',
    recordedAt: isoDate(item.recordedAt),
    updatedAt: isoDate(item.updatedAt),
    ...(item.notebookId !== undefined ? { notebookId: safeId(item.notebookId) } : {}),
    ...(tags !== undefined ? { tags: tags as string[] } : {}),
    ...(item.archived !== undefined ? { archived: item.archived as boolean } : {}),
    ...(item.icon !== undefined ? { icon: safeOptionalString(item.icon, 16) } : {}),
    ...(item.author !== undefined ? { author: safeOptionalString(item.author, 32) } : {}),
    ...(item.text !== undefined ? { text: safeText(item.text, MAX_TEXT) } : {}),
  };
}

/** Le e valida o JSON do `backup.enc`; qualquer divergencia e erro generico. */
export function parseVaultSnapshot(text: string): VaultSnapshot {
  if (typeof text !== 'string' || utf8.encode(text).length > MAX_SNAPSHOT_BYTES) bad();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    bad();
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) bad();
  const item = raw as Record<string, unknown>;
  if (item.version !== SNAPSHOT_VERSION) bad('versao de retrato desconhecida');
  const notes = item.notes;
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) bad();
  const seen = new Set<string>();
  const parsed = notes.map((note) => {
    const clean = parseNote(note);
    if (seen.has(clean.id)) bad('retrato com id repetido');
    seen.add(clean.id);
    return clean;
  });
  const vaultId = item.vaultId;
  if (vaultId !== undefined && (typeof vaultId !== 'string' || vaultId.length > 64)) bad();
  return {
    version: SNAPSHOT_VERSION,
    ...(typeof vaultId === 'string' ? { vaultId } : {}),
    createdAt: isoDate(item.createdAt),
    notes: parsed,
  };
}

/** As notas vivas, no formato que o web entende. */
export function snapshotFromRecordings(recordings: readonly Recording[]): VaultSnapshotNote[] {
  const notes: VaultSnapshotNote[] = [];
  for (const note of recordings) {
    if (note.deletedAt) continue;
    notes.push({
      id: note.id,
      title: note.title,
      recordedAt: note.recordedAt,
      updatedAt: note.updatedAt,
      ...(note.notebookId ? { notebookId: note.notebookId } : {}),
      ...(note.tags && note.tags.length > 0 ? { tags: note.tags } : {}),
      ...(note.archived ? { archived: true } : {}),
      ...(note.icon ? { icon: note.icon } : {}),
      ...(note.author ? { author: note.author } : {}),
      ...(note.text !== undefined ? { text: note.text } : {}),
    });
  }
  return notes;
}

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Uniao pelo id. O mais novo vence; empate fica com o local, para o envio nao
 * reescrever o retrato a cada sincronizacao.
 */
export function mergeSnapshotNotes(
  local: readonly VaultSnapshotNote[],
  remote: readonly VaultSnapshotNote[],
): VaultSnapshotNote[] {
  const byId = new Map<string, VaultSnapshotNote>();
  for (const note of remote) byId.set(note.id, note);
  for (const note of local) {
    const other = byId.get(note.id);
    if (!other || time(note.updatedAt) >= time(other.updatedAt)) byId.set(note.id, note);
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Aplicar agora? Nota local mais nova que o retrato manda; nota apagada depois
 * do retrato tambem nao volta. O que so existe no retrato entra.
 */
export function shouldRestoreNote(existing: Recording | null, note: VaultSnapshotNote): boolean {
  if (!existing) return true;
  const remote = time(note.updatedAt);
  if (existing.deletedAt && time(existing.deletedAt) >= remote) return false;
  return time(existing.updatedAt) < remote;
}

/**
 * Monta a nota para o `upsertRecording`. O que o retrato nao carrega (audio,
 * transcricao, diretorio) fica o que ja existia no aparelho.
 */
export function recordingFromSnapshotNote(
  note: VaultSnapshotNote,
  existing: Recording | null,
  updatedHlc: string,
): Recording {
  const base: Recording = existing ?? {
    id: note.id,
    title: note.title,
    recordedAt: note.recordedAt,
    dir: '',
    segmentCount: 0,
    status: 'completed',
    source: 'text',
    offset: 0,
    attempts: 0,
    createdAt: note.recordedAt,
    updatedAt: note.updatedAt,
  };
  return {
    ...base,
    id: note.id,
    title: note.title,
    recordedAt: note.recordedAt,
    notebookId: note.notebookId ?? base.notebookId ?? DEFAULT_NOTEBOOK_ID,
    tags: note.tags ?? base.tags,
    archived: note.archived ?? base.archived,
    icon: note.icon ?? base.icon,
    author: (note.author as AuthorRole | undefined) ?? base.author,
    text: note.text !== undefined ? note.text : base.text,
    status: base.status === 'completed' ? 'completed' : base.status,
    deletedAt: undefined,
    updatedAt: note.updatedAt,
    updatedHlc,
  };
}
