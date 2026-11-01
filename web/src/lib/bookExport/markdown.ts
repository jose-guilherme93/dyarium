import type { BookExportInput } from "./types";

/** Exportacao simples: um arquivo, ordem do livro, corpo markdown intacto. */
export function exportMarkdown(input: BookExportInput): string {
  const { book } = input;
  const chapters = input.chapters.filter(
    (chapter) => chapter.entry.chapter_kind === "part" || chapter.words > 0,
  );
  const lines: string[] = [`# ${book.name}`];
  if (book.subtitle.trim()) lines.push("", `_${book.subtitle.trim()}_`);
  if (book.author.trim()) lines.push("", book.author.trim());
  for (const chapter of chapters) {
    lines.push("", "---", "");
    const title = chapter.entry.title || "Sem título";
    if (chapter.entry.chapter_kind === "part") {
      lines.push(`# ${title}`);
    } else {
      lines.push(`## ${title}`);
    }
    if (chapter.entry.chapter_synopsis?.trim()) {
      lines.push("", `> ${chapter.entry.chapter_synopsis.trim()}`);
    }
    const body = chapter.markdown.trim();
    if (body) lines.push("", body);
  }
  return `${lines.join("\n")}\n`;
}
