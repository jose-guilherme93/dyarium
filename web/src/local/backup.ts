/**
 * Backup do cofre: um retrato cifrado do que o usuario ve, pronto para ir ao
 * Drive.
 *
 * O arquivo e um envelope binario `iv || ciphertext` (AES-256-GCM). O `vaultId`
 * vem do codigo de recuperacao por hash: identifica a pasta no Drive sem
 * revelar a chave.
 *
 * A versao 1 levava so as notas. A versao 2 leva tambem os cadernos, a
 * transcricao e a analise de cada nota e as configuracoes do navegador: sem
 * isso, restaurar em outro navegador devolvia notas soltas em "Notas ao acaso".
 * A leitura aceita as duas versoes; a escrita sempre grava a 2.
 */

import { getDb } from "../../../mobile/src/core/port";
import {
  getRecording,
  listRecordings,
  updateChapterFields,
  updateRecordingNote,
  upsertRecording,
  type ChapterFields,
} from "../../../mobile/src/core/repo";
import type {
  Recording,
  TranscriptOrigin,
  TranscriptSegment,
  TranscriptStatus,
} from "../../../mobile/src/core/types";

import { listLocalAnalyses, readLocalAnalysis, saveAnalysisSnapshot } from "./analyze";
import { listLocalNotebooks } from "./notebooks";
import { DEFAULT_SETTINGS, loadLocalSettings, saveLocalSettings } from "./settings";

import type { Analysis, Notebook, Settings } from "../types";

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
  /** Transcricao pronta (texto corrido). */
  transcript?: string;
  transcriptLanguage?: string;
  transcriptSegments?: TranscriptSegment[];
  transcriptStatus?: TranscriptStatus;
  transcriptOrigin?: TranscriptOrigin;
  hasTranscript?: boolean;
  /* Modo escritor: o planejamento do capitulo. */
  chapterKind?: string;
  chapterPosition?: number;
  chapterStatus?: string;
  chapterGoalWords?: number;
  chapterSynopsis?: string;
  chapterBeats?: string;
  chapterNotes?: string;
  /**
   * Nota de origem de um trecho de transcricao. No banco o campo se chama
   * `captureSourceId`; aqui o nome do retrato segue o pai da nota.
   */
  parentId?: string;
}

/** Uma analise do cofre, na mesma chave do `ANALYSIS_STORE`. */
export interface SnapshotAnalysis {
  entry_id: string;
  analysis: Analysis;
}

export interface VaultSnapshot {
  /** 1: so notas; 2: notas, cadernos, analises e configuracoes. */
  version: 1 | 2;
  vaultId: string;
  createdAt: string;
  notes: SnapshotNote[];
  notebooks?: Notebook[];
  analyses?: SnapshotAnalysis[];
  /** Objeto publico de `loadLocalSettings`: sem chave de provedor. */
  settings?: Settings;
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
    transcript: note.transcript,
    transcriptLanguage: note.transcriptLanguage,
    transcriptSegments: note.transcriptSegments,
    transcriptStatus: note.transcriptStatus,
    transcriptOrigin: note.transcriptOrigin,
    hasTranscript: note.hasTranscript,
    chapterKind: note.chapterKind,
    chapterPosition: note.chapterPosition,
    chapterStatus: note.chapterStatus,
    chapterGoalWords: note.chapterGoalWords,
    chapterSynopsis: note.chapterSynopsis,
    chapterBeats: note.chapterBeats,
    chapterNotes: note.chapterNotes,
    parentId: note.captureSourceId,
  }));
}

/** Nota no formato compartilhado v1: so o que o app tambem entende. */
export interface NotesSnapshotNote {
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

function notesSnapshotFrom(notes: Recording[]): NotesSnapshotNote[] {
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

/**
 * O `backup.enc` compartilhado: retrato v1, so notas, que o app e o web leem.
 *
 * O estado extra do web (transcricao, cadernos, analises e configuracoes) vai
 * em `state.enc`; separar e o que impede o app de apagar o que nao entende.
 */
export async function buildNotesSnapshot(vaultId: string): Promise<VaultSnapshot> {
  return {
    version: 1,
    vaultId,
    createdAt: new Date().toISOString(),
    notes: notesSnapshotFrom(await listRecordings(false)),
  };
}

/** Retrato completo do cofre vivo (a lixeira nao entra no backup). */
export async function buildSnapshot(vaultId: string): Promise<VaultSnapshot> {
  const [notes, notebooks, analyses, settings] = await Promise.all([
    listRecordings(false),
    listLocalNotebooks(),
    listLocalAnalyses(),
    loadLocalSettings(),
  ]);
  return {
    version: 2,
    vaultId,
    createdAt: new Date().toISOString(),
    notes: snapshotNotes(notes),
    notebooks,
    analyses,
    settings,
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
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error(`versao de backup desconhecida: ${String(parsed.version)}`);
  }
  if (!Array.isArray(parsed.notes)) throw new Error("backup sem lista de notas");
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
    transcript: note.transcript ?? base.transcript,
    transcriptLanguage: note.transcriptLanguage ?? base.transcriptLanguage,
    transcriptSegments: note.transcriptSegments ?? base.transcriptSegments,
    transcriptStatus: note.transcriptStatus ?? base.transcriptStatus,
    transcriptOrigin: note.transcriptOrigin ?? base.transcriptOrigin,
    hasTranscript: note.hasTranscript ?? base.hasTranscript,
    chapterKind: note.chapterKind ?? base.chapterKind,
    chapterPosition: note.chapterPosition ?? base.chapterPosition,
    chapterStatus: note.chapterStatus ?? base.chapterStatus,
    chapterGoalWords: note.chapterGoalWords ?? base.chapterGoalWords,
    chapterSynopsis: note.chapterSynopsis ?? base.chapterSynopsis,
    chapterBeats: note.chapterBeats ?? base.chapterBeats,
    chapterNotes: note.chapterNotes ?? base.chapterNotes,
    captureSourceId: note.parentId ?? base.captureSourceId,
    status: "completed",
    updatedAt: note.updatedAt,
  };
}

/** Campos de capitulo presentes no retrato, no formato da escrita dedicada. */
function chapterFieldsOf(note: SnapshotNote): ChapterFields | null {
  const campos: ChapterFields = {};
  if (note.chapterKind !== undefined) campos.chapterKind = note.chapterKind;
  if (note.chapterPosition !== undefined) campos.chapterPosition = note.chapterPosition;
  if (note.chapterStatus !== undefined) campos.chapterStatus = note.chapterStatus;
  if (note.chapterGoalWords !== undefined) campos.chapterGoalWords = note.chapterGoalWords;
  if (note.chapterSynopsis !== undefined) campos.chapterSynopsis = note.chapterSynopsis;
  if (note.chapterBeats !== undefined) campos.chapterBeats = note.chapterBeats;
  if (note.chapterNotes !== undefined) campos.chapterNotes = note.chapterNotes;
  return Object.keys(campos).length > 0 ? campos : null;
}

export interface NotebookRestoreResult {
  created: number;
  updated: number;
  skipped: number;
}

export interface RestoreResult {
  created: number;
  updated: number;
  /** Notas locais mais novas que o backup: o backup nao passa por cima. */
  skipped: number;
  /** Cadernos restaurados por id. */
  notebooks: NotebookRestoreResult;
  /** Analises novas gravadas no `ANALYSIS_STORE`. */
  analyses: number;
  /** Configuracoes do retrato aplicadas (so quando o local estava no padrao). */
  settings: boolean;
}

/** Contagem de um passo da restauracao, para a tela mostrar numero real. */
export interface StepProgress {
  done: number;
  total: number;
}

function tempo(valor: string | null | undefined): number {
  const parsed = Date.parse(valor ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Grava um caderno do retrato preservando nome, kind, cor, ordem (`created_at`)
 * e capa. Caderno apagado depois do retrato e tratado como tombstone: nao volta.
 */
async function restoreNotebook(
  caderno: Notebook,
): Promise<"created" | "updated" | "skipped"> {
  const db = await getDb();
  const local = await db.getFirstAsync<{ deleted: number; updated_at: string }>(
    "SELECT deleted, updated_at FROM notebooks WHERE id = ?",
    [caderno.id],
  );
  if (local?.deleted) return "skipped";
  if (local && tempo(local.updated_at) >= tempo(caderno.updated_at)) return "skipped";

  const valores = [
    caderno.id,
    caderno.name,
    caderno.color ?? "",
    caderno.kind === "book" ? "book" : "notes",
    caderno.created_at,
    caderno.updated_at,
    caderno.subtitle ?? "",
    caderno.author ?? "",
    caderno.synopsis ?? "",
    caderno.language ?? "",
    caderno.goal_words ?? 0,
    caderno.book_status ?? "drafting",
    caderno.page_size ?? "",
    caderno.page_margin_mm ?? 0,
    caderno.body_px ?? 0,
    caderno.body_leading ?? 0,
    caderno.body_font ?? "",
    caderno.daily_goal_words ?? 0,
    caderno.deadline ?? "",
    caderno.has_cover ? 1 : 0,
    caderno.cover_updated_at ?? "",
  ];
  await db.runAsync(
    `INSERT INTO notebooks (
       id, name, color, is_default, kind, created_at, updated_at, dirty, synced, deleted,
       subtitle, author, synopsis, language, goal_words, book_status, page_size, page_margin_mm,
       body_px, body_leading, body_font, daily_goal_words, deadline, has_cover, cover_updated_at
     ) VALUES (?, ?, ?, 0, ?, ?, ?, 1, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       color = excluded.color,
       kind = excluded.kind,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       subtitle = excluded.subtitle,
       author = excluded.author,
       synopsis = excluded.synopsis,
       language = excluded.language,
       goal_words = excluded.goal_words,
       book_status = excluded.book_status,
       page_size = excluded.page_size,
       page_margin_mm = excluded.page_margin_mm,
       body_px = excluded.body_px,
       body_leading = excluded.body_leading,
       body_font = excluded.body_font,
       daily_goal_words = excluded.daily_goal_words,
       deadline = excluded.deadline,
       has_cover = excluded.has_cover,
       cover_updated_at = excluded.cover_updated_at,
       dirty = 1,
       deleted = 0`,
    valores,
  );
  return local ? "updated" : "created";
}

/** O navegador ainda esta no padrao? Compara so os campos conhecidos. */
function settingsNoPadrao(settings: Settings): boolean {
  for (const chave of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (settings[chave] !== DEFAULT_SETTINGS[chave]) return false;
  }
  return true;
}

/**
 * Configuracao do retrato so entra num navegador que nunca foi configurado.
 * Quem ja escolheu provedor, modelo ou dono nao perde a escolha para um retrato
 * antigo; as chaves de provedor nao viajam no retrato (ver `loadLocalSettings`).
 *
 * So os campos conhecidos de `DEFAULT_SETTINGS` sao copiados: um retrato
 * adulterado nao injeta chave nova nem mexe no prototipo do objeto.
 */
async function restoreSettings(snapshot: VaultSnapshot): Promise<boolean> {
  const orig = snapshot.settings;
  if (!orig || typeof orig !== "object" || Array.isArray(orig)) return false;
  if (!settingsNoPadrao(await loadLocalSettings())) return false;
  const patch: Record<string, unknown> = {};
  for (const chave of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    // `*_api_key_set` sao derivados da chave real, que nao esta no retrato.
    if (chave === "deepgram_api_key_set" || chave === "analyze_api_key_set") continue;
    const valor = orig[chave];
    if (valor !== undefined) patch[chave] = valor;
  }
  await saveLocalSettings(patch);
  return true;
}

/**
 * Restaurar nao e editar: so entra o que for mais novo que o que ja existe.
 *
 * - nota: local mais nova manda; transcricao e capitulo voltam junto;
 * - caderno: por id, so quando faltar ou o local for mais antigo;
 * - analise: trabalho feito no navegador nunca e sobrescrito;
 * - configuracoes: so quando o navegador ainda esta no padrao.
 */
export async function applySnapshot(
  snapshot: VaultSnapshot,
  options: { onProgress?: (p: StepProgress) => void } = {},
): Promise<RestoreResult> {
  const total = snapshot.notes.length;
  const avisar = (done: number): void => {
    try {
      options.onProgress?.({ done, total });
    } catch {
      // A tela e so aviso: um callback quebrado nao interrompe o restore.
    }
  };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let done = 0;
  if (total > 0) avisar(0);
  for (const note of snapshot.notes) {
    if (
      !note ||
      typeof note.id !== "string" ||
      note.id.length === 0 ||
      typeof note.recordedAt !== "string" ||
      typeof note.updatedAt !== "string"
    ) {
      skipped += 1;
      done += 1;
      avisar(done);
      continue;
    }
    const existente = await getRecording(note.id);
    if (existente && new Date(existente.updatedAt) >= new Date(note.updatedAt)) {
      skipped += 1;
    } else {
      await upsertRecording(recordingFromNote(note, existente));
      if (typeof note.text === "string") {
        await updateRecordingNote(note.id, { text: note.text });
      }
      const capitulo = chapterFieldsOf(note);
      if (capitulo) await updateChapterFields(note.id, capitulo);
      if (existente) updated += 1;
      else created += 1;
    }
    done += 1;
    avisar(done);
  }

  const notebooks: NotebookRestoreResult = { created: 0, updated: 0, skipped: 0 };
  const restaurarExtras = snapshot.version === 2;
  for (const caderno of restaurarExtras ? (snapshot.notebooks ?? []) : []) {
    if (
      !caderno ||
      typeof caderno.id !== "string" ||
      typeof caderno.name !== "string" ||
      typeof caderno.created_at !== "string" ||
      typeof caderno.updated_at !== "string"
    ) {
      continue;
    }
    notebooks[await restoreNotebook(caderno)] += 1;
  }

  let analyses = 0;
  for (const item of restaurarExtras ? (snapshot.analyses ?? []) : []) {
    if (
      !item ||
      typeof item.entry_id !== "string" ||
      item.entry_id.length === 0 ||
      !item.analysis ||
      typeof item.analysis !== "object"
    ) {
      continue;
    }
    if ((await readLocalAnalysis(item.entry_id)) !== null) continue;
    await saveAnalysisSnapshot(item.entry_id, item.analysis);
    analyses += 1;
  }

  const settings = restaurarExtras ? await restoreSettings(snapshot) : false;
  return { created, updated, skipped, notebooks, analyses, settings };
}
