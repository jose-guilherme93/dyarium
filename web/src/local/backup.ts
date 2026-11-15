/**
 * Backup do cofre: um retrato cifrado das notas, pronto para ir ao Drive.
 *
 * O arquivo e um envelope binario `iv || ciphertext` (AES-256-GCM). O `vaultId`
 * vem do codigo de recuperacao por hash: identifica a pasta no Drive sem
 * revelar a chave.
 */

import {
  getRecording,
  listRecordings,
  updateRecordingNote,
  upsertRecording,
} from "../../../mobile/src/core/repo";
import type { Recording } from "../../../mobile/src/core/types";

export interface SnapshotNote {
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
  vaultId: string;
  createdAt: string;
  notes: SnapshotNote[];
}

const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Nome da pasta no Drive: derivado do codigo, estavel e opaco. */
export async function vaultIdFromCode(code: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(`dyarium.vault.id:${code}`)),
  );
  return [...digest.slice(0, 5)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function snapshotNotes(notes: Recording[]): SnapshotNote[] {
  return notes.map((note) => ({
    id: note.id,
    title: note.title,
    recordedAt: note.recordedAt,
    updatedAt: note.updatedAt,
    notebookId: note.notebookId,
    tags: note.tags,
    archived: note.archived,
    icon: note.icon,
    author: note.author,
    text: note.text,
  }));
}

/** Retrato das notas vivas (a lixeira nao entra no backup). */
export async function buildSnapshot(vaultId: string): Promise<VaultSnapshot> {
  const notes = await listRecordings(false);
  return {
    version: 1,
    vaultId,
    createdAt: new Date().toISOString(),
    notes: snapshotNotes(notes),
  };
}

export async function sealSnapshot(snapshot: VaultSnapshot, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(JSON.stringify(snapshot)),
    ),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return out;
}

export async function openSnapshot(bytes: Uint8Array, key: CryptoKey): Promise<VaultSnapshot> {
  if (bytes.length <= IV_BYTES) throw new Error("backup vazio ou truncado");
  const iv = bytes.slice(0, IV_BYTES);
  const cipher = bytes.slice(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  const parsed = JSON.parse(decoder.decode(plain)) as VaultSnapshot;
  if (parsed.version !== 1) throw new Error(`versao de backup desconhecida: ${String(parsed.version)}`);
  return parsed;
}

function recordingFromNote(note: SnapshotNote, existente: Recording | null): Recording {
  const base: Recording = existente ?? {
    id: note.id,
    title: note.title,
    recordedAt: note.recordedAt,
    dir: "",
    segmentCount: 0,
    status: "completed",
    source: "text",
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
    notebookId: note.notebookId ?? base.notebookId,
    tags: note.tags ?? base.tags,
    archived: note.archived ?? base.archived,
    icon: note.icon ?? base.icon,
    author: (note.author as Recording["author"]) ?? base.author,
    status: "completed",
    updatedAt: note.updatedAt,
  };
}

export interface RestoreResult {
  created: number;
  updated: number;
  /** Notas locais mais novas que o backup: o backup nao passa por cima. */
  skipped: number;
}

/** Restaurar nao e editar: so entra o que for mais novo que o que ja existe. */
export async function applySnapshot(snapshot: VaultSnapshot): Promise<RestoreResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const note of snapshot.notes) {
    const existente = await getRecording(note.id);
    if (existente && new Date(existente.updatedAt) >= new Date(note.updatedAt)) {
      skipped += 1;
      continue;
    }
    await upsertRecording(recordingFromNote(note, existente));
    if (typeof note.text === "string") {
      await updateRecordingNote(note.id, { text: note.text });
    }
    if (existente) updated += 1;
    else created += 1;
  }
  return { created, updated, skipped };
}
