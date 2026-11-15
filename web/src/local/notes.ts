/**
 * Camada local da web: traduz o nucleo (`Recording`) para o formato que a
 * interface ja usa (`Entry`, `Note`, `Notebook`).
 *
 * A interface nao sabe de onde vem o dado. Com token, `api.ts` fala com o
 * servidor; sem token, fala com o cofre do navegador por estas funcoes.
 */

import { DEFAULT_NOTEBOOK_ID } from "../../../mobile/src/core/notebooks";
import { newId } from "../../../mobile/src/core/id";
import {
  getRecording,
  listRecordings,
  listTrashedRecordings,
  updateRecordingNote,
  upsertRecording,
} from "../../../mobile/src/core/repo";
import type { Recording } from "../../../mobile/src/core/types";

import type { EntryFilters } from "../api";
import type {
  AuthorRole,
  Entry,
  Note,
  Notebook,
  Settings,
  SummaryDetail,
  Tag,
} from "../types";

const NOTEBOOK_PADRAO = DEFAULT_NOTEBOOK_ID;

/** Status do app (`draft…completed`) para os rotulos que a web conhece. */
function entryStatus(status: string): string {
  if (status === "completed") return "ready";
  if (status === "failed") return "failed";
  return status;
}

export function toEntry(recording: Recording): Entry {
  const corpo = recording.text ?? recording.transcript ?? "";
  return {
    id: recording.id,
    title: recording.title,
    status: entryStatus(recording.status),
    source: recording.source ?? "text",
    notebook_id: recording.notebookId ?? NOTEBOOK_PADRAO,
    original_filename: recording.fileName ?? "",
    content_type: recording.contentType ?? "",
    size_bytes: recording.sizeBytes ?? 0,
    duration_seconds: (recording.durationMs ?? 0) / 1000,
    sha256: "",
    recorded_at: recording.recordedAt,
    created_at: recording.createdAt,
    updated_at: recording.updatedAt,
    tags: recording.tags ?? [],
    preview: corpo.slice(0, 140),
    versions: {
      title: recording.titleVersion,
      recorded_at: recording.recordedAtVersion,
      body: recording.bodyVersion,
    },
    archived: recording.archived ?? false,
    author: recording.author,
    deleted_at: recording.deletedAt ?? null,
    icon: recording.icon,
    summary_detail: recording.summaryDetail,
  };
}

export function toNote(recording: Recording): Note {
  return {
    id: recording.id,
    entry_id: recording.id,
    title: recording.title,
    content_markdown: recording.text ?? "",
    body_version: recording.bodyVersion,
    created_at: recording.createdAt,
    updated_at: recording.updatedAt,
  };
}

function pertence(recording: Recording, filters?: EntryFilters): boolean {
  if (!filters) return true;
  if (filters.notebook_id && (recording.notebookId ?? NOTEBOOK_PADRAO) !== filters.notebook_id) {
    return false;
  }
  if (filters.archived === true && !recording.archived) return false;
  if (filters.archived === false && recording.archived) return false;
  return true;
}

export async function listEntries(filters?: EntryFilters): Promise<Entry[]> {
  const all = await listRecordings(false);
  const lista = all.filter((recording) => pertence(recording, filters)).map(toEntry);
  return filters?.limit ? lista.slice(0, filters.limit) : lista;
}

export async function listDeletedEntries(): Promise<Entry[]> {
  return (await listTrashedRecordings()).map(toEntry);
}

export async function getEntry(id: string): Promise<Entry | null> {
  const recording = await getRecording(id);
  return recording ? toEntry(recording) : null;
}

export interface CreateEntryInput {
  title: string;
  notebookId?: string;
}

export async function createEntry({ title, notebookId }: CreateEntryInput): Promise<Entry> {
  const agora = new Date().toISOString();
  const recording: Recording = {
    id: newId("note_"),
    title,
    recordedAt: agora,
    dir: "",
    segmentCount: 0,
    status: "completed",
    source: "text",
    offset: 0,
    attempts: 0,
    notebookId: notebookId ?? NOTEBOOK_PADRAO,
    createdAt: agora,
    updatedAt: agora,
    text: "",
  };
  await upsertRecording(recording);
  return toEntry(recording);
}

export interface EntryPatch {
  title?: string;
  recorded_at?: string;
  notebook_id?: string;
  archived?: boolean;
  author?: AuthorRole;
  icon?: string;
  summary_detail?: SummaryDetail;
}

export async function patchEntry(id: string, patch: EntryPatch): Promise<Entry | null> {
  const recording = await getRecording(id);
  if (!recording) return null;
  const atualizado: Recording = {
    ...recording,
    title: patch.title ?? recording.title,
    recordedAt: patch.recorded_at ?? recording.recordedAt,
    notebookId: patch.notebook_id ?? recording.notebookId,
    archived: patch.archived ?? recording.archived,
    author: patch.author ?? recording.author,
    icon: patch.icon ?? recording.icon,
    summaryDetail: patch.summary_detail ?? recording.summaryDetail,
    updatedAt: new Date().toISOString(),
  };
  await upsertRecording(atualizado);
  return toEntry(atualizado);
}

/** Lixeira: marca `deleted_at`, igual ao app; o conteudo continua no cofre. */
export async function deleteEntry(id: string): Promise<void> {
  const recording = await getRecording(id);
  if (!recording) return;
  await upsertRecording({
    ...recording,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function restoreEntry(id: string): Promise<Entry | null> {
  const recording = await getRecording(id);
  if (!recording) return null;
  const restaurado: Recording = {
    ...recording,
    deletedAt: undefined,
    updatedAt: new Date().toISOString(),
  };
  await upsertRecording(restaurado);
  return toEntry(restaurado);
}

export async function listNotes(entryId: string): Promise<Note[]> {
  const recording = await getRecording(entryId);
  return recording ? [toNote(recording)] : [];
}

/** O corpo da nota mora em `recordings.text`; a nota nao tem id proprio aqui. */
export async function saveNote(noteId: string, markdown: string): Promise<Note | null> {
  await updateRecordingNote(noteId, { text: markdown });
  const recording = await getRecording(noteId);
  return recording ? toNote(recording) : null;
}

export async function createNote(
  entryId: string,
  title: string,
  markdown: string,
): Promise<Note | null> {
  await updateRecordingNote(entryId, { title, text: markdown });
  const recording = await getRecording(entryId);
  return recording ? toNote(recording) : null;
}

export async function listTags(): Promise<Tag[]> {
  const all = await listRecordings(false);
  const contagem = new Map<string, number>();
  for (const recording of all) {
    for (const tag of recording.tags ?? []) {
      contagem.set(tag, (contagem.get(tag) ?? 0) + 1);
    }
  }
  return [...contagem.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry_count]) => ({ id: name, name, color: "", entry_count }));
}

export async function entryTags(entryId: string): Promise<string[]> {
  const recording = await getRecording(entryId);
  return recording?.tags ?? [];
}

export async function setEntryTags(entryId: string, tags: string[]): Promise<void> {
  const recording = await getRecording(entryId);
  if (!recording) return;
  await upsertRecording({ ...recording, tags, updatedAt: new Date().toISOString() });
}

function notebook(id: string, name: string): Notebook {
  const agora = new Date().toISOString();
  return {
    id,
    name,
    color: "",
    is_default: id === NOTEBOOK_PADRAO,
    kind: "notes",
    subtitle: "",
    author: "",
    synopsis: "",
    language: "",
    goal_words: 0,
    book_status: "drafting",
    entry_count: 0,
    chapter_count: 0,
    created_at: agora,
    updated_at: agora,
  };
}

/**
 * O nucleo ainda nao tem CRUD de cadernos. No cofre local a lista nasce com o
 * caderno padrao e ganha um nome por caderno que as notas usem.
 */
export async function listNotebooks(): Promise<Notebook[]> {
  const all = await listRecordings(false);
  const vistos = new Set(all.map((recording) => recording.notebookId ?? NOTEBOOK_PADRAO));
  vistos.delete(NOTEBOOK_PADRAO);
  return [notebook(NOTEBOOK_PADRAO, "Notas ao acaso"), ...[...vistos].map((id) => notebook(id, id))];
}

export function settings(): Settings {
  return {
    owner_name: "",
    all_notes_mine: true,
    trim_silence: false,
    max_whisper_rss_mb: 0,
    whisper_model: "",
    whisper_language: "",
    transcribe_provider: "",
    deepgram_model: "",
    deepgram_api_key_set: false,
    analyze_enabled: false,
    analyze_provider: "",
    analyze_local_runtime: "",
    analyze_base_url: "",
    analyze_model: "",
    analyze_api_key_set: false,
    analysis_themes: "",
    review_enabled: false,
    literal_transcript: false,
  };
}
