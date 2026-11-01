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

function pageCss(preset: ExportPreset): string {
  if (preset === "manuscript") {
    return "size: A4; margin: 2.5cm;";
  }
  return "size: 6in 9in; margin: 1.9cm;";
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
  const body = chapters
    .map((chapter) => {
      const part = chapter.entry.chapter_kind === "part";
      return `<section class="chapter ${part ? "part-page" : ""}">
        <h2>${escapeHtml(chapter.entry.title || "Sem título")}</h2>
        ${markdownToHtml(chapter.markdown)}
      </section>`;
    })
    .join("\n");
  const words = chapters.reduce((sum, chapter) => sum + chapter.words, 0);
  return {
    pages: Math.max(1, Math.ceil((words + (options.includeTitlePage ? 300 : 0)) / 300)),
    html: `<!doctype html>
<html lang="${escapeHtml(book.language || "pt-BR")}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(book.name)}</title>
<style>
@page { ${pageCss(options.preset)} }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font-family: ${manuscript ? '"Times New Roman", Times, serif' : 'Georgia, "Times New Roman", serif'}; font-size: 12pt; line-height: ${manuscript ? 2 : 1.15}; text-align: justify; }
.title-page, .toc, .chapter { page-break-after: always; padding: 1.25cm 0; }
.title-page { text-align: center; page-break-after: always; padding-top: 5cm; }
.title-page h1 { font-size: 2.2em; margin: 0 0 0.4em; }
.title-page .subtitle { font-size: 1.3em; margin: 0 0 1.4em; }
.title-page .author { font-size: 1.1em; }
.toc h2 { font-size: 1.4em; }
.toc p { margin: 0.2em 0; text-align: left; }
.toc-part { font-weight: bold; margin-top: 1em !important; }
.toc-chapter { padding-left: 1.2em; }
.chapter h2 { font-size: 1.6em; text-align: left; margin: 0 0 1em; }
.part-page { text-align: center; page-break-before: always; }
.part-page h2 { text-align: center; margin-top: 5cm; font-size: 2em; }
p { margin: 0; text-indent: ${manuscript ? "1.25cm" : "1.4em"}; orphans: 2; widows: 2; }
h1, h2, h3, h4, h5, h6 { text-indent: 0; page-break-after: avoid; }
blockquote { margin: 1em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
ul, ol { margin: 0.6em 0 0.6em 1.4em; }
li { margin: 0.25em 0; }
img.book-image { display: block; max-width: 100%; margin: 1em auto; filter: grayscale(1); }
img.book-image--color { filter: none; }
body.images-color img.book-image { filter: none; }
code { font-family: monospace; }
section + section { page-break-before: always; }
</style>
</head>
<body class="${options.images === "color" ? "images-color" : ""}">
${titlePage}
${toc}
${body}
</body>
</html>`,
  };
}
