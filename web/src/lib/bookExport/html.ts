import { bookPage, estimatePages } from "../books";
import { bookFont, bookFontFaces } from "../bookFonts";
import type { BookExportInput, ExportPreset } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(value: string): string {
  if (/^(https?:|attachment:|data:|\/api\/v1\/attachments\/)/.test(value)) {
    // O HTML tambem roda num blob (janela de impressao): caminho absoluto do
    // mesmo host evita a URL relativa resolver contra o blob.
    if (value.startsWith("/") && typeof window !== "undefined") {
      return `${window.location.origin}${value}`;
    }
    return value;
  }
  return "";
}

function inline(value: string): string {
  let text = escapeHtml(value);
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d{1,3})(?:,c=([01]))?\}|\{c=([01])\})?/g,
    (_match, alt: string, src: string, width?: string, color?: string, colorOnly?: string) => {
      const resolved = safeUrl(src.replace(/^attachment:/, "/api/v1/attachments/"));
      if (!resolved) return alt;
      const colorMarker = color ?? colorOnly ?? "";
      const classes = colorMarker === "1" ? "book-image book-image--color" : "book-image";
      const style = width ? ` style="width:${width}%"` : "";
      return `<img class="${classes}" src="${resolved}" alt="${alt}"${style}>`;
    });
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const url = safeUrl(href);
    return url ? `<a href="${url}">${label}</a>` : label;
  });
  return text;
}

/** Markdown de bloco para HTML. So o que o livro escreve, sem HTML cru. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: "ul" | "ol" | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`</${list}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote>${quote.map((line) => `<p>${inline(line)}</p>`).join("")}</blockquote>`);
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^```/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const kind = numbered ? "ol" : "ul";
      if (list !== kind) {
        flushList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((bullet ?? numbered)?.[1] ?? "")}</li>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (/^!\[[^\]]*\]\([^)\s]+\)/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      out.push(inline(line));
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  flushQuote();
  return out.join("\n");
}

function pageCss(preset: ExportPreset, input: BookExportInput): string {
  if (preset === "manuscript") {
    return "size: A4; margin: 2.5cm;";
  }
  const page = bookPage(input.book);
  return `size: ${page.widthMm}mm ${page.heightMm}mm; margin: ${page.marginMm}mm;`;
}

export interface HtmlExport {
  html: string;
  pages: number;
}

/** HTML autocontido da leitura e do PDF por impressao. */
export function exportHtml(input: BookExportInput): HtmlExport {
  const { book, options } = input;
  const chapters = input.chapters.filter(
    (chapter) => chapter.entry.chapter_kind === "part" || chapter.words > 0,
  );
  const manuscript = options.preset === "manuscript";
  const font = bookFont(book.body_font);
  const printFont = manuscript ? '"Times New Roman", Times, serif' : font.css;
  const fontFaces = manuscript ? "" : `${bookFontFaces(font)}\n`;
  const titlePage = options.includeTitlePage
    ? `<section class="title-page">
        <h1>${escapeHtml(book.name)}</h1>
        ${book.subtitle.trim() ? `<p class="subtitle">${escapeHtml(book.subtitle)}</p>` : ""}
        ${book.author.trim() ? `<p class="author">${escapeHtml(book.author)}</p>` : ""}
      </section>`
    : "";
  const toc = options.includeToc
    ? `<nav class="toc">
        <h2>Sumário</h2>
        ${chapters
          .map(
            (chapter) =>
              `<p class="${chapter.entry.chapter_kind === "part" ? "toc-part" : "toc-chapter"}">${escapeHtml(
                chapter.entry.title || "Sem título",
              )}</p>`,
          )
          .join("")}
      </nav>`
    : "";
  let chapterNo = 0;
  let partTitle = "";
  const body = chapters
    .map((chapter) => {
      const entry = chapter.entry;
      const part = entry.chapter_kind === "part";
      if (part) {
        partTitle = entry.title || "";
      } else if (entry.chapter_kind === "chapter") {
        chapterNo += 1;
      }
      const overline = part
        ? "Parte"
        : entry.chapter_kind === "front"
          ? "Frontispício"
          : entry.chapter_kind === "back"
            ? "Posfácio"
            : `Capítulo ${chapterNo}${partTitle ? ` · ${partTitle}` : ""}`;
      return `<section class="chapter">
        <p class="chapter-overline">${escapeHtml(overline)}</p>
        <h1 class="chapter-title">${escapeHtml(entry.title || "Sem título")}</h1>
        <div class="chapter-body">${markdownToHtml(chapter.markdown)}</div>
      </section>`;
    })
    .join("\n");
  const measure = bookPage(book);
  const coverPageCss = manuscript
    ? "size: A4; margin: 0;"
    : `size: ${measure.widthMm}mm ${measure.heightMm}mm; margin: 0;`;
  const cover = input.coverDataUrl
    ? `<section class="cover-page"><img src="${input.coverDataUrl}" alt=""></section>`
    : "";
  const words = chapters.reduce((sum, chapter) => sum + chapter.words, 0);
  return {
    pages:
      estimatePages(words, measure) +
      (options.includeTitlePage ? 1 : 0) +
      (input.coverDataUrl ? 1 : 0),
    html: `<!doctype html>
<html lang="${escapeHtml(book.language || "pt-BR")}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(book.name)}</title>
<style>
@page { ${pageCss(options.preset, input)} }
@page cover { ${coverPageCss} }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
.cover-page { page: cover; margin: 0; padding: 0; page-break-after: always; }
.cover-page img { display: block; width: 100%; height: auto; }
body { font-family: ${printFont}; font-size: ${manuscript ? "12pt" : `${input.book.body_px ?? 18}px`}; line-height: ${manuscript ? 2 : (input.book.body_leading ?? 160) / 100}; text-align: justify; hyphens: auto; color: #111; }
${fontFaces}@font-face { font-family: "Inter"; src: url("/fonts/inter-latin.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
.title-page, .toc, .chapter { page-break-after: always; }
.title-page { text-align: center; page-break-after: always; padding-top: 5cm; }
.title-page h1 { font-size: 2.2em; margin: 0 0 0.4em; }
.title-page .subtitle { font-size: 1.3em; margin: 0 0 1.4em; }
.title-page .author { font-size: 1.1em; }
.toc h2 { font-size: 1.4em; }
.toc p { margin: 0.2em 0; text-align: left; text-indent: 0; }
.toc-part { font-weight: bold; margin-top: 1em !important; }
.toc-chapter { padding-left: 1.2em; }
.chapter-overline {
  margin: 0;
  color: #6b655c;
  font-family: Inter, ui-sans-serif, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 9px;
  line-height: 1.6;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-indent: 0;
}
.chapter-title {
  margin: 7px 0 22px;
  padding: 0 0 2px;
  border-bottom: 1px solid transparent;
  color: #111;
  font-family: ${printFont};
  font-size: 31px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.12;
  text-align: left;
  text-indent: 0;
}
.chapter-body > p {
  margin: 0;
  padding: 0;
  text-indent: ${manuscript ? "1.25cm" : "1.4em"};
}
.chapter-body > p:first-child { text-indent: 0; }
.chapter-body h1, .chapter-body h2, .chapter-body h3,
.chapter-body h4, .chapter-body h5, .chapter-body h6 {
  margin: 0;
  padding: 16px 0 2px;
  color: #111;
  font-family: ${printFont};
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
  text-align: left;
  text-indent: 0;
}
.chapter-body h1 { font-size: 24px; }
.chapter-body h2 { font-size: 19px; }
.chapter-body h3 { font-size: 17px; }
.chapter-body h4 { font-size: 15.5px; }
.chapter-body h5 { font-size: 14.5px; }
.chapter-body h6 { font-size: 13.5px; }
.chapter-body blockquote {
  margin: 8px 0;
  padding-left: 14px;
  border-left: 2px solid #ded8cc;
  font-style: italic;
}
.chapter-body blockquote p { text-indent: 0; }
.chapter-body ul, .chapter-body ol { margin: 6px 0; padding-left: 1.4em; }
.chapter-body li { margin: 0; }
.chapter-body img.book-image { display: block; max-width: 100%; margin: 1em auto; filter: grayscale(1); }
.chapter-body img.book-image--color { filter: none; }
body.images-color img.book-image { filter: none; }
code { font-family: monospace; }
</style>
</head>
<body class="${options.images === "color" ? "images-color" : ""}">
${cover}
${titlePage}
${toc}
${body}
</body>
</html>`,
  };
}
