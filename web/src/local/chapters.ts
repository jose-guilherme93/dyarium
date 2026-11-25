/**
 * Capitulos, ordem e ritmo do livro no cofre local.
 *
 * Um capitulo e a mesma linha de `recordings` que uma nota: tipo, posicao e
 * anotacoes sao colunas proprias. O ritmo vive em `writing_days`, somando as
 * palavras liquidas do dia como o servidor faz — apagar tambem conta, para
 * "hoje" mostrar o que a sessao escreveu, nao o tamanho do texto.
 */

import {
  addWritingWords,
  listWritingDays,
  replaceChapterOrder,
  updateChapterFields,
  type ChapterFields,
} from "../../../mobile/src/core/repo";

import { markdownToPlain } from "../editor/blocknoteMarkdown";
import type { ChapterKind, ChapterStatus, WritingRhythm } from "../types";
import { getLocalNotebook } from "./notebooks";

/** Palavras de prosa: o markdown vira texto antes de contar. */
export function wordsIn(markdown: string): number {
  const plano = markdownToPlain(markdown);
  return plano ? plano.split(/\s+/).filter(Boolean).length : 0;
}

/** Dia local, que e o dia que o escritor ve no relogio. */
export function todayKey(now = new Date()): string {
  const mes = String(now.getMonth() + 1).padStart(2, "0");
  const dia = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mes}-${dia}`;
}

/**
 * Soma a diferenca de palavras de uma edicao no dia. So livro entra no ritmo:
 * caderno comum nao tem meta e nao interessa na faixa de escrita.
 */
export async function registerWriting(
  notebookId: string,
  before: string,
  after: string,
): Promise<void> {
  const delta = wordsIn(after) - wordsIn(before);
  if (delta === 0) return;
  const caderno = await getLocalNotebook(notebookId);
  if (caderno?.kind !== "book") return;
  await addWritingWords(notebookId, todayKey(), delta);
}

export interface ChapterPatch {
  chapter_status?: ChapterStatus;
  chapter_goal_words?: number;
  chapter_synopsis?: string;
  chapter_beats?: string;
  chapter_notes?: string;
}

/** Grava so os campos enviados: o painel do capitulo manda um por vez. */
export async function patchChapter(id: string, patch: ChapterPatch): Promise<void> {
  const fields: ChapterFields = {};
  if (patch.chapter_status !== undefined) fields.chapterStatus = patch.chapter_status;
  if (patch.chapter_goal_words !== undefined) fields.chapterGoalWords = patch.chapter_goal_words;
  if (patch.chapter_synopsis !== undefined) fields.chapterSynopsis = patch.chapter_synopsis;
  if (patch.chapter_beats !== undefined) fields.chapterBeats = patch.chapter_beats;
  if (patch.chapter_notes !== undefined) fields.chapterNotes = patch.chapter_notes;
  await updateChapterFields(id, fields);
}

export interface ChapterOrderItem {
  entry_id: string;
  chapter_kind: ChapterKind;
  chapter_status: ChapterStatus;
  position: number;
}

/** A lista inteira vira uma escrita so: metade reordenada nunca aparece. */
export async function reorderChapters(
  notebookId: string,
  chapters: ChapterOrderItem[],
): Promise<void> {
  await replaceChapterOrder(
    notebookId,
    chapters.map((chapter) => ({
      id: chapter.entry_id,
      chapterKind: chapter.chapter_kind,
      chapterStatus: chapter.chapter_status,
      position: chapter.position,
    })),
  );
}

/**
 * Ritmo do livro: os ultimos dias, as palavras de hoje, a meta diaria e o prazo.
 * Dias sem escrita vem com zero para a faixa nao encolher.
 */
export async function writingRhythm(bookId: string, days = 7): Promise<WritingRhythm> {
  const [livro, serie] = await Promise.all([
    getLocalNotebook(bookId),
    listWritingDays(bookId, days),
  ]);
  return {
    today: serie[serie.length - 1]?.words ?? 0,
    days: serie,
    daily_goal: livro?.daily_goal_words ?? 0,
    deadline: livro?.deadline ?? "",
    goal_words: livro?.goal_words ?? 0,
  };
}
