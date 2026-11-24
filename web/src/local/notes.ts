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
  nextChapterPosition,
  updateChapterFields,
  updateRecordingNote,
  upsertRecording,
} from "../../../mobile/src/core/repo";
import type { Recording } from "../../../mobile/src/core/types";

import { patchChapter, registerWriting, wordsIn, type ChapterPatch } from "./chapters";
import { bookNotebookIds } from "./notebooks";
import type { EntryFilters } from "../api";
import type {
  AuthorRole,
  ChapterKind,
  ChapterStatus,
  Entry,
  Note,
  Notebook,
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

export function toEntry(recording: Recording, withWords = false): Entry {
  const corpo = recording.text ?? recording.transcript ?? "";
  const capitulo = recording.chapterKind ?? "";
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
    chapter_kind: capitulo as ChapterKind | "",
    chapter_position: recording.chapterPosition ?? null,
    chapter_status: (recording.chapterStatus || undefined) as ChapterStatus | undefined,
    chapter_goal_words: recording.chapterGoalWords ?? 0,
    chapter_synopsis: recording.chapterSynopsis ?? "",
    chapter_beats: recording.chapterBeats ?? "",
    chapter_notes: recording.chapterNotes ?? "",
    // Palavras so quando a lista pede (livro) ou quando a nota e capitulo:
    // a lista do diario nao paga a conta.
    word_count: withWords || capitulo ? wordsIn(recording.text ?? "") : undefined,
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
  const pedePalavras = filters?.include_words === true;
  // O diario nao mostra livro. Os ids sao lidos uma vez; filtrar nota a nota
  // pagaria uma consulta por entrada.
  const livros = filters?.exclude_books === true ? await bookNotebookIds() : null;
  const lista = all
    .filter((recording) => pertence(recording, filters))
    .filter((recording) => !livros?.has(recording.notebookId ?? NOTEBOOK_PADRAO))
    .map((recording) => toEntry(recording, pedePalavras));
  return filters?.limit ? lista.slice(0, filters.limit) : lista;
}

export async function listDeletedEntries(): Promise<Entry[]> {
  return (await listTrashedRecordings()).map((recording) => toEntry(recording));
}

export async function getEntry(id: string): Promise<Entry | null> {
  const recording = await getRecording(id);
  return recording ? toEntry(recording, Boolean(recording.chapterKind)) : null;
}

export interface CreateEntryInput {
  title: string;
  notebookId?: string;
  /** Tipo do capitulo quando a nota nasce dentro de um livro. */
  kind?: ChapterKind;
  /** Id vindo de fora (import do Notion): reimportar cai na mesma nota. */
  id?: string;
  /** Data do evento, quando o import ja a conhece. */
  recordedAt?: string;
}

export async function createEntry({
  title,
  notebookId,
  kind,
  id,
  recordedAt,
}: CreateEntryInput): Promise<Entry> {
  const agora = new Date().toISOString();
  const caderno = notebookId ?? NOTEBOOK_PADRAO;
  // A posicao vem do fim da lista do livro: entrar no meio depende do arrastar,
  // que reescreve a lista inteira.
  const posicao = kind ? await nextChapterPosition(caderno) : 0;
  const recording: Recording = {
    id: id?.trim() || newId("note_"),
    title,
    recordedAt: recordedAt ?? agora,
    dir: "",
    segmentCount: 0,
    status: "completed",
    source: "text",
    offset: 0,
    attempts: 0,
    notebookId: caderno,
    createdAt: agora,
    updatedAt: agora,
    text: "",
    ...(kind
      ? { chapterKind: kind, chapterPosition: posicao, chapterStatus: "draft" as ChapterStatus }
      : {}),
  };
  await upsertRecording(recording);
  if (kind) {
    // O upsert nao conhece as colunas do escritor: elas seguem pela escrita
    // dedicada, para nao mexer no SQL que o app usa todo dia.
    await updateChapterFields(recording.id, {
      chapterKind: kind,
      chapterPosition: posicao,
      chapterStatus: "draft",
    });
  }
  return toEntry(recording, Boolean(kind));
}

export interface EntryPatch {
  title?: string;
  recorded_at?: string;
  notebook_id?: string;
  archived?: boolean;
  author?: AuthorRole;
  icon?: string;
  summary_detail?: SummaryDetail;
  chapter_status?: ChapterStatus;
  chapter_goal_words?: number;
  chapter_synopsis?: string;
  chapter_beats?: string;
  chapter_notes?: string;
}

export async function patchEntry(id: string, patch: EntryPatch): Promise<Entry | null> {
  const recording = await getRecording(id);
  if (!recording) return null;

  // Campos do capitulo tem escrita propria; o resto continua no upsert.
  const capitulo: ChapterPatch = {};
  if (patch.chapter_status !== undefined) capitulo.chapter_status = patch.chapter_status;
  if (patch.chapter_goal_words !== undefined) capitulo.chapter_goal_words = patch.chapter_goal_words;
  if (patch.chapter_synopsis !== undefined) capitulo.chapter_synopsis = patch.chapter_synopsis;
  if (patch.chapter_beats !== undefined) capitulo.chapter_beats = patch.chapter_beats;
  if (patch.chapter_notes !== undefined) capitulo.chapter_notes = patch.chapter_notes;
  if (Object.keys(capitulo).length > 0) await patchChapter(id, capitulo);

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
  const antes = await getRecording(noteId);
  await updateRecordingNote(noteId, { text: markdown });
  const recording = await getRecording(noteId);
  if (recording) {
    // O ritmo conta a diferenca da edicao, nao o tamanho do texto.
    await registerWriting(recording.notebookId ?? NOTEBOOK_PADRAO, antes?.text ?? "", markdown);
  }
  return recording ? toNote(recording) : null;
}

export async function createNote(
  entryId: string,
  title: string,
  markdown: string,
): Promise<Note | null> {
  // No servidor o titulo da nota e um campo separado da entrada; aqui os dois
  // sao o mesmo. Titulo vazio significa "nao mexe", nunca "apaga o nome".
  const corpo = title.trim() ? { title, text: markdown } : { text: markdown };
  await updateRecordingNote(entryId, corpo);
  const recording = await getRecording(entryId);
  if (recording) {
    await registerWriting(recording.notebookId ?? NOTEBOOK_PADRAO, "", markdown);
  }
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

