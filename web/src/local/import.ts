/**
 * Importacao de um servidor para o cofre do navegador.
 *
 * Um sentido so: le o manifesto e as notas do ambiente antigo e grava no banco
 * local com o mesmo id. Rodar de novo atualiza, nunca duplica. Corpo vazio do
 * servidor nao apaga o texto que ja existe aqui.
 */

import {
  getRecording,
  updateRecordingNote,
  upsertRecording,
} from "../../../mobile/src/core/repo";
import type { Recording } from "../../../mobile/src/core/types";

import type { Entry } from "../types";

export interface ImportManifestEntry {
  id: string;
}

/** O que o importador precisa do outro lado. HTTP na web, dublê no teste. */
export interface ImportSource {
  manifest(cursor?: string): Promise<{ entries: ImportManifestEntry[]; next?: string }>;
  entry(id: string): Promise<Entry>;
  body(id: string): Promise<string>;
  deleted(): Promise<Entry[]>;
}

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  trashed: number;
  total: number;
}

/** Teto de paginas: 40 x 500 cobre qualquer biblioteca pessoal. */
const MAX_PAGINAS = 40;

function recordingFromEntry(entry: Entry, existente: Recording | null): Recording {
  const base: Recording = existente ?? {
    id: entry.id,
    title: entry.title,
    recordedAt: entry.recorded_at ?? entry.created_at,
    dir: "",
    segmentCount: 0,
    status: "completed",
    source: "text",
    offset: 0,
    attempts: 0,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
  return {
    ...base,
    id: entry.id,
    title: entry.title,
    recordedAt: entry.recorded_at ?? entry.created_at,
    notebookId: entry.notebook_id ?? base.notebookId,
    tags: entry.tags ?? base.tags,
    archived: entry.archived ?? base.archived,
    icon: entry.icon ?? base.icon,
    author: entry.author ?? base.author,
    // A fila de upload nao vem do servidor: aqui a nota ja e dado local.
    source: entry.source === "microphone" || entry.source === "share" ? entry.source : "text",
    status: "completed",
    updatedAt: entry.updated_at,
  };
}

export async function importEntries(
  source: ImportSource,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const manifesto: ImportManifestEntry[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const resposta = await source.manifest(cursor);
    manifesto.push(...(resposta.entries ?? []));
    cursor = resposta.next;
    if (!cursor) break;
  }

  const resultado: ImportResult = { created: 0, updated: 0, trashed: 0, total: manifesto.length };
  let done = 0;

  for (const item of manifesto) {
    const entry = await source.entry(item.id);
    const existente = await getRecording(entry.id);
    await upsertRecording(recordingFromEntry(entry, existente));

    const corpo = await source.body(entry.id);
    if (corpo.trim()) {
      await updateRecordingNote(entry.id, { text: corpo });
    }

    if (existente) resultado.updated += 1;
    else resultado.created += 1;

    done += 1;
    onProgress?.({ done, total: resultado.total });
  }

  for (const entry of await source.deleted()) {
    const existente = await getRecording(entry.id);
    const quando = entry.deleted_at ?? new Date().toISOString();
    await upsertRecording({ ...recordingFromEntry(entry, existente), deletedAt: quando });
    resultado.trashed += 1;
  }

  return resultado;
}
