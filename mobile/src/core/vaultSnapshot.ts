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

import { DEFAULT_NOTEBOOK_ID, normalizeBookStatus, type Notebook } from './notebooks';
import type {
  AuthorRole,
  Recording,
  TranscriptOrigin,
  TranscriptSegment,
  TranscriptStatus,
} from './types';

export const SNAPSHOT_VERSION = 1;
export const STATE_VERSION = 2;
export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
export const MAX_STATE_BYTES = 64 * 1024 * 1024;
export const MAX_NOTES = 50_000;
export const MAX_NOTEBOOKS = 20_000;
export const MAX_SEGMENTS = 20_000;
export const MAX_ANALYSES = 50_000;
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

/**
 * A nota no retrato v2 (`state.enc`): o mesmo objeto que o web grava, com a
 * transcricao e o planejamento do capitulo. A uniao e por `id`, o `updatedAt`
 * mais novo vence e o objeto inteiro do lado vencedor e preservado.
 */
export interface VaultStateNote extends VaultSnapshotNote {
  transcript?: string;
  transcriptLanguage?: string;
  transcriptSegments?: TranscriptSegment[];
  transcriptStatus?: TranscriptStatus;
  transcriptOrigin?: TranscriptOrigin;
  hasTranscript?: boolean;
  chapterKind?: string;
  chapterPosition?: number;
  chapterStatus?: string;
  chapterGoalWords?: number;
  chapterSynopsis?: string;
  chapterBeats?: string;
  chapterNotes?: string;
  /** Nota de origem de um trecho de transcricao (o `captureSourceId` local). */
  parentId?: string;
}

/**
 * Caderno no retrato v2, com os nomes do web (`snake_case`). Campos que este
 * app ainda nao usa (`entry_count`, etc.) sao preservados sem interpretacao.
 */
export interface VaultStateNotebook {
  id: string;
  name: string;
  color?: string;
  is_default?: boolean;
  kind?: string;
  created_at: string;
  updated_at: string;
  subtitle?: string;
  author?: string;
  synopsis?: string;
  language?: string;
  goal_words?: number;
  book_status?: string;
  page_size?: string;
  page_margin_mm?: number;
  body_px?: number;
  body_leading?: number;
  body_font?: string;
  daily_goal_words?: number;
  deadline?: string;
  has_cover?: boolean;
  cover_updated_at?: string | null;
  [key: string]: unknown;
}

/** Uma analise do cofre, preservada como veio (o app nao as interpreta). */
export interface VaultStateAnalysis {
  entry_id: string;
  analysis: Record<string, unknown>;
  [key: string]: unknown;
}

/** O retrato v2 completo do web; `backup.enc` continua sendo o v1 so de notas. */
export interface VaultState {
  version: 2;
  vaultId?: string;
  createdAt: string;
  notes: VaultStateNote[];
  notebooks: VaultStateNotebook[];
  analyses?: VaultStateAnalysis[];
  settings?: Record<string, unknown>;
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

/**
 * As notas vivas no formato do `state.enc` v2. Repete o que o web grava,
 * inclusive os campos vazios dos capitulos: o retrato do outro cliente so fica
 * estavel se os dois lados serializarem a mesma coisa.
 */
export function stateNotesFromRecordings(recordings: readonly Recording[]): VaultStateNote[] {
  const notes: VaultStateNote[] = [];
  for (const note of recordings) {
    if (note.deletedAt) continue;
    notes.push({
      id: note.id,
      title: note.title,
      recordedAt: note.recordedAt,
      updatedAt: note.updatedAt,
      notebookId: note.notebookId ?? DEFAULT_NOTEBOOK_ID,
      ...(note.tags && note.tags.length > 0 ? { tags: note.tags } : {}),
      ...(note.archived ? { archived: true } : {}),
      icon: note.icon ?? '',
      author: note.author ?? '',
      ...(note.text !== undefined ? { text: note.text } : {}),
      ...(note.transcript !== undefined ? { transcript: note.transcript } : {}),
      ...(note.transcriptLanguage !== undefined
        ? { transcriptLanguage: note.transcriptLanguage }
        : {}),
      ...(note.transcriptSegments !== undefined
        ? { transcriptSegments: note.transcriptSegments }
        : {}),
      ...(note.transcriptStatus !== undefined
        ? { transcriptStatus: note.transcriptStatus }
        : {}),
      ...(note.transcriptOrigin !== undefined
        ? { transcriptOrigin: note.transcriptOrigin }
        : {}),
      ...(note.hasTranscript ? { hasTranscript: true } : {}),
      chapterKind: note.chapterKind ?? '',
      chapterPosition: note.chapterPosition ?? 0,
      chapterStatus: note.chapterStatus ?? '',
      chapterGoalWords: note.chapterGoalWords ?? 0,
      chapterSynopsis: note.chapterSynopsis ?? '',
      chapterBeats: note.chapterBeats ?? '',
      chapterNotes: note.chapterNotes ?? '',
      ...(note.captureSourceId !== undefined ? { parentId: note.captureSourceId } : {}),
    });
  }
  return notes;
}

/** Projecao de uma nota v2 para o retrato v1 (o que o app antigo entende). */
export function notesSnapshotNoteFromState(note: VaultStateNote): VaultSnapshotNote {
  return {
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
  };
}

function isoOr(value: string, fallbackMs: number): string {
  return Number.isFinite(Date.parse(value)) ? value : new Date(fallbackMs).toISOString();
}

/** Caderno no formato do retrato (`snake_case`), como o web grava. */
export function notebooksToState(
  notebooks: readonly Notebook[],
  counts: ReadonlyMap<string, { notes: number; chapters: number }> = new Map(),
): VaultStateNotebook[] {
  return notebooks.map((notebook) => {
    const total = counts.get(notebook.id);
    const createdAt = isoOr(notebook.createdAt, 0);
    return {
      id: notebook.id,
      name: notebook.name,
      color: notebook.color ?? '',
      is_default: notebook.isDefault,
      kind: notebook.kind ?? 'notes',
      subtitle: notebook.subtitle ?? '',
      author: notebook.author ?? '',
      synopsis: notebook.synopsis ?? '',
      language: notebook.language ?? '',
      goal_words: notebook.goalWords ?? 0,
      book_status: normalizeBookStatus(notebook.bookStatus),
      ...(notebook.pageSize ? { page_size: notebook.pageSize } : {}),
      ...(notebook.pageMarginMm ? { page_margin_mm: notebook.pageMarginMm } : {}),
      ...(notebook.bodyPx ? { body_px: notebook.bodyPx } : {}),
      ...(notebook.bodyLeading ? { body_leading: notebook.bodyLeading } : {}),
      ...(notebook.bodyFont ? { body_font: notebook.bodyFont } : {}),
      ...(notebook.dailyGoalWords ? { daily_goal_words: notebook.dailyGoalWords } : {}),
      deadline: notebook.deadline ?? '',
      has_cover: notebook.hasCover === true,
      cover_updated_at: notebook.coverUpdatedAt || null,
      entry_count: total?.notes ?? 0,
      chapter_count: total?.chapters ?? 0,
      created_at: createdAt,
      updated_at: isoOr(notebook.updatedAt, Date.parse(createdAt)),
    };
  });
}

/** Caderno do retrato no formato local (sem `dirty`/`synced`). */
export function notebookFromState(notebook: VaultStateNotebook): Notebook {
  const pageSize = typeof notebook.page_size === 'string' ? notebook.page_size : '';
  return {
    id: notebook.id,
    name: notebook.name,
    color: typeof notebook.color === 'string' ? notebook.color : '',
    isDefault: notebook.is_default === true,
    kind: notebook.kind === 'book' ? 'book' : notebook.kind === 'mcp' ? 'mcp' : 'notes',
    createdAt: notebook.created_at,
    updatedAt: notebook.updated_at,
    subtitle: typeof notebook.subtitle === 'string' ? notebook.subtitle : '',
    author: typeof notebook.author === 'string' ? notebook.author : '',
    synopsis: typeof notebook.synopsis === 'string' ? notebook.synopsis : '',
    language: typeof notebook.language === 'string' ? notebook.language : '',
    goalWords: typeof notebook.goal_words === 'number' ? notebook.goal_words : 0,
    bookStatus: normalizeBookStatus(
      typeof notebook.book_status === 'string' ? notebook.book_status : undefined,
    ),
    pageSize,
    pageMarginMm: typeof notebook.page_margin_mm === 'number' ? notebook.page_margin_mm : 0,
    bodyPx: typeof notebook.body_px === 'number' ? notebook.body_px : 0,
    bodyLeading: typeof notebook.body_leading === 'number' ? notebook.body_leading : 0,
    bodyFont: typeof notebook.body_font === 'string' ? notebook.body_font : '',
    dailyGoalWords:
      typeof notebook.daily_goal_words === 'number' ? notebook.daily_goal_words : 0,
    deadline: typeof notebook.deadline === 'string' ? notebook.deadline : '',
    hasCover: notebook.has_cover === true,
    coverUpdatedAt:
      typeof notebook.cover_updated_at === 'string' ? notebook.cover_updated_at : '',
  };
}

function optionalNumber(value: unknown, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > max) bad();
  return value;
}

function parseSegments(raw: unknown): TranscriptSegment[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_SEGMENTS) bad();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) bad();
    const segment = item as Record<string, unknown>;
    if (typeof segment.text !== 'string' || segment.text.length > MAX_TEXT) bad();
    if (typeof segment.start_ms !== 'number' || !Number.isFinite(segment.start_ms)) bad();
    if (typeof segment.end_ms !== 'number' || !Number.isFinite(segment.end_ms)) bad();
  }
  return raw as TranscriptSegment[];
}

function transcriptStatus(value: unknown): TranscriptStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'pending' || value === 'ready' || value === 'failed') return value;
  bad();
}

function transcriptOrigin(value: unknown): TranscriptOrigin | undefined {
  if (value === undefined) return undefined;
  if (value === 'local' || value === 'server' || value === 'provider') return value;
  bad();
}

function parseStateNote(raw: unknown): VaultStateNote {
  const base = parseNote(raw);
  const item = raw as Record<string, unknown>;
  if (item.hasTranscript !== undefined && typeof item.hasTranscript !== 'boolean') bad();
  return {
    ...base,
    ...(item.transcript !== undefined ? { transcript: safeText(item.transcript, MAX_TEXT) } : {}),
    ...(item.transcriptLanguage !== undefined
      ? { transcriptLanguage: safeOptionalString(item.transcriptLanguage, 64) }
      : {}),
    ...(item.transcriptSegments !== undefined
      ? { transcriptSegments: parseSegments(item.transcriptSegments) }
      : {}),
    ...(item.transcriptStatus !== undefined
      ? { transcriptStatus: transcriptStatus(item.transcriptStatus) }
      : {}),
    ...(item.transcriptOrigin !== undefined
      ? { transcriptOrigin: transcriptOrigin(item.transcriptOrigin) }
      : {}),
    ...(item.hasTranscript !== undefined
      ? { hasTranscript: item.hasTranscript as boolean }
      : {}),
    ...(item.chapterKind !== undefined
      ? { chapterKind: safeOptionalString(item.chapterKind, 64) }
      : {}),
    ...(item.chapterPosition !== undefined
      ? { chapterPosition: optionalNumber(item.chapterPosition, 1_000_000_000) }
      : {}),
    ...(item.chapterStatus !== undefined
      ? { chapterStatus: safeOptionalString(item.chapterStatus, 64) }
      : {}),
    ...(item.chapterGoalWords !== undefined
      ? { chapterGoalWords: optionalNumber(item.chapterGoalWords, 1_000_000_000) }
      : {}),
    ...(item.chapterSynopsis !== undefined
      ? { chapterSynopsis: safeText(item.chapterSynopsis, MAX_TEXT) }
      : {}),
    ...(item.chapterBeats !== undefined
      ? { chapterBeats: safeText(item.chapterBeats, MAX_TEXT) }
      : {}),
    ...(item.chapterNotes !== undefined
      ? { chapterNotes: safeText(item.chapterNotes, MAX_TEXT) }
      : {}),
    ...(item.parentId !== undefined ? { parentId: safeId(item.parentId) } : {}),
  };
}

function parseStateNotebook(raw: unknown): VaultStateNotebook {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) bad();
  const item = raw as Record<string, unknown>;
  const id = safeId(item.id);
  const name = safeOptionalString(item.name, MAX_TITLE);
  if (name === undefined || name.length === 0) bad();
  return {
    ...item,
    id,
    name,
    created_at: isoDate(item.created_at),
    updated_at: isoDate(item.updated_at),
    ...(item.color !== undefined ? { color: safeOptionalString(item.color, 64) } : {}),
    ...(item.kind !== undefined ? { kind: safeOptionalString(item.kind, 16) } : {}),
    ...(item.subtitle !== undefined ? { subtitle: safeText(item.subtitle, MAX_TEXT) } : {}),
    ...(item.author !== undefined ? { author: safeOptionalString(item.author, 128) } : {}),
    ...(item.synopsis !== undefined ? { synopsis: safeText(item.synopsis, MAX_TEXT) } : {}),
    ...(item.language !== undefined
      ? { language: safeOptionalString(item.language, 32) }
      : {}),
    ...(item.book_status !== undefined
      ? { book_status: safeOptionalString(item.book_status, 16) }
      : {}),
    ...(item.page_size !== undefined
      ? { page_size: safeOptionalString(item.page_size, 16) }
      : {}),
    ...(item.body_font !== undefined
      ? { body_font: safeOptionalString(item.body_font, 64) }
      : {}),
    ...(item.deadline !== undefined
      ? { deadline: safeOptionalString(item.deadline, 32) }
      : {}),
    ...(item.cover_updated_at !== undefined && item.cover_updated_at !== null
      ? { cover_updated_at: safeOptionalString(item.cover_updated_at, 64) }
      : {}),
  };
}

/**
 * Le o `state.enc` (retrato v2 do web). Diferente do v1, aqui qualquer
 * divergencia e erro: sobrescrever um retrato que nao entendemos apagaria o
 * estado do outro cliente.
 */
export function parseVaultState(text: string): VaultState {
  if (typeof text !== 'string' || utf8.encode(text).length > MAX_STATE_BYTES) bad();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    bad();
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) bad();
  const item = raw as Record<string, unknown>;
  if (item.version !== STATE_VERSION) bad('versao de estado desconhecida');
  const notes = item.notes;
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) bad();
  const seen = new Set<string>();
  const parsedNotes: VaultStateNote[] = [];
  for (const note of notes) {
    const clean = parseStateNote(note);
    if (seen.has(clean.id)) bad('estado com id repetido');
    seen.add(clean.id);
    parsedNotes.push(clean);
  }

  const rawNotebooks = item.notebooks;
  if (rawNotebooks !== undefined && !Array.isArray(rawNotebooks)) bad();
  if (Array.isArray(rawNotebooks) && rawNotebooks.length > MAX_NOTEBOOKS) bad();
  const notebookIds = new Set<string>();
  const notebooks: VaultStateNotebook[] = [];
  for (const notebook of Array.isArray(rawNotebooks) ? rawNotebooks : []) {
    const clean = parseStateNotebook(notebook);
    if (notebookIds.has(clean.id)) bad('estado com caderno repetido');
    notebookIds.add(clean.id);
    notebooks.push(clean);
  }

  const rawAnalyses = item.analyses;
  if (rawAnalyses !== undefined && !Array.isArray(rawAnalyses)) bad();
  if (Array.isArray(rawAnalyses) && rawAnalyses.length > MAX_ANALYSES) bad();
  const analyses: VaultStateAnalysis[] = [];
  for (const analysis of Array.isArray(rawAnalyses) ? rawAnalyses : []) {
    if (typeof analysis !== 'object' || analysis === null || Array.isArray(analysis)) continue;
    const row = analysis as Record<string, unknown>;
    if (typeof row.entry_id !== 'string' || row.entry_id.length === 0) continue;
    if (typeof row.analysis !== 'object' || row.analysis === null) continue;
    analyses.push(analysis as VaultStateAnalysis);
  }

  let settings: Record<string, unknown> | undefined;
  if (item.settings !== undefined) {
    if (typeof item.settings !== 'object' || item.settings === null || Array.isArray(item.settings)) {
      bad();
    }
    settings = item.settings as Record<string, unknown>;
  }

  const vaultId = item.vaultId;
  if (vaultId !== undefined && (typeof vaultId !== 'string' || vaultId.length > 64)) bad();
  const createdAt = isoDate(item.createdAt);
  return {
    version: STATE_VERSION,
    ...(typeof vaultId === 'string' ? { vaultId } : {}),
    createdAt,
    notes: parsedNotes,
    notebooks,
    ...(Array.isArray(rawAnalyses) ? { analyses } : {}),
    ...(settings !== undefined ? { settings } : {}),
  };
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

/** A mesma uniao do v1, para as notas do `state.enc`. */
export function mergeStateNotes(
  local: readonly VaultStateNote[],
  remote: readonly VaultStateNote[],
): VaultStateNote[] {
  const byId = new Map<string, VaultStateNote>();
  for (const note of remote) byId.set(note.id, note);
  for (const note of local) {
    const other = byId.get(note.id);
    if (!other || time(note.updatedAt) >= time(other.updatedAt)) byId.set(note.id, note);
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Cadernos: mesmo criterio, pelo `updated_at`; id diferente coexiste. */
export function mergeStateNotebooks(
  local: readonly VaultStateNotebook[],
  remote: readonly VaultStateNotebook[],
): VaultStateNotebook[] {
  const byId = new Map<string, VaultStateNotebook>();
  for (const notebook of remote) byId.set(notebook.id, notebook);
  for (const notebook of local) {
    const other = byId.get(notebook.id);
    if (!other || time(notebook.updated_at) >= time(other.updated_at)) {
      byId.set(notebook.id, notebook);
    }
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
  // No v1 esses campos nunca existem; no v2 vem a transcricao e o capitulo.
  const state = note as VaultStateNote;
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
    ...(state.transcript !== undefined ? { transcript: state.transcript } : {}),
    ...(state.transcriptLanguage !== undefined
      ? { transcriptLanguage: state.transcriptLanguage }
      : {}),
    ...(state.transcriptSegments !== undefined
      ? { transcriptSegments: state.transcriptSegments }
      : {}),
    ...(state.transcriptStatus !== undefined
      ? { transcriptStatus: state.transcriptStatus }
      : {}),
    ...(state.transcriptOrigin !== undefined
      ? { transcriptOrigin: state.transcriptOrigin }
      : {}),
    ...(state.hasTranscript !== undefined ? { hasTranscript: state.hasTranscript } : {}),
    ...(state.chapterKind !== undefined ? { chapterKind: state.chapterKind } : {}),
    ...(state.chapterPosition !== undefined ? { chapterPosition: state.chapterPosition } : {}),
    ...(state.chapterStatus !== undefined ? { chapterStatus: state.chapterStatus } : {}),
    ...(state.chapterGoalWords !== undefined
      ? { chapterGoalWords: state.chapterGoalWords }
      : {}),
    ...(state.chapterSynopsis !== undefined ? { chapterSynopsis: state.chapterSynopsis } : {}),
    ...(state.chapterBeats !== undefined ? { chapterBeats: state.chapterBeats } : {}),
    ...(state.chapterNotes !== undefined ? { chapterNotes: state.chapterNotes } : {}),
    ...(state.parentId !== undefined ? { captureSourceId: state.parentId } : {}),
  };
}
