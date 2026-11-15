/**
 * Cadernos e livros no cofre local.
 *
 * Usa a mesma tabela `notebooks` do app. O app ainda nao mostra livro, entao as
 * colunas do modo escritor vivem aqui e no servidor; quando o app abrir o
 * leitor, esta camada sobe para o nucleo como as demais.
 */

import { newId } from "../../../mobile/src/core/id";
import { getDb } from "../../../mobile/src/core/port";
import { DEFAULT_NOTEBOOK_ID } from "../../../mobile/src/core/notebooks";

import type { BookFontId } from "../lib/bookFonts";
import type { BookStatus, Notebook, PageSize } from "../types";

interface NotebookRow {
  id: string;
  name: string;
  color: string;
  is_default: number;
  kind: string;
  created_at: string;
  updated_at: string;
  subtitle: string;
  author: string;
  synopsis: string;
  language: string;
  goal_words: number;
  book_status: string;
  page_size: string;
  page_margin_mm: number;
  body_px: number;
  body_leading: number;
  body_font: string;
  daily_goal_words: number;
  deadline: string;
  has_cover: number;
  cover_updated_at: string;
}

export interface NotebookInput {
  id?: string;
  name: string;
  color: string;
  kind?: "notes" | "book";
  subtitle?: string;
  author?: string;
  synopsis?: string;
  language?: string;
  goal_words?: number;
  book_status?: BookStatus;
  page_size?: PageSize;
  page_margin_mm?: number;
  body_px?: number;
  body_leading?: number;
  body_font?: BookFontId;
  daily_goal_words?: number;
  deadline?: string;
}

const COLUNAS = [
  "name",
  "color",
  "kind",
  "subtitle",
  "author",
  "synopsis",
  "language",
  "goal_words",
  "book_status",
  "page_size",
  "page_margin_mm",
  "body_px",
  "body_leading",
  "body_font",
  "daily_goal_words",
  "deadline",
] as const;

function toNotebook(row: NotebookRow, counts: Map<string, number>): Notebook {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    is_default: row.is_default !== 0,
    kind: row.kind === "book" ? "book" : "notes",
    subtitle: row.subtitle ?? "",
    author: row.author ?? "",
    synopsis: row.synopsis ?? "",
    language: row.language ?? "",
    goal_words: row.goal_words ?? 0,
    book_status: (row.book_status || "drafting") as BookStatus,
    page_size: (row.page_size || undefined) as PageSize | undefined,
    page_margin_mm: row.page_margin_mm || undefined,
    body_px: row.body_px || undefined,
    body_leading: row.body_leading || undefined,
    body_font: (row.body_font || undefined) as BookFontId | undefined,
    daily_goal_words: row.daily_goal_words || undefined,
    deadline: row.deadline ?? "",
    has_cover: row.has_cover !== 0,
    cover_updated_at: row.cover_updated_at || null,
    entry_count: counts.get(row.id) ?? 0,
    chapter_count: 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function countsByNotebook(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ notebook_id: string | null; total: number }>(
    `SELECT notebook_id, COUNT(*) AS total FROM recordings
     WHERE deleted_at IS NULL GROUP BY notebook_id`,
  );
  const mapa = new Map<string, number>();
  for (const row of rows) {
    mapa.set(row.notebook_id ?? DEFAULT_NOTEBOOK_ID, row.total);
  }
  return mapa;
}

export async function listLocalNotebooks(): Promise<Notebook[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<NotebookRow>(
    `SELECT * FROM notebooks WHERE deleted = 0
     ORDER BY is_default DESC, created_at ASC, id ASC`,
  );
  const counts = await countsByNotebook();
  return rows.map((row) => toNotebook(row, counts));
}

export async function getLocalNotebook(id: string): Promise<Notebook | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<NotebookRow>(
    "SELECT * FROM notebooks WHERE id = ? AND deleted = 0",
    [id],
  );
  if (!row) return null;
  return toNotebook(row, await countsByNotebook());
}

export async function createLocalNotebook(input: NotebookInput): Promise<Notebook> {
  const db = await getDb();
  const agora = new Date().toISOString();
  const id = input.id?.trim() || newId("nb_");
  await db.runAsync(
    `INSERT INTO notebooks (
       id, name, color, is_default, kind, created_at, updated_at, dirty, synced, deleted,
       subtitle, author, synopsis, language, goal_words, book_status, page_size, page_margin_mm,
       body_px, body_leading, body_font, daily_goal_words, deadline
     ) VALUES (?,?,?,0,?,?,?,1,0,0,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.name,
      input.color ?? "",
      input.kind === "book" ? "book" : "notes",
      agora,
      agora,
      input.subtitle ?? "",
      input.author ?? "",
      input.synopsis ?? "",
      input.language ?? "",
      input.goal_words ?? 0,
      input.book_status ?? "drafting",
      input.page_size ?? "",
      input.page_margin_mm ?? 0,
      input.body_px ?? 0,
      input.body_leading ?? 0,
      input.body_font ?? "",
      input.daily_goal_words ?? 0,
      input.deadline ?? "",
    ],
  );
  const criado = await getLocalNotebook(id);
  if (!criado) throw new Error("caderno nao foi gravado");
  return criado;
}

export async function updateLocalNotebook(
  id: string,
  patch: Record<string, unknown>,
): Promise<Notebook> {
  const db = await getDb();
  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const coluna of COLUNAS) {
    if (!(coluna in patch)) continue;
    sets.push(`${coluna} = ?`);
    valores.push(patch[coluna] ?? "");
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?", "dirty = 1");
    valores.push(new Date().toISOString(), id);
    await db.runAsync(`UPDATE notebooks SET ${sets.join(", ")} WHERE id = ?`, valores);
  }
  const atualizado = await getLocalNotebook(id);
  if (!atualizado) throw new Error("caderno nao encontrado");
  return atualizado;
}

/** Apaga o caderno e devolve as notas para o caderno padrao. */
export async function deleteLocalNotebook(id: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ is_default: number }>(
    "SELECT is_default FROM notebooks WHERE id = ? AND deleted = 0",
    [id],
  );
  if (!row) return;
  if (row.is_default !== 0) throw new Error("o caderno padrao nao pode ser apagado");
  const agora = new Date().toISOString();
  await db.runAsync(
    "UPDATE recordings SET notebook_id = ?, updated_at = ? WHERE notebook_id = ?",
    [DEFAULT_NOTEBOOK_ID, agora, id],
  );
  await db.runAsync("UPDATE notebooks SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?", [
    agora,
    id,
  ]);
}
