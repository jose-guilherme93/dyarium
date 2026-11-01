import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocx, exportHtml, exportMarkdown, exportSummary, DEFAULT_EXPORT_OPTIONS } from "./bookExport";
import type { BookExportInput } from "./bookExport";
import type { Entry, Notebook } from "../types";

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "e",
    title: "Capítulo",
    status: "ready",
    source: "text",
    original_filename: "",
    content_type: "",
    size_bytes: 0,
    duration_seconds: 0,
    sha256: "",
    recorded_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    chapter_kind: "chapter",
    ...overrides,
  };
}

const book: Notebook = {
  id: "nb",
  name: "O nome do vento",
  color: "#C7D8F2",
  is_default: false,
  kind: "book",
  subtitle: "Volume I",
  author: "Ana",
  synopsis: "",
  language: "pt-BR",
  goal_words: 90000,
  book_status: "drafting",
  entry_count: 3,
  chapter_count: 3,
  words: 12,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const input: BookExportInput = {
  book,
  chapters: [
    {
      entry: entry({ id: "p", title: "Parte I", chapter_kind: "part" }),
      markdown: "",
      words: 0,
    },
    {
      entry: entry({ id: "c1", title: "A ponte" }),
      markdown: "# Cena\n\nUma frase **forte**.\n\n- item",
      words: 5,
    },
  ],
  options: DEFAULT_EXPORT_OPTIONS,
};

function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

describe("exportação do livro", () => {
  it("DOCX traz título, sumário, headings, quebra e estilos", () => {
    const files = unzipSync(buildDocx(input));
    const document = decode(files["word/document.xml"]);
    expect(document).toContain("O nome do vento");
    expect(document).toContain("Sumário");
    expect(document).toContain("Heading1");
    expect(document).toContain("Heading2");
    expect(document).toContain("w:br w:type=\"page\"");
    expect(document).toContain("A ponte");
    expect(document).toContain("Uma frase");
    expect(document).toContain("w:sectPr");
    expect(decode(files["word/styles.xml"])).toContain("styleId=\"Title\"");
    expect(decode(files["[Content_Types].xml"])).toContain("word/document.xml");
  });

  it("preset manuscrito usa A4", () => {
    const files = unzipSync(
      buildDocx({ ...input, options: { ...DEFAULT_EXPORT_OPTIONS, preset: "manuscript" } }),
    );
    expect(decode(files["word/document.xml"])).toContain('w:pgSz w:w="11906"');
  });

  it("imprime a folha do livro com a tipografia do editor", () => {
    const html = exportHtml({
      ...input,
      book: { ...book, body_px: 18, body_leading: 160 },
      options: { ...DEFAULT_EXPORT_OPTIONS, preset: "book" },
    }).html;
    expect(html).toContain('@font-face { font-family: "Newsreader"');
    expect(html).toContain('class="chapter-overline"');
    expect(html).toContain('class="chapter-title"');
    expect(html).toContain("font-size: 18px");
    expect(html).toContain("line-height: 1.6");
    expect(html).toContain("text-indent: 1.4em");
  });

  it("coloca a capa antes da pagina de titulo", () => {
    const html = exportHtml({
      ...input,
      coverDataUrl: "data:image/jpeg;base64,AAAA",
      options: { ...DEFAULT_EXPORT_OPTIONS, preset: "book" },
    }).html;
    expect(html).toContain('class="cover-page"');
    expect(html).toContain("@page cover");
    expect(html.indexOf("cover-page")).toBeLessThan(html.indexOf("title-page"));
  });

  it("leva a fonte escolhida para o HTML e para o DOCX", () => {
    const withFont = { ...input, book: { ...book, body_font: "eb-garamond" as const } };
    const html = exportHtml({ ...withFont, options: { ...DEFAULT_EXPORT_OPTIONS, preset: "book" } }).html;
    expect(html).toContain('font-family: "EB Garamond"');
    expect(html).toContain("eb-garamond-roman");
    const files = unzipSync(
      buildDocx({ ...withFont, options: { ...DEFAULT_EXPORT_OPTIONS, preset: "book" } }),
    );
    expect(decode(files["word/styles.xml"])).toContain('w:ascii="EB Garamond"');
  });

  it("HTML de leitura traz @page, título e ordem dos capítulos", () => {
    const html = exportHtml({
      ...input,
      options: { ...DEFAULT_EXPORT_OPTIONS, preset: "book" },
    }).html;
    expect(html).toContain("@page { size: 140mm 210mm; margin: 19mm; }");
    expect(html).toContain("O nome do vento");
    expect(html).toContain("Sumário");
    expect(html.indexOf("Parte I")).toBeLessThan(html.indexOf("A ponte"));
    expect(html).not.toContain('class="images-color"');
  });

  it("markdown mantém ordem e separadores", () => {
    const markdown = exportMarkdown(input);
    expect(markdown.startsWith("# O nome do vento")).toBe(true);
    expect(markdown).toContain("## A ponte");
    expect(markdown).toContain("---");
    expect(markdown).toContain("Uma frase **forte**.");
  });

  it("resumo ignora capitulos vazios e estima paginas", () => {
    const summary = exportSummary(input);
    expect(summary.chapters).toBe(1);
    expect(summary.empty).toBe(0);
    expect(summary.pages).toBeGreaterThan(0);
  });
});
