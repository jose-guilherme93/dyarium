/**
 * Regras do modo escritor que as telas de livro compartilham. Puro: nada de
 * banco nem de React, so a lista de capitulos (notas de um caderno `book`).
 */

import { noteStats } from './noteStats';
import type { Recording } from './types';

/** Rotulos curtos que a tela mostra; explicacao mora atras do toque. */
export const CHAPTER_LABELS = {
  kind: {
    chapter: 'Capítulo',
    part: 'Parte',
    front: 'Frontispício',
    back: 'Posfácio',
  },
  status: {
    draft: 'Rascunho',
    revising: 'Revisão',
    done: 'Finalizado',
  },
} as const;

/** Palavras por pagina na estimativa da casa. */
export const WORDS_PER_PAGE = 300;

/** Lista viva ordenada por posicao; a ordem do servidor nao e a do livro. */
export function orderedChapters(chapters: Recording[]): Recording[] {
  return [...chapters].sort((a, b) => {
    const left = a.chapterPosition ?? Number.MAX_SAFE_INTEGER;
    const right = b.chapterPosition ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    const byCreated = a.createdAt.localeCompare(b.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
}

export interface ChapterGroup {
  part: Recording | null;
  items: Recording[];
}

/** Agrupa a lista plana em partes com os capitulos que vem depois de cada uma. */
export function chapterGroups(chapters: Recording[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (const chapter of orderedChapters(chapters)) {
    if (chapter.chapterKind === 'part') {
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

/** Numero do capitulo entre os capitulos (partes/front/back nao contam). */
export function chapterNumber(chapters: Recording[], id: string): number {
  let number = 0;
  for (const chapter of orderedChapters(chapters)) {
    if (chapter.chapterKind !== 'chapter') continue;
    number += 1;
    if (chapter.id === id) return number;
  }
  return 0;
}

/** Soma a prosa do livro, ignorando as partes. */
export function bookWords(chapters: Recording[]): number {
  let words = 0;
  for (const chapter of chapters) {
    if (chapter.chapterKind === 'part') continue;
    words += noteStats(chapter.text ?? '').words;
  }
  return words;
}

/** Paginas aproximadas a 300 palavras por pagina. */
export function bookPages(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 0;
  return Math.ceil(words / WORDS_PER_PAGE);
}

/** Progresso da meta entre 0 e 100; meta zero nao divide. */
export function bookProgress(words: number, goal: number): number {
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  const percent = (Math.max(0, words) / goal) * 100;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/** Numero em pt-BR; negativo nao existe para contagem de palavras. */
export function formatWords(value: number, locale = 'pt-BR'): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.round(value)));
}

// --- Folha do livro: a mesma medida do dashboard ---------------------------
//
// O escritor do dashboard monta a folha em CSS px a 96 dpi (ver
// `web/src/lib/books.ts`). O app usa a mesma conta e escala a folha para a
// largura do aparelho, entao a quebra de linha e a proporcao continuam as da
// web.

/** 96 dpi: a mesma conta que o CSS e a impressao do navegador fazem. */
export const MM_TO_PX = 96 / 25.4;

export const PAGE_SIZES = {
  '11x18': { widthMm: 110, heightMm: 180 },
  '14x21': { widthMm: 140, heightMm: 210 },
  a5: { widthMm: 148, heightMm: 210 },
  '5x8': { widthMm: 127, heightMm: 203.2 },
  '6x9': { widthMm: 152.4, heightMm: 228.6 },
  a4: { widthMm: 210, heightMm: 297 },
} as const;

export type BookPageSize = keyof typeof PAGE_SIZES;

export interface BookPage {
  /** Largura da folha em CSS px a 96 dpi (o tamanho de referencia da web). */
  widthPx: number;
  /** Altura da folha em CSS px a 96 dpi. */
  heightPx: number;
  /** Margem em CSS px a 96 dpi. */
  marginPx: number;
  /** Corpo do texto em CSS px a 96 dpi. */
  bodyPx: number;
  /** Entrelinha como multiplicador (160 -> 1.6). */
  leading: number;
  widthMm: number;
  heightMm: number;
}

/** Folha do livro com os defaults do dashboard. */
export function bookPage(book: {
  pageSize?: string;
  pageMarginMm?: number;
  bodyPx?: number;
  bodyLeading?: number;
}): BookPage {
  const size = (book.pageSize && PAGE_SIZES[book.pageSize as BookPageSize]) || PAGE_SIZES['14x21'];
  const marginMm = book.pageMarginMm && book.pageMarginMm > 0 ? book.pageMarginMm : 19;
  const bodyPx = book.bodyPx && book.bodyPx > 0 ? book.bodyPx : 18;
  const leading = book.bodyLeading && book.bodyLeading > 0 ? book.bodyLeading : 160;
  return {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    widthPx: Math.round(size.widthMm * MM_TO_PX),
    heightPx: Math.round(size.heightMm * MM_TO_PX),
    marginPx: Math.round(marginMm * MM_TO_PX),
    bodyPx,
    leading: leading / 100,
  };
}

/**
 * Familia do corpo do livro. Só a Newsreader viaja no bundle do app: as outras
 * opcoes do escritor caem nela ate os arquivos serem empacotados.
 */
export function bookBodyFamily(_bodyFont?: string): string {
  return 'Newsreader';
}

/** Altura da linha do corpo, em px, na folha de referencia da web. */
export function lineHeightPx(page: BookPage): number {
  return page.bodyPx * page.leading;
}

export interface PageWindow {
  /** Altura util de uma pagina, em px de tela. */
  contentHeight: number;
  /** Altura de uma linha, em px de tela. */
  lineHeight: number;
  /** Quantas linhas inteiras cabem numa pagina. */
  linesPerPage: number;
  /** Altura consumida por pagina (linhas inteiras, sem sobra). */
  pageTextHeight: number;
}

/**
 * Janela de linhas de uma pagina: a quebra cai sempre entre duas linhas, como
 * no `paginate` do dashboard. `contentHeight` e `lineHeight` ja na escala da
 * tela.
 */
export function pageWindow(contentHeight: number, lineHeight: number): PageWindow {
  const safeLine = lineHeight > 0 ? lineHeight : 1;
  const usable = Math.max(0, contentHeight);
  const linesPerPage = Math.max(1, Math.floor((usable + 0.5) / safeLine));
  return {
    contentHeight: usable,
    lineHeight: safeLine,
    linesPerPage,
    pageTextHeight: linesPerPage * safeLine,
  };
}

/** Numero de paginas para uma altura total de texto medida na tela. */
export function pageCount(totalHeight: number, window: PageWindow): number {
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) return 1;
  return Math.max(1, Math.ceil((totalHeight - 0.5) / window.pageTextHeight));
}
