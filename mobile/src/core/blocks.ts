/**
 * Ponte entre o markdown do app e o documento de blocos do BlockNote.
 *
 * O dashboard guarda o corpo da nota como `document` (JSON de blocos do
 * BlockNote: PartialBlock[]); o app edita markdown. Este modulo converte nos
 * dois sentidos, para a mesma nota ser aberta e editada nos dois lados.
 *
 * Puro: nada de imports nativos. A conversao e best-effort para documentos
 * arbitrarios vindos do web; para o subconjunto que o app gera, a ida e a
 * volta sao estaveis (ver blocks.test.ts).
 *
 * Formatos seguem o schema padrao do BlockNote (props de paragraph/heading/
 * lista/citacao/codigo/imagem e conteudo inline text/link).
 */

export interface StyledText {
  type: 'text';
  text: string;
  styles: Record<string, boolean>;
}

export interface LinkInline {
  type: 'link';
  href: string;
  content: StyledText[];
}

export type InlineContent = StyledText | LinkInline;

export interface Block {
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[];
  children?: Block[];
}

const FENCE = /^```\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const CHECK = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+\.\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

function text(value: string, styles: Record<string, boolean> = {}): StyledText {
  return { type: 'text', text: value, styles };
}

/**
 * Quebra uma linha em conteudo inline do BlockNote: negrito (**), italico (* ou
 * _), codigo (`) e link ([texto](url)). Sem aninhamento.
 */
export function parseInline(value: string): InlineContent[] {
  const nodes: InlineContent[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) {
      nodes.push(text(buffer));
      buffer = '';
    }
  };

  while (i < value.length) {
    const char = value[i];

    if (char === '`') {
      const end = value.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        nodes.push(text(value.slice(i + 1, end), { code: true }));
        i = end + 1;
        continue;
      }
    }

    if (value.startsWith('**', i)) {
      const end = value.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        nodes.push(text(value.slice(i + 2, end), { bold: true }));
        i = end + 2;
        continue;
      }
    }

    if (char === '[') {
      const match = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(value.slice(i));
      if (match) {
        flush();
        nodes.push({ type: 'link', href: match[2], content: [text(match[1])] });
        i += match[0].length;
        continue;
      }
    }

    if ((char === '*' || char === '_') && value[i + 1] !== char) {
      const end = value.indexOf(char, i + 1);
      if (end > i + 1) {
        flush();
        nodes.push(text(value.slice(i + 1, end), { italic: true }));
        i = end + 1;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return nodes.length > 0 ? nodes : [text('')];
}

function inlineToMarkdown(content: InlineContent[] | undefined): string {
  if (!content || content.length === 0) return '';
  return content
    .map((node) => {
      if (node.type === 'link') {
        return `[${inlineToMarkdown(node.content)}](${node.href})`;
      }
      const raw = node.text;
      if (node.styles.code) return `\`${raw}\``;
      let out = raw;
      if (node.styles.bold) out = `**${out}**`;
      if (node.styles.italic) out = `_${out}_`;
      return out;
    })
    .join('');
}

/** Converte o markdown do app em blocos do BlockNote. */
export function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1];
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // fecha a cerca (ou fim)
      const props: Record<string, unknown> = {};
      if (language) props.language = language;
      blocks.push({ type: 'codeBlock', props, content: [text(code.join('\n'))] });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        props: { level: heading[1].length },
        content: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    const check = CHECK.exec(line);
    if (check) {
      blocks.push({
        type: 'checkListItem',
        props: { checked: check[1].toLowerCase() === 'x' },
        content: parseInline(check[2]),
      });
      i += 1;
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      blocks.push({ type: 'bulletListItem', content: parseInline(bullet[1]) });
      i += 1;
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      blocks.push({ type: 'numberedListItem', content: parseInline(numbered[1]) });
      i += 1;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      blocks.push({ type: 'quote', content: parseInline(quote[1]) });
      i += 1;
      continue;
    }

    const image = IMAGE.exec(line);
    if (image) {
      blocks.push({ type: 'image', props: { url: image[2], caption: image[1] } });
      i += 1;
      continue;
    }

    blocks.push({ type: 'paragraph', content: parseInline(line) });
    i += 1;
  }

  return blocks;
}

function indent(value: string, depth: number): string {
  if (depth <= 0) return value;
  return value
    .split('\n')
    .map((line) => `${'  '.repeat(depth)}${line}`)
    .join('\n');
}

function blockToMarkdown(block: Block, depth: number): string {
  const body = inlineToMarkdown(block.content);
  const props = block.props ?? {};
  const level = typeof props.level === 'number' ? props.level : 1;

  switch (block.type) {
    case 'heading':
      return indent(`${'#'.repeat(Math.min(6, Math.max(1, level)))} ${body}`, depth);
    case 'bulletListItem':
      return indent(`- ${body}`, depth);
    case 'numberedListItem':
      return indent(`1. ${body}`, depth);
    case 'checkListItem':
      return indent(`- [${props.checked ? 'x' : ' '}] ${body}`, depth);
    case 'quote':
      return indent(`> ${body}`, depth);
    case 'codeBlock': {
      const language = typeof props.language === 'string' ? props.language : '';
      return `${indent(`\`\`\`${language}`, depth)}\n${block.content?.map((n) => (n.type === 'text' ? n.text : '')).join('')}\n${indent('```', depth)}`;
    }
    case 'image': {
      const url = typeof props.url === 'string' ? props.url : '';
      const caption = typeof props.caption === 'string' ? props.caption : '';
      return indent(`![${caption}](${url})`, depth);
    }
    case 'paragraph':
    default:
      return indent(body, depth);
  }
}

/** Converte blocos do BlockNote de volta para o markdown do app. */
export function blocksToMarkdown(blocks: Block[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    lines.push(blockToMarkdown(block, 0));
    if (block.children && block.children.length > 0) {
      for (const child of block.children) {
        lines.push(blockToMarkdown(child, 1));
      }
    }
  }
  return lines.join('\n').replace(/\n+$/, '');
}
