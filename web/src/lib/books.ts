import type { ChapterKind, ChapterStatus, Entry } from "../types";

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
