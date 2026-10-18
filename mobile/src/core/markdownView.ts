/**
 * Leitura nativa do markdown da nota.
 *
 * O corpo e markdown (o mesmo texto do dashboard). Na leitura nao ha WebView:
 * as linhas viram blocos React Native e as imagens sao arquivos locais. O
 * editor rico (WebView) so monta quando o usuario toca para editar.
 */

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Link externo. */
  link?: string;
  /** Referencia a outra nota (`note:<id>`). */
  note?: string;
}

export type MarkdownBlock =
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'heading'; level: number; spans: InlineSpan[] }
  | { type: 'quote'; spans: InlineSpan[] }
  | { type: 'list'; ordered: boolean; marker: string; spans: InlineSpan[] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'table'; text: string }
  | { type: 'divider' }
  | { type: 'image'; ref: string; alt: string; width?: number };

const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const LIST = /^\s*([-*]|\d+\.)\s+(.*)$/;
const FENCE = /^```\s*(\S*)\s*$/;
const TABLE = /^\s*\|.*\|\s*$/;
const DIVIDER = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const INLINE =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|_[^_\n]+_|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

export function parseMarkdownView(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }

    const fence = FENCE.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', text: body.join('\n'), lang: fence[1] || undefined });
      continue;
    }

    const image = IMAGE_LINE.exec(line);
    if (image) {
      const width = image[3] ? Number(image[3]) : undefined;
      blocks.push({
        type: 'image',
        ref: image[2],
        alt: image[1],
        width: width && width > 0 && width <= 100 ? width : undefined,
      });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(heading[1].length, 6),
        spans: parseInline(heading[2]),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      blocks.push({ type: 'quote', spans: parseInline(quote[1]) });
      continue;
    }

    const list = LIST.exec(line);
    if (list) {
      blocks.push({
        type: 'list',
        ordered: /^\d/.test(list[1]),
        marker: /^\d/.test(list[1]) ? list[1] : '•',
        spans: parseInline(list[2]),
      });
      continue;
    }

    if (TABLE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && TABLE.test(lines[i])) {
        body.push(lines[i].trim());
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'table', text: body.join('\n') });
      continue;
    }

    if (DIVIDER.test(line)) {
      blocks.push({ type: 'divider' });
      continue;
    }

    blocks.push({ type: 'paragraph', spans: parseInline(line) });
  }
  return blocks;
}

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let cursor = 0;
  INLINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > cursor) {
      spans.push({ text: text.slice(cursor, match.index) });
    }
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      spans.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith('`')) {
      spans.push({ text: token.slice(1, -1), code: true });
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        if (link[2].startsWith('note:')) {
          spans.push({ text: link[1], note: link[2].slice('note:'.length) });
        } else {
          spans.push({ text: link[1], link: link[2] });
        }
      } else {
        spans.push({ text: token });
      }
    } else {
      spans.push({ text: token.slice(1, -1), italic: true });
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor) });
  }
  return spans.length > 0 ? spans : [{ text: '' }];
}
