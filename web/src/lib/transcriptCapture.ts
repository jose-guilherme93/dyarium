/**
 * Transformar um trecho da transcricao em tarefa, ideia ou citacao.
 *
 * O contrato e o mesmo do app (`mobile/src/core/transcriptCapture`): o trecho
 * vira uma nota no caderno "Tarefas e ideias", com a tag do tipo. O app guarda
 * a marcacao no banco local; aqui ela fica neste navegador, porque o servidor
 * nao conhece capturas.
 */

import { api } from "../api";
import { formatDuration } from "./format";
import type { Segment } from "../types";
import {
  CAPTURE_NOTEBOOK,
  CAPTURE_OPTIONS,
  buildCapture,
  segmentText,
  type CaptureKind,
} from "../../../mobile/src/core/transcriptCapture";

export { CAPTURE_NOTEBOOK, CAPTURE_OPTIONS, segmentText, type CaptureKind };

const CAPTURE_KEY = "dyarium.transcript.captures";
const NOTE_KEY = "dyarium.capture.note";

type CaptureMap = Record<string, CaptureKind>;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sem localStorage: a marcacao vale so para esta sessao
  }
}

export function readCaptures(entryId: string): CaptureMap {
  return readJSON<CaptureMap>(`${CAPTURE_KEY}.${entryId}`, {});
}

export function markCaptured(entryId: string, startMs: number, kind: CaptureKind): void {
  const map = readCaptures(entryId);
  map[String(startMs)] = kind;
  writeJSON(`${CAPTURE_KEY}.${entryId}`, map);
}

function readCaptureNote(entryId: string): string {
  const map = readJSON<Record<string, string>>(NOTE_KEY, {});
  return map[entryId] ?? "";
}

function writeCaptureNote(entryId: string, captureEntryId: string): void {
  const map = readJSON<Record<string, string>>(NOTE_KEY, {});
  map[entryId] = captureEntryId;
  writeJSON(NOTE_KEY, map);
}

async function ensureNotebook(): Promise<string> {
  const { notebooks } = await api.listNotebooks();
  const existing = notebooks.find(
    (notebook) => notebook.name.trim().toLowerCase() === CAPTURE_NOTEBOOK.toLowerCase(),
  );
  if (existing) return existing.id;
  const created = await api.createNotebook({ name: CAPTURE_NOTEBOOK, color: "" });
  return created.id;
}

async function mergeTags(entryId: string, tag: string): Promise<void> {
  const { tags } = await api.listEntryTags(entryId);
  const names = tags.map((item) => item.name);
  if (!names.some((name) => name.toLowerCase() === tag.toLowerCase())) {
    names.push(tag);
  }
  await api.setEntryTags(entryId, names);
}

export interface CaptureResult {
  entryId: string;
  title: string;
}

/**
 * Grava a captura: uma nota por nota de origem, com os trechos acumulados. O
 * mapa em localStorage faz o papel do `captureSourceId` do app.
 */
export async function saveTranscriptCapture(input: {
  sourceEntryId: string;
  sourceTitle: string;
  segment: Segment;
  kind: CaptureKind;
}): Promise<CaptureResult> {
  const draft = buildCapture(input.kind, input.segment, {
    noteTitle: input.sourceTitle,
    stamp: formatDuration(input.segment.start_ms / 1000),
  });
  const notebookId = await ensureNotebook();

  let captureEntryId = readCaptureNote(input.sourceEntryId);
  if (captureEntryId) {
    try {
      await api.getEntry(captureEntryId);
    } catch {
      captureEntryId = "";
    }
  }

  if (!captureEntryId) {
    const created = await api.createEntry(draft.title, undefined, notebookId);
    await api.createNote(created.id, draft.title, draft.text);
    await mergeTags(created.id, draft.tag);
    writeCaptureNote(input.sourceEntryId, created.id);
    return { entryId: created.id, title: draft.title };
  }

  const entry = await api.getEntry(captureEntryId);
  if (entry.notebook_id !== notebookId) {
    await api.patchEntry(captureEntryId, { notebook_id: notebookId });
  }
  const { notes } = await api.listNotes(captureEntryId);
  const note = notes[0];
  if (!note) {
    await api.createNote(captureEntryId, draft.title, draft.text);
  } else {
    const current = (note.content_markdown ?? "").trim();
    if (!current.includes(draft.text)) {
      const merged = [current, draft.text].filter(Boolean).join("\n\n");
      await api.updateNote(note.id, merged, note.body_version);
    }
  }
  await mergeTags(captureEntryId, draft.tag);
  return { entryId: captureEntryId, title: entry.title };
}
