import type { ChapterKind, ChapterStatus, Entry, Notebook, PageSize } from "../types";
import { bookFont, type BookFont } from "./bookFonts";

export const CHAPTER_KIND_LABEL: Record<ChapterKind, string> = {
  chapter: "Capítulo",
  part: "Parte",
  front: "Frontispício",
  back: "Posfácio",
};

export const CHAPTER_STATUS_LABEL: Record<Exclude<ChapterStatus, "">, string> = {
  draft: "Rascunho",
  revising: "Revisão",
  done: "Final",
};

/** Numero do capitulo entre os capitulos (partes/front/back nao contam). */
export function chapterNumber(chapters: Entry[], entryId: string): number {
  let number = 0;
  for (const chapter of orderedChapters(chapters)) {
    if (chapter.chapter_kind === "chapter") {
      number += 1;
      if (chapter.id === entryId) return number;
    }
  }
  return 0;
}

/** Lista viva ordenada por posicao; a ordem do servidor nao e a do livro. */
export function orderedChapters(chapters: Entry[]): Entry[] {
  return [...chapters].sort((a, b) => {
    const left = a.chapter_position ?? Number.MAX_SAFE_INTEGER;
    const right = b.chapter_position ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Agrupa a lista plana em partes com os capitulos que vem depois de cada uma. */
export function chapterGroups(chapters: Entry[]): Array<{ part: Entry | null; items: Entry[] }> {
  const groups: Array<{ part: Entry | null; items: Entry[] }> = [];
  for (const chapter of orderedChapters(chapters)) {
    if (chapter.chapter_kind === "part") {
      groups.push({ part: chapter, items: [] });
      continue;
    }
    if (groups.length === 0) {
      groups.push({ part: null, items: [] });
    }
    groups[groups.length - 1].items.push(chapter);
  }
  return groups;
}

export function formatWords(value: number, locale = "pt-BR"): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.round(value)));
}

/** Texto legivel sobre a cor da capa. */
export function coverInk(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return "#f6f4ef";
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#211e1a" : "#f6f4ef";
}

/** "1 capítulo" / "2 capítulos". */
export function countLabel(value: number, singular: string, plural: string): string {
  return `${formatWords(value)} ${value === 1 ? singular : plural}`;
}

export function progress(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

/** Sanitiza o nome do arquivo de exportacao sem perder acentos. */
export function bookFileName(title: string, preset: string, extension: string): string {
  const clean = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${clean || "livro"}-${preset}.${extension}`;
}

/**
 * Ultimo capitulo aberto neste navegador; sem ele, o primeiro nao finalizado.
 */
export function continueChapter(chapters: Entry[], lastOpenedId?: string): Entry | null {
  const ordered = orderedChapters(chapters).filter((chapter) => chapter.chapter_kind === "chapter");
  if (lastOpenedId) {
    const last = ordered.find((chapter) => chapter.id === lastOpenedId);
    if (last) return last;
  }
  return ordered.find((chapter) => chapter.chapter_status !== "done") ?? ordered[0] ?? null;
}

/* ---------- folha do livro ---------- */

/** Formatos de livro mostrados na criacao e nas configuracoes. A4 nao entra:
 *  e tamanho de documento/manuscrito, nao de livro. */
export const PAGE_SIZE_ORDER: PageSize[] = ["11x18", "14x21", "a5", "5x8", "6x9"];

/** Medidas reais de cada folha. O editor, a leitura e a exportacao usam as
 *  mesmas: o que se ve na tela e o que sai no PDF. */
export const PAGE_SIZES: Record<
  PageSize,
  { label: string; name: string; dims: string; short: string; widthMm: number; heightMm: number }
> = {
  "11x18": { label: "Bolso · 11 × 18 cm", name: "Bolso", dims: "11 × 18 cm", short: "11 × 18 cm", widthMm: 110, heightMm: 180 },
  "14x21": { label: "Romance · 14 × 21 cm", name: "Romance", dims: "14 × 21 cm", short: "14 × 21 cm", widthMm: 140, heightMm: 210 },
  a5: { label: "A5 · 14,8 × 21 cm", name: "A5", dims: "14,8 × 21 cm", short: "A5 · 14,8 × 21 cm", widthMm: 148, heightMm: 210 },
  "5x8": { label: "Livro · 5 × 8 pol", name: "5 × 8", dims: "5 × 8 pol", short: "5 × 8 pol", widthMm: 127, heightMm: 203.2 },
  "6x9": { label: "Livro · 6 × 9 pol", name: "6 × 9", dims: "6 × 9 pol", short: "6 × 9 pol", widthMm: 152.4, heightMm: 228.6 },
  // Mantido para livros antigos e para o preset de manuscrito; fora da lista de
  // formatos oferecidos na criacao.
  a4: { label: "A4 · 21 × 29,7 cm", name: "A4", dims: "21 × 29,7 cm", short: "A4", widthMm: 210, heightMm: 297 },
};

/** A fonte de corpo do livro, com a Newsreader como reserva. */
export function bookBodyFont(book: Notebook): BookFont {
  return bookFont(book.body_font);
}

/** 96 dpi: a mesma conta que o CSS e a impressao do navegador fazem. */
export const MM_TO_PX = 96 / 25.4;

export interface BookPage {
  size: PageSize;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  widthPx: number;
  heightPx: number;
  marginPx: number;
  bodyPx: number;
  leading: number;
}

/** A folha do livro, com os padroes seguros quando o caderno veio antigo. */
export function bookPage(book: {
  page_size?: PageSize;
  page_margin_mm?: number;
  body_px?: number;
  body_leading?: number;
}): BookPage {
  const size = book.page_size && PAGE_SIZES[book.page_size] ? book.page_size : "14x21";
  const measure = PAGE_SIZES[size];
  const marginMm = book.page_margin_mm && book.page_margin_mm > 0 ? book.page_margin_mm : 19;
  const bodyPx = book.body_px && book.body_px > 0 ? book.body_px : 18;
  const leading = book.body_leading && book.body_leading > 0 ? book.body_leading : 160;
  return {
    size,
    widthMm: measure.widthMm,
    heightMm: measure.heightMm,
    marginMm,
    widthPx: Math.round(measure.widthMm * MM_TO_PX),
    heightPx: Math.round(measure.heightMm * MM_TO_PX),
    marginPx: Math.round(marginMm * MM_TO_PX),
    bodyPx,
    leading: leading / 100,
  };
}

/** Beats do capitulo: uma linha por beat, vazios descartados. */
export function beatsOf(entry: Entry): string[] {
  return (entry.chapter_beats ?? "")
    .split("\n")
    .map((beat) => beat.trim())
    .filter(Boolean);
}

/** Dias ate o prazo; null quando nao ha prazo ou ele ja passou. */
export function daysUntil(deadline: string, now = new Date()): number | null {
  if (!deadline) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
  if (!match) return null;
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

/** Ritmo necessario para bater a meta no prazo. */
export function pace(totalWords: number, goalWords: number, deadline: string): {
  remaining: number;
  days: number;
  perDay: number;
} | null {
  if (goalWords <= 0) return null;
  const days = daysUntil(deadline);
  if (days === null) return null;
  const remaining = Math.max(0, goalWords - totalWords);
  return { remaining, days, perDay: Math.ceil(remaining / Math.max(1, days)) };
}

/** Palavras que cabem numa folha, a partir da medida e da tipografia. A conta
 *  e a mesma do editor: a largura util vira caracteres, as linhas cabem na
 *  altura util e cada linha leva cerca de seis palavras. */
export function wordsPerPage(page: BookPage): number {
  const textWidth = Math.max(120, page.widthPx - page.marginPx * 2);
  const textHeight = Math.max(120, page.heightPx - page.marginPx * 2);
  const charsPerLine = textWidth / Math.max(6, page.bodyPx * 0.5);
  const wordsPerLine = charsPerLine / 6;
  const linesPerPage = Math.max(1, Math.floor(textHeight / (page.bodyPx * Math.max(1, page.leading))));
  return Math.max(80, Math.round(wordsPerLine * linesPerPage));
}

/** Paginas aproximadas de um texto na folha do livro. O editor mostra a
 *  quebra exata; a casa usa esta estimativa para o numero do topo. */
export function estimatePages(words: number, page: BookPage): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / wordsPerPage(page)));
}

/** Inicial do dia da semana para a tira de ritmo. */
export function weekdayInitial(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { weekday: "narrow" });
}
