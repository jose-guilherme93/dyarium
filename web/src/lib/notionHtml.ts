/**
 * Converte uma pagina exportada pelo Notion em HTML para o conteudo ordenado
 * de uma nota do dyarium.
 *
 * O Notion separa a pagina em titulo, tabela de propriedades e corpo. O dyarium
 * nao tem essa separacao: o corpo e uma lista unica de blocos. Aqui a ordem do
 * Notion e preservada: descricao, conteudo util das propriedades (na ordem da
 * tabela) e corpo, com texto e imagens no ponto em que aparecem.
 *
 * O parser e puro: nao sobe imagem, nao cria nota e nao chama a API. A imagem
 * fica com o `src` original para quem importa resolver no arquivo do export.
 */

import { parseNotionDateElement, type NotionDateValue } from "./notionDates";

export type NotionBlock =
  | { kind: "markdown"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "image"; src: string; caption: string; origin: "body" | "property" };

export interface NotionLink {
  text: string;
  href: string;
}

export type NotionPropertyUse = "date" | "tags" | "content" | "skipped";

export interface NotionProperty {
  name: string;
  type: string;
  rawValue: string;
  links: NotionLink[];
  images: string[];
  tags: string[];
  date: NotionDateValue | null;
  use: NotionPropertyUse;
}

export interface NotionDateCandidate {
  name: string;
  type: string;
  raw: string;
  date: Date | null;
  hadYear: boolean;
  hasTime: boolean;
}

export interface NotionPage {
  fileName: string;
  notionId: string;
  title: string;
  description: string;
  blocks: NotionBlock[];
  tags: string[];
  recordedAt: Date | null;
  dateProperty: string | null;
  dateCandidates: NotionDateCandidate[];
  properties: NotionProperty[];
  icon: string;
  isDatabaseIndex: boolean;
  warnings: string[];
}

export interface NotionParseOptions {
  fileName: string;
  fallbackYear: number;
  locale?: string;
  /** Nome da propriedade escolhida na tela de importacao. */
  dateProperty?: string;
  /** Ids (normalizados) das paginas que fazem parte desta importacao. */
  knownPageIds?: Set<string>;
  /** Id da entrada para um id de pagina do Notion. */
  entryIdForPage?: (notionId: string) => string;
}

const DATE_PROPERTY_TYPES = new Set(["created_time", "last_edited_time", "date"]);
const TAG_PROPERTY_NAMES = new Set(["tags", "tag", "etiquetas", "etiqueta"]);
const PREFERRED_DATE_NAMES = [
  "data original",
  "data de criacao",
  "data de criação",
  "criado em",
  "created",
  "created time",
  "data",
];

const INLINE_TAGS = new Set([
  "a",
  "strong",
  "b",
  "em",
  "i",
  "del",
  "s",
  "strike",
  "code",
  "mark",
  "u",
  "span",
  "font",
  "small",
  "sub",
  "sup",
  "time",
  "br",
  "img",
  "input",
  "svg",
]);

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNotionId(value: string): string {
  const compact = value.toLowerCase().replace(/-/g, "").trim();
  return /^[0-9a-f]{32}$/.test(compact) ? compact : "";
}

function idFromText(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Nome url-encoded quebrado: usa o texto como veio.
  }
  const dashed = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(decoded);
  if (dashed) return dashed[1]!.replace(/-/g, "").toLowerCase();
  const matches = decoded.match(/[0-9a-f]{32}/gi);
  return matches && matches.length > 0 ? matches[matches.length - 1]!.toLowerCase() : "";
}

function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.html?$/i, "").split("/").pop() ?? "";
  return base.replace(/\s+[0-9a-f]{32}$/i, "").replace(/\s+[0-9a-f-]{36}$/i, "").trim();
}

function escapeInlineText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineCode(value: string): string {
  const text = value.replace(/[\r\n]+/g, " ").trim();
  if (!text) return "";
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function emphasis(marker: string, value: string): string {
  if (!value) return "";
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  if (!match || !match[2]) return value;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

function markdownUrl(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/</g, "%3C").replace(/>/g, "%3E")}>` : url;
}

interface InlineContext {
  knownPageIds: Set<string>;
  entryIdForPage: (notionId: string) => string;
}

function resolveLink(href: string, ctx: InlineContext): string | null {
  const value = href.trim();
  if (!value || value.startsWith("#")) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (/^(javascript:|data:|vbscript:|file:)/i.test(value)) return null;
  if (/\.html?(?:[?#]|$)/i.test(value) || /[0-9a-f]{32}/i.test(value)) {
    const id = idFromText(value);
    if (id && ctx.knownPageIds.has(id)) {
      return `note:${ctx.entryIdForPage(id)}`;
    }
  }
  return null;
}

function linkMarkdown(anchor: Element, ctx: InlineContext): string {
  const text = inlineMarkdown(anchor, ctx).trim();
  const href = anchor.getAttribute("href") ?? "";
  const resolved = resolveLink(href, ctx);
  if (!resolved) return text;
  if (/^note:/i.test(resolved)) {
    return `[${text || "nota"}](${resolved})`;
  }
  return `[${text || escapeInlineText(resolved)}](${markdownUrl(resolved)})`;
}

function inlineNode(node: Node, ctx: InlineContext): string {
  if (node.nodeType === 3) {
    return escapeInlineText((node.nodeValue ?? "").replace(/[\t\r\n]+/g, " "));
  }
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "br":
      return "  \n";
    case "strong":
    case "b":
      return emphasis("**", inlineMarkdown(el, ctx));
    case "em":
    case "i":
      return emphasis("*", inlineMarkdown(el, ctx));
    case "del":
    case "s":
    case "strike":
      return emphasis("~~", inlineMarkdown(el, ctx));
    case "code":
      return inlineCode(el.textContent ?? "");
    case "a":
      return linkMarkdown(el, ctx);
    case "img":
    case "input":
    case "svg":
      // Imagem de bloco e tratada fora do texto; icones/checkbox nao viram
      // texto da nota.
      return "";
    case "time":
      return escapeInlineText(el.textContent ?? "");
    default:
      return inlineMarkdown(el, ctx);
  }
}

function inlineMarkdown(node: Node, ctx: InlineContext): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    out += inlineNode(child, ctx);
  }
  return out;
}

function paragraphMarkdown(value: string): string {
  return value
    .replace(/(^|\n)(\s*)(#{1,6}\s|>\s|[-+*]\s)/g, "$1$2\\$3")
    .replace(/(^|\n)(\s*)(\d+)\.\s/g, "$1$2$3\\. ")
    .replace(/(^|\n)(\s*)(-{3,}|_{3,}|\*{3,})(\s*)$/g, (_match, lead, space, marks, tail) => `${lead}${space}\\${marks}${tail}`)
    .trim();
}

function isBlockElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "hr", "figure", "details", "table"].includes(tag)) {
    return true;
  }
  if (tag === "div") {
    return el.classList.contains("indented") || el.classList.contains("column") || el.classList.contains("collection-content-wrapper");
  }
  return false;
}

function inlineUntilBlocks(el: Element, ctx: InlineContext): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1 && isBlockElement(child as Element)) continue;
    out += inlineNode(child, ctx);
  }
  return out.trim();
}

function addMarkdown(out: NotionBlock[], value: string): void {
  const text = value.trim();
  if (text) out.push({ kind: "markdown", text });
}

function imageBlock(src: string, caption: string, origin: "body" | "property"): NotionBlock | null {
  const value = src.trim();
  if (!value) return null;
  return { kind: "image", src: value, caption: caption.trim(), origin };
}

function isExternalUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value.trim());
}

function isImageFile(value: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)(?:[?#]|$)/i.test(value.trim());
}

function codeText(el: Element): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      out += child.nodeValue ?? "";
    } else if (child.nodeType === 1) {
      const element = child as Element;
      if (element.tagName.toLowerCase() === "br") out += "\n";
      else out += codeText(element);
    }
  }
  return out;
}

function codeFence(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  return "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
}

function prefixQuote(value: string): string {
  return value
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/**
 * O export HTML do Notion inclui comentarios de pagina e de bloco quando a
 * opcao "Include comments" esta ligada. O Notion nao documenta o HTML gerado,
 * entao a deteccao aceita as classes que ele costuma usar (`comment`,
 * `comments`, `comment-thread`, `notion-comment`) e `data-comment-id`.
 * Sintaxe de codigo (`token comment`) e a tabela de propriedades ficam de fora.
 */
function isCommentsTitle(value: string | null | undefined): boolean {
  const text = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return /^(comments?|comentarios?)( (da|de|do) (pagina|bloco)| on the (page|block)| (page|block))?(?: \(\d+\))?$/.test(
    text,
  );
}

/**
 * Titulo da secao que agrupa os comentarios da pagina inteira. Os comentarios
 * presos a um bloco nao tem essa secao e continuam no lugar do bloco.
 */
function isPageCommentsTitle(value: string | null | undefined): boolean {
  const text = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return /^(?:comments?|comentarios?)(?: (?:da|de|do) pagina| on the page)?(?: \(\d+\))?$/.test(
    text,
  );
}

function hasCommentToggle(el: Element): boolean {
  return Array.from(el.querySelectorAll("ul.toggle")).some(
    (list) => list.querySelector(".user") !== null,
  );
}

/**
 * Tira do corpo a secao "Comentarios da pagina" e devolve as citacoes, que
 * entram no comeco da nota. O parser do HTML fecha o `<p>` antes do `<div>`
 * do toggle, entao a secao pode estar no pai do `<summary>` ou no irmao logo
 * depois dele.
 */
function takePageComments(
  body: Element | null,
  ctx: InlineContext,
  warnings: string[],
): NotionBlock[] {
  const out: NotionBlock[] = [];
  if (!body) return out;
  const summaries = Array.from(body.querySelectorAll("summary")).filter((summary) =>
    isPageCommentsTitle(summary.textContent),
  );
  for (const summary of summaries) {
    if (!summary.isConnected || !body.contains(summary)) continue;
    const holder = summary.closest("p, div, details");
    const sections: Element[] = [];
    if (holder && holder !== body && holder.querySelector("ul.toggle .user")) {
      // O titulo e os toggles ficaram no mesmo container (`details`, por ex.).
      sections.push(holder);
    } else {
      // O parser do HTML fecha o paragrafo do titulo antes dos toggles, entao a
      // secao e o titulo mais os irmaos vazios que levam aos toggles.
      const parent = summary.parentElement;
      const alone =
        parent !== null &&
        parent !== body &&
        (parent.textContent ?? "").trim() === (summary.textContent ?? "").trim() &&
        !parent.querySelector("ul.toggle");
      const start = alone && parent ? parent : summary;
      sections.push(start);
      let next = start.nextElementSibling;
      while (next) {
        if (next.querySelector("ul.toggle .user")) {
          sections.push(next);
          break;
        }
        if ((next.textContent ?? "").trim()) break;
        sections.push(next);
        next = next.nextElementSibling;
      }
    }
    for (const section of sections) {
      for (const toggle of Array.from(section.querySelectorAll("ul.toggle"))) {
        if (!toggle.querySelector(".user")) continue;
        const blocks: NotionBlock[] = [];
        parseBlockElement(toggle, ctx, blocks, warnings);
        out.push(...blocks.filter((block) => block.kind === "comment"));
      }
      section.remove();
    }
  }
  return out;
}

/**
 * O export atual do Notion desenha os comentarios como um `ul.toggle` sem
 * `details`: o autor fica em `span.user` e o texto num `div` irmao. Este e o
 * formato do exemplo real ("Comentarios da pagina"); o caso com `.comment` e
 * mantido para exports/versoes que usam a outra estrutura.
 */
function toggleCommentMarkdown(item: Element, ctx: InlineContext): string {
  const user = item.querySelector(".user");
  if (!user) return "";
  const nameFromBold = (user.querySelector("b")?.textContent ?? "").trim();
  let name = nameFromBold;
  if (!name) {
    const clone = user.cloneNode(true) as Element;
    clone.querySelectorAll(".icon, .user-icon, .user-icon-inner, time").forEach((node) => node.remove());
    name = inlineMarkdown(clone, ctx).trim();
  }
  const time = (user.querySelector("time")?.textContent ?? "").trim();
  const authorBlock = user.closest("div");
  let content = Array.from(item.children)
    .filter((child) => child !== authorBlock && (child.textContent ?? "").trim())
    .map((child) => inlineMarkdown(child, ctx).trim())
    .filter(Boolean)
    .join("\n\n");
  if (!content) {
    const clone = item.cloneNode(true) as Element;
    clone.querySelectorAll(".user, .icon, .user-icon, time, button").forEach((node) => node.remove());
    content = inlineMarkdown(clone, ctx).trim();
  }
  const authorLine = name
    ? `**${escapeInlineText(name)}**${time ? ` · ${escapeInlineText(time)}` : ""}`
    : "";
  return [authorLine, content].filter(Boolean).join("\n\n");
}

function isCommentContainer(el: Element): boolean {
  if (el.closest("pre, code, .token, table.properties")) return false;
  if (el.hasAttribute("data-comment-id") || el.hasAttribute("data-comment")) return true;
  if (Array.from(el.classList).some((token) => /(^|[-_])comments?($|[-_])|discussion/i.test(token))) {
    return true;
  }
  const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
  return /\bcomments?\b|discussion/.test(label);
}

function commentMarkdown(comment: Element, ctx: InlineContext, warnings: string[]): string {
  const author = (comment.querySelector(".comment-author, .comment-user, .comment-author-name")?.textContent ?? "").trim();
  const contentElement =
    comment.querySelector(".comment-text, .comment-content, .comment-message, .comment-body") ?? comment;
  const clone = contentElement.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      ".comment, .comment-author, .comment-user, .comment-author-name, .comment-timestamp, .comment-meta, .comment-actions, .comment-reactions, .comment-avatar, button, input, img, svg, style, script",
    )
    .forEach((node) => node.remove());

  // O texto de um comentario e inline; so vira blocos quando o export trouxe
  // paragrafos de verdade (uma resposta longa, por exemplo).
  let content = "";
  if (Array.from(clone.children).some((child) => isBlockElement(child))) {
    const blocks: NotionBlock[] = [];
    for (const child of Array.from(clone.childNodes)) {
      if (child.nodeType === 1) parseBlockElement(child as Element, ctx, blocks, warnings);
      else if (child.nodeType === 3 && (child.nodeValue ?? "").trim()) {
        addMarkdown(blocks, paragraphMarkdown(escapeInlineText(child.nodeValue ?? "")));
      }
    }
    content = blocks
      .map((block) => (block.kind === "markdown" ? block.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (!content) content = inlineMarkdown(clone, ctx).trim();
  const authorLine = author ? `**${escapeInlineText(author)}**` : "";
  return [authorLine, content].filter(Boolean).join("\n\n");
}

function parseCommentContainer(
  container: Element,
  ctx: InlineContext,
  out: NotionBlock[],
  warnings: string[],
): void {
  const comments = Array.from(container.querySelectorAll(".comment")).filter(
    (comment) => !comment.closest("pre, code, .token, table.properties"),
  );
  if (container.classList.contains("comment") || container.hasAttribute("data-comment-id")) {
    comments.unshift(container);
  }
  const targets = comments.length > 0 ? comments : [container];
  const seen = new Set<Element>();
  for (const comment of targets) {
    if (seen.has(comment)) continue;
    seen.add(comment);
    const quote = commentMarkdown(comment, ctx, warnings);
    if (quote) out.push({ kind: "comment", text: prefixQuote(quote) });
  }
}

function outsideCommentContainers(root: Element | null, body: Element | null): Element[] {
  if (!root) return [];
  const all = Array.from(root.querySelectorAll("*")).filter(
    (el) => isCommentContainer(el) && !(body && body.contains(el)),
  );
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

function listMarkdown(el: Element, level: number, ctx: InlineContext, warnings: string[]): string {
  const isOrdered = el.tagName.toLowerCase() === "ol";
  const isTodo = el.classList.contains("to-do-list");
  const isToggle = el.classList.contains("toggle");
  const items = Array.from(el.children).filter((child) => child.tagName.toLowerCase() === "li");
  const lines: string[] = [];

  for (const item of items) {
    if (isToggle) {
      // Comentarios de pagina/bloco no export atual vem como `ul.toggle` com o
      // autor em `span.user`; nao ha `details` (ou ele pode existir em outra
      // versao). O autor e a presenca do `.user` que identificam o comentario.
      if (item.querySelector(".user")) {
        const quote = toggleCommentMarkdown(item, ctx);
        if (quote) {
          if (lines.length > 0) lines.push("");
          lines.push(...prefixQuote(quote).split("\n"));
        }
        continue;
      }
      const details = item.querySelector("details");
      const summary = details?.querySelector("summary");
      const title = summary ? inlineMarkdown(summary, ctx).trim() : "";
      if (title) lines.push(`${"  ".repeat(level)}**${title}**`);
      const content: NotionBlock[] = [];
      if (details) {
        for (const child of Array.from(details.childNodes)) {
          if (child === summary) continue;
          if (child.nodeType === 1) parseBlockElement(child as Element, ctx, content, warnings);
          else if (child.nodeType === 3 && (child.nodeValue ?? "").trim()) {
            addMarkdown(content, paragraphMarkdown(escapeInlineText(child.nodeValue ?? "")));
          }
        }
      }
      for (const block of content) {
        if (block.kind === "markdown") {
          for (const line of block.text.split("\n")) lines.push(`${"  ".repeat(level)}${line}`);
        }
      }
      continue;
    }

    const checkbox =
      item.querySelector(":scope > .checkbox") ??
      item.querySelector(":scope > input[type=\"checkbox\"]");
    const checked =
      checkbox?.classList.contains("checkbox-on") ||
      (checkbox instanceof HTMLInputElement && checkbox.checked);

    let text = "";
    for (const child of Array.from(item.childNodes)) {
      if (child.nodeType === 3) {
        text += escapeInlineText((child.nodeValue ?? "").replace(/[\t\r\n]+/g, " "));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") continue;
      if (element === checkbox) continue;
      if (tag === "div" && element.classList.contains("indented")) {
        text += inlineUntilBlocks(element, ctx);
        continue;
      }
      text += inlineNode(element, ctx);
    }

    const marker = isTodo ? `- [${checked ? "x" : " "}] ` : isOrdered ? "1. " : "- ";
    const content = text.trim();
    if (content || !isTodo) {
      lines.push(`${"  ".repeat(level)}${marker}${content}`.trimEnd());
    } else {
      lines.push(`${"  ".repeat(level)}${marker}`.trimEnd());
    }

    // Listas aninhadas ficam dentro do <li> ou do <div class="indented">.
    const nested = Array.from(item.children).filter((child) => {
      const tag = child.tagName.toLowerCase();
      return tag === "ul" || tag === "ol";
    });
    for (const child of Array.from(item.children)) {
      if (child.tagName.toLowerCase() !== "div" || !child.classList.contains("indented")) continue;
      nested.push(
        ...Array.from(child.children).filter((nestedChild) => {
          const tag = nestedChild.tagName.toLowerCase();
          return tag === "ul" || tag === "ol";
        }),
      );
    }
    for (const child of nested) {
      const nestedText = listMarkdown(child, level + 1, ctx, warnings);
      if (nestedText) lines.push(...nestedText.split("\n"));
    }
  }

  return lines.join("\n");
}

function tableMarkdown(el: Element, ctx: InlineContext): string {
  const rows = Array.from(el.querySelectorAll("tr"));
  if (rows.length === 0) return "";
  const matrix = rows.map((row) =>
    Array.from(row.children)
      .filter((cell) => {
        const tag = cell.tagName.toLowerCase();
        return tag === "th" || tag === "td";
      })
      .map((cell) => {
        const value = inlineMarkdown(cell, ctx)
          .replace(/\n+/g, "<br>")
          .replace(/\|/g, "\\|")
          .trim();
        return value || " ";
      }),
  );
  const width = Math.max(0, ...matrix.map((row) => row.length));
  if (width === 0) return "";
  const headerCells = matrix[0] ?? [];
  const hasHeader = Boolean(rows[0]?.querySelector("th"));
  const header = hasHeader ? headerCells : Array.from({ length: width }, () => " ");
  const body = hasHeader ? matrix.slice(1) : matrix;
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? " ").join(" | ")} |`;
  return [
    line(header),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}

function parseDetails(el: Element, ctx: InlineContext, out: NotionBlock[], warnings: string[]): void {
  const summary = Array.from(el.children).find((child) => child.tagName.toLowerCase() === "summary");
  const title = summary ? inlineMarkdown(summary, ctx).trim() : "";
  const style = summary?.getAttribute("style") ?? "";
  const heading = /font-size:\s*1\.875em/i.test(style)
    ? "#"
    : /font-size:\s*1\.5em/i.test(style)
      ? "##"
      : /font-size:\s*1\.25em/i.test(style)
        ? "###"
        : "";
  if (title && !isCommentsTitle(title)) {
    addMarkdown(out, heading ? `${heading} ${title}` : `**${title}**`);
  }
  for (const child of Array.from(el.childNodes)) {
    if (child === summary) continue;
    if (child.nodeType === 1) parseBlockElement(child as Element, ctx, out, warnings);
    else if (child.nodeType === 3 && (child.nodeValue ?? "").trim()) {
      addMarkdown(out, paragraphMarkdown(escapeInlineText(child.nodeValue ?? "")));
    }
  }
}

function parseFigure(el: Element, ctx: InlineContext, out: NotionBlock[], warnings: string[]): void {
  const className = el.className;
  const figureCaption = el.querySelector("figcaption");
  const caption = figureCaption ? inlineMarkdown(figureCaption, ctx).trim() : "";

  if (className.includes("callout")) {
    const children = Array.from(el.children).filter((child) => child.tagName.toLowerCase() === "div");
    const content = children[children.length - 1];
    if (!content) return;
    const inner: NotionBlock[] = [];
    for (const child of Array.from(content.childNodes)) {
      if (child.nodeType === 1) parseBlockElement(child as Element, ctx, inner, warnings);
      else if (child.nodeType === 3 && (child.nodeValue ?? "").trim()) {
        addMarkdown(inner, paragraphMarkdown(escapeInlineText(child.nodeValue ?? "")));
      }
    }
    const text = inner
      .map((block) => (block.kind === "markdown" ? block.text : ""))
      .filter(Boolean)
      .join("\n\n");
    if (text) addMarkdown(out, prefixQuote(text));
    return;
  }

  if (className.includes("equation")) {
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    const tex = annotation?.textContent?.trim();
    if (tex) addMarkdown(out, `$$${tex}$$`);
    else warnings.push("equacao sem LaTeX");
    return;
  }

  if (className.includes("link-to-page")) {
    const link = el.querySelector("a[href]");
    if (link) addMarkdown(out, linkMarkdown(link, ctx));
    else addMarkdown(out, paragraphMarkdown(inlineMarkdown(el, ctx)));
    return;
  }

  if (className.includes("bookmark")) {
    const link = el.querySelector("a.bookmark[href]") ?? el.querySelector("a[href]");
    if (link) {
      const title =
        (link.querySelector(".bookmark-title")?.textContent ?? "").trim() ||
        (link.textContent ?? "").trim();
      const href = link.getAttribute("href") ?? "";
      const resolved = resolveLink(href, ctx) ?? (/^https?:/i.test(href) ? href : "");
      if (resolved) {
        addMarkdown(out, `[${escapeInlineText(title || resolved)}](${markdownUrl(resolved)})`);
      } else if (title) {
        addMarkdown(out, escapeInlineText(title));
      }
      return;
    }
  }

  const source = el.querySelector("div.source");
  if (source) {
    parseFileSource(source, out, warnings, caption);
    return;
  }

  const image = el.querySelector("img[src]");
  if (image) {
    const block = imageBlock(image.getAttribute("src") ?? "", caption, "body");
    if (block) out.push(block);
    return;
  }

  const link = el.querySelector("a[href]");
  if (link) {
    addMarkdown(out, linkMarkdown(link, ctx));
    return;
  }

  // Figure de embed/video: guarda o link quando houver, sem tentar baixar nada.
  const iframe = el.querySelector("iframe[src]");
  if (iframe) {
    const src = iframe.getAttribute("src") ?? "";
    if (/^https?:/i.test(src)) addMarkdown(out, `[${escapeInlineText(src)}](${markdownUrl(src)})`);
    else warnings.push("embed sem endereco externo");
    return;
  }
  warnings.push("figura sem conteudo reconhecido");
}

function parseFileSource(
  source: Element,
  out: NotionBlock[],
  warnings: string[],
  caption = "",
): void {
  const link = source.querySelector("a[href]");
  const href = link?.getAttribute("href") ?? "";
  const image = source.querySelector("img[src]");
  const imageSrc = image?.getAttribute("src") || (isImageFile(href) ? href : "");
  if (imageSrc) {
    const block = imageBlock(imageSrc, caption, "body");
    if (block) out.push(block);
    return;
  }
  if (isExternalUrl(href)) {
    const text = (link?.textContent ?? "").trim() || href;
    addMarkdown(out, `[${escapeInlineText(text)}](${markdownUrl(href)})`);
    return;
  }
  const name = (link?.textContent ?? "").trim();
  if (name) addMarkdown(out, escapeInlineText(name));
  if (href) warnings.push(`arquivo nao importado: ${name || href}`);
}

function parseBlockElement(el: Element, ctx: InlineContext, out: NotionBlock[], warnings: string[]): void {
  const tag = el.tagName.toLowerCase();
  if (["script", "style", "link", "meta", "noscript", "svg"].includes(tag)) return;

  if (isCommentContainer(el)) {
    parseCommentContainer(el, ctx, out, warnings);
    return;
  }

  // Titulo da secao de comentarios que o parser do HTML tirou do <p>/<details>.
  if (tag === "summary" && isCommentsTitle(el.textContent)) return;

  if (tag === "p") {
    // O export do Notion coloca a secao de comentarios num <p> mal formado,
    // com um <summary> "Comentarios da pagina" e o toggle logo depois. O titulo
    // nao e texto da nota; o conteudo (o toggle) vira a citacao.
    const summary = Array.from(el.children).find((child) => child.tagName.toLowerCase() === "summary");
    if (summary && isCommentsTitle(summary.textContent)) {
      for (const child of Array.from(el.childNodes)) {
        if (child === summary) continue;
        if (child.nodeType === 1) {
          const element = child as Element;
          if (element.tagName.toLowerCase() === "hr") continue;
          parseBlockElement(element, ctx, out, warnings);
        } else if (child.nodeType === 3 && (child.nodeValue ?? "").trim()) {
          addMarkdown(out, paragraphMarkdown(escapeInlineText(child.nodeValue ?? "")));
        }
      }
      return;
    }
    const text = inlineUntilBlocks(el, ctx);
    if (text) addMarkdown(out, paragraphMarkdown(text));
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1 && isBlockElement(child as Element)) {
        parseBlockElement(child as Element, ctx, out, warnings);
      }
    }
    return;
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const text = inlineMarkdown(el, ctx).trim();
    if (text) addMarkdown(out, `${"#".repeat(level)} ${text}`);
    return;
  }

  if (tag === "ul" || tag === "ol") {
    // O toggle de comentarios do export real e um bloco de citacao, nao uma
    // lista; separar aqui mantem o tipo `comment` para a reimportacao.
    if (el.classList.contains("toggle")) {
      const comments = Array.from(el.children).filter(
        (child) => child.tagName.toLowerCase() === "li" && child.querySelector(".user") !== null,
      );
      if (comments.length > 0) {
        for (const comment of comments) {
          const quote = toggleCommentMarkdown(comment, ctx);
          if (quote) out.push({ kind: "comment", text: prefixQuote(quote) });
        }
        return;
      }
    }
    const text = listMarkdown(el, 0, ctx, warnings);
    if (text) addMarkdown(out, text);
    return;
  }

  if (tag === "blockquote") {
    const inner: NotionBlock[] = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) parseBlockElement(child as Element, ctx, inner, warnings);
      else if (child.nodeType === 3 && (child.nodeValue ?? "").trim()) {
        addMarkdown(inner, paragraphMarkdown(escapeInlineText(child.nodeValue ?? "")));
      }
    }
    const text = inner
      .map((block) => (block.kind === "markdown" ? block.text : ""))
      .filter(Boolean)
      .join("\n\n");
    if (text) addMarkdown(out, prefixQuote(text));
    return;
  }

  if (tag === "pre") {
    const code = el.querySelector("code") ?? el;
    const text = codeText(code);
    if (!text.trim()) return;
    const className = `${code.className} ${el.className}`;
    const language = /language-([\w+#.-]+)/i.exec(className)?.[1]?.toLowerCase() ?? "";
    const fence = codeFence(text);
    addMarkdown(out, `${fence}${language}\n${text.replace(/\n+$/, "")}\n${fence}`);
    return;
  }

  if (tag === "hr") {
    addMarkdown(out, "---");
    return;
  }

  if (tag === "figure") {
    parseFigure(el, ctx, out, warnings);
    return;
  }

  if (tag === "details") {
    parseDetails(el, ctx, out, warnings);
    return;
  }

  if (tag === "table") {
    if (el.classList.contains("properties")) return;
    const text = tableMarkdown(el, ctx);
    if (text) addMarkdown(out, text);
    return;
  }

  if (tag === "nav") {
    if (el.classList.contains("table_of_contents")) return;
    for (const child of Array.from(el.children)) parseBlockElement(child, ctx, out, warnings);
    return;
  }

  if (tag === "div") {
    if (el.classList.contains("table_of_contents")) return;
    if (el.classList.contains("indented") || el.classList.contains("column") || el.classList.contains("column-list")) {
      // A secao de comentarios do export real termina com um <hr/>; ele e o
      // separador da secao, nao um divisor que o usuario escreveu.
      if (hasCommentToggle(el)) {
        for (const child of Array.from(el.children)) {
          if (child.tagName.toLowerCase() === "hr") continue;
          parseBlockElement(child, ctx, out, warnings);
        }
        return;
      }
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 1) parseBlockElement(child as Element, ctx, out, warnings);
        else if (child.nodeType === 3 && (child.nodeValue ?? "").trim()) {
          addMarkdown(out, paragraphMarkdown(escapeInlineText(child.nodeValue ?? "")));
        }
      }
      return;
    }
    if (el.classList.contains("source")) {
      parseFileSource(el, out, warnings);
      return;
    }
    if (el.classList.contains("collection-content-wrapper")) {
      const table = el.querySelector("table");
      if (table) {
        const text = tableMarkdown(table, ctx);
        if (text) addMarkdown(out, text);
      }
      warnings.push("database visualizada como tabela");
      return;
    }
    const hasBlockChild = Array.from(el.children).some((child) => isBlockElement(child));
    if (hasBlockChild) {
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 1) parseBlockElement(child as Element, ctx, out, warnings);
        else if (child.nodeType === 3 && (child.nodeValue ?? "").trim()) {
          addMarkdown(out, paragraphMarkdown(escapeInlineText(child.nodeValue ?? "")));
        }
      }
      return;
    }
    const text = inlineMarkdown(el, ctx).trim();
    if (text) addMarkdown(out, paragraphMarkdown(text));
    return;
  }

  if (tag === "img") {
    const block = imageBlock(el.getAttribute("src") ?? "", "", "body");
    if (block) out.push(block);
    return;
  }

  if (["iframe", "video", "audio", "embed", "object"].includes(tag)) {
    const src = el.getAttribute("src") ?? "";
    if (isExternalUrl(src)) addMarkdown(out, `[${escapeInlineText(src)}](${markdownUrl(src)})`);
    else warnings.push(`midia sem endereco externo: ${tag}`);
    return;
  }

  if (INLINE_TAGS.has(tag)) {
    const text = inlineMarkdown(el, ctx).trim();
    if (text) addMarkdown(out, paragraphMarkdown(text));
    return;
  }

  const hasBlockChild = Array.from(el.children).some((child) => isBlockElement(child));
  if (hasBlockChild) {
    for (const child of Array.from(el.children)) parseBlockElement(child, ctx, out, warnings);
    return;
  }
  const text = inlineMarkdown(el, ctx).trim();
  if (text) addMarkdown(out, paragraphMarkdown(text));
}

function parseBlocks(root: Element | null, ctx: InlineContext, warnings: string[]): NotionBlock[] {
  const out: NotionBlock[] = [];
  if (!root) return out;
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) {
      const value = child.nodeValue ?? "";
      if (value.trim()) addMarkdown(out, paragraphMarkdown(escapeInlineText(value.trim())));
      continue;
    }
    if (child.nodeType !== 1) continue;
    parseBlockElement(child as Element, ctx, out, warnings);
  }
  return out;
}

function isDatabasePage(body: Element | null): boolean {
  if (!body) return false;
  const top = Array.from(body.children);
  if (top.length === 0) return false;
  let collection = false;
  for (const child of top) {
    if (child.matches(".collection-content-wrapper, table.collection-content")) {
      collection = true;
      continue;
    }
    const nested = child.querySelector(":scope > .collection-content-wrapper, :scope > table.collection-content");
    if (nested) {
      collection = true;
      continue;
    }
    if ((child.textContent ?? "").trim() === "" && child.tagName.toLowerCase() !== "table") continue;
    return false;
  }
  return collection;
}

function propertyContent(
  property: NotionProperty,
  ctx: InlineContext,
  warnings: string[],
): NotionBlock[] {
  const out: NotionBlock[] = [];
  if (property.images.length > 0) {
    for (const src of property.images) {
      const block = imageBlock(src, "", "property");
      if (block) out.push(block);
    }
    return out;
  }
  const cell = property.rawValue;
  const usableLinks = property.links.filter(
    (link) =>
      isExternalUrl(link.href) ||
      /\.html?(?:[?#]|$)/i.test(link.href) ||
      /[0-9a-f]{32}/i.test(link.href),
  );
  if (usableLinks.length > 0) {
    const text = property.links
      .map((link) => {
        const resolved = resolveLink(link.href, ctx);
        if (!resolved) return escapeInlineText(link.text || link.href);
        return `[${escapeInlineText(link.text || resolved)}](${markdownUrl(resolved)})`;
      })
      .join(" ");
    if (text.trim()) addMarkdown(out, text.trim());
    return out;
  }
  if (/^https?:\/\/\S+$/i.test(cell)) {
    addMarkdown(out, `[${escapeInlineText(cell)}](${markdownUrl(cell)})`);
    return out;
  }
  if (property.links.length > 0) {
    warnings.push(`arquivo nao importado: ${cell || property.name}`);
  }
  return out;
}

/**
 * Le uma pagina. Devolve `notionId` vazio quando o HTML nao e uma pagina do
 * Notion (por exemplo, o index.html que a exportacao coloca na raiz).
 */
export function parseNotionPage(html: string, options: NotionParseOptions): NotionPage {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const article = doc.querySelector("article");
  const body = article?.querySelector("div.page-body") ?? doc.querySelector("div.page-body");
  const fileName = options.fileName;
  const rawArticleId = article?.getAttribute("id") ?? "";
  const notionId = normalizeNotionId(rawArticleId) || idFromText(fileName);
  const titleElement = article?.querySelector("h1.page-title") ?? doc.querySelector("h1.page-title");
  const title = (titleElement?.textContent ?? doc.title ?? "").trim() || titleFromFileName(fileName);
  const locale = doc.documentElement.lang || options.locale || "pt-BR";
  const knownPageIds = options.knownPageIds ?? new Set<string>();
  const entryIdForPage = options.entryIdForPage ?? ((id: string) => id);
  const ctx: InlineContext = { knownPageIds, entryIdForPage };

  if (!article) warnings.push("pagina do Notion nao encontrada");
  if (!notionId) warnings.push("pagina sem id do Notion");

  const header = article?.querySelector("header") ?? null;
  const descriptionElement = header?.querySelector("p.page-description") ?? null;
  const description = descriptionElement ? inlineMarkdown(descriptionElement, ctx).trim() : "";

  const iconElement = header?.querySelector(".page-header-icon");
  const icon = iconElement
    ? (iconElement.querySelector("img[src]")?.getAttribute("src") ?? iconElement.textContent ?? "").trim()
    : "";

  const propertyTable = header?.querySelector("table.properties") ?? article?.querySelector("table.properties");
  const properties: NotionProperty[] = [];
  for (const row of Array.from(propertyTable?.querySelectorAll("tbody > tr") ?? [])) {
    const type = Array.from(row.classList)
      .find((name) => name.startsWith("property-row-"))
      ?.slice("property-row-".length);
    if (!type) continue;
    const name = (row.querySelector("th")?.textContent ?? "").trim();
    const cell = row.querySelector("td");
    if (!name && !cell) continue;
    const rawValue = (cell?.textContent ?? "").trim();
    const links = Array.from(cell?.querySelectorAll("a[href]") ?? []).map((anchor) => ({
      text: (anchor.textContent ?? "").trim(),
      href: anchor.getAttribute("href") ?? "",
    }));
    const images = Array.from(cell?.querySelectorAll("img[src]") ?? [])
      .map((image) => image.getAttribute("src") ?? "")
      .filter(Boolean);
    const tags = Array.from(cell?.querySelectorAll(".selected-value") ?? [])
      .map((value) => (value.textContent ?? "").trim())
      .filter(Boolean);
    const date =
      DATE_PROPERTY_TYPES.has(type) && cell
        ? (() => {
            const time = cell.querySelector("time");
            return time ? parseNotionDateElement(time, options.fallbackYear, locale) : null;
          })()
        : null;
    properties.push({
      name,
      type,
      rawValue,
      links,
      images,
      tags,
      date,
      use: "skipped",
    });
  }

  const dateCandidates: NotionDateCandidate[] = properties
    .filter((property) => DATE_PROPERTY_TYPES.has(property.type))
    .map((property) => ({
      name: property.name,
      type: property.type,
      raw: property.rawValue,
      date: property.date?.date ?? null,
      hadYear: property.date?.hadYear ?? true,
      hasTime: property.date?.hasTime ?? false,
    }));

  const wanted = options.dateProperty ? normalizeName(options.dateProperty) : "";
  let chosenDate: NotionProperty | undefined;
  if (wanted) {
    chosenDate = properties.find((property) => normalizeName(property.name) === wanted);
  } else {
    chosenDate = properties.find((property) =>
      PREFERRED_DATE_NAMES.includes(normalizeName(property.name)),
    );
    if (!chosenDate) chosenDate = properties.find((property) => property.type === "created_time");
    if (!chosenDate && dateCandidates.length === 1) {
      chosenDate = properties.find((property) => property.name === dateCandidates[0]!.name);
    }
    if (!chosenDate && dateCandidates.length > 0) {
      chosenDate = properties.find((property) => property.name === dateCandidates[0]!.name);
    }
  }

  const tagsProperty = properties.find(
    (property) =>
      TAG_PROPERTY_NAMES.has(normalizeName(property.name)) &&
      (property.type === "multi_select" || property.type === "select"),
  );
  const tags = tagsProperty?.tags ?? [];

  for (const property of properties) {
    if (property === chosenDate) {
      property.use = "date";
      continue;
    }
    if (property === tagsProperty) {
      property.use = "tags";
      continue;
    }
    if (DATE_PROPERTY_TYPES.has(property.type)) {
      property.use = "skipped";
      continue;
    }
    if (property.images.length > 0) {
      property.use = "content";
      continue;
    }
    const hasUsableLink = property.links.some(
      (link) =>
        isExternalUrl(link.href) ||
        /\.html?(?:[?#]|$)/i.test(link.href) ||
        /[0-9a-f]{32}/i.test(link.href),
    );
    if (hasUsableLink || /^https?:\/\/\S+$/i.test(property.rawValue)) {
      property.use = "content";
      continue;
    }
    property.use = "skipped";
    if (property.type === "file" && property.links.length > 0) {
      warnings.push(`arquivo nao importado: ${property.rawValue || property.name}`);
    }
  }

  // Comentarios da pagina viram citacao no comeco da nota, antes do texto; a
  // secao que o Notion deixa no fim do corpo e retirada. Os comentarios de
  // bloco continuam na posicao do bloco.
  const leading = takePageComments(body, ctx, warnings);
  for (const container of outsideCommentContainers(doc.body, body)) {
    parseCommentContainer(container, ctx, leading, warnings);
  }

  const blocks: NotionBlock[] = [...leading];
  if (description) addMarkdown(blocks, description);
  for (const property of properties) {
    if (property.use !== "content") continue;
    blocks.push(...propertyContent(property, ctx, warnings));
  }
  blocks.push(...parseBlocks(body, ctx, warnings));

  const databaseIndex = isDatabasePage(body);

  return {
    fileName,
    notionId,
    title,
    description,
    blocks,
    tags,
    recordedAt: chosenDate?.date?.date ?? null,
    dateProperty: chosenDate?.name ?? null,
    dateCandidates,
    properties,
    icon,
    isDatabaseIndex: databaseIndex,
    warnings,
  };
}
