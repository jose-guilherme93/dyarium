import { exportDocx } from "./docx";
import { exportHtml } from "./html";
import { exportMarkdown } from "./markdown";
import type { BookExportInput, ExportSummary } from "./types";

export * from "./types";
export { exportDocx, buildDocx } from "./docx";
export { exportHtml, markdownToHtml } from "./html";
export { exportMarkdown } from "./markdown";

export function exportSummary(input: BookExportInput): ExportSummary {
  const usable = input.chapters.filter(
    (chapter) => chapter.entry.chapter_kind === "part" || chapter.words > 0,
  );
  const words = usable.reduce((sum, chapter) => sum + chapter.words, 0);
  const empty = input.chapters.filter(
    (chapter) => chapter.entry.chapter_kind !== "part" && chapter.words === 0,
  ).length;
  return {
    chapters: usable.filter((chapter) => chapter.entry.chapter_kind !== "part").length,
    words,
    pages: Math.max(1, Math.ceil(words / 300)),
    empty,
    ignoredImages: 0,
  };
}

/** Gera o arquivo no formato escolhido. DOCX devolve tambem as imagens ignoradas. */
export async function exportBook(
  input: BookExportInput,
): Promise<{ data: Uint8Array | string; ignoredImages: number }> {
  if (input.options.format === "docx") {
    return exportDocx(input);
  }
  if (input.options.format === "markdown") {
    return { data: exportMarkdown(input), ignoredImages: 0 };
  }
  return { data: exportHtml(input).html, ignoredImages: 0 };
}
