/**
 * Corpo da nota em blocos nativos: texto, foto e bloco que o app nao edita.
 *
 * Sem WebView: o texto vira campo nativo (com negrito, italico e listas) e as
 * fotos sao arquivos locais. O markdown continua sendo o formato salvo.
 */

export interface NoteTextBlock {
  kind: 'text';
  /** Identidade do bloco: estavel enquanto o bloco existir. */
  id: string;
  /** Markdown do trecho editavel (como o bloco nasceu). */
  markdown: string;
}

export interface NoteImageBlock {
  kind: 'image';
  /** Identidade do bloco: estavel enquanto o bloco existir. */
  id: string;
  /** Referencia salva no markdown (`local:...`, `attachment:...` ou http). */
  ref: string;
  alt: string;
  /** Largura da imagem em % da nota. */
  width?: number;
}

/** Tabela ou divisoria: o app nao edita, mas nao perde. */
export interface NoteOpaqueBlock {
  kind: 'opaque';
  /** Identidade do bloco: estavel enquanto o bloco existir. */
  id: string;
  /** Markdown original: volta intacto quando a nota e salva. */
  markdown: string;
  /** Texto curto para o bloco mostrar na tela. */
  label: string;
}

export type NoteBodyBlock = NoteTextBlock | NoteImageBlock | NoteOpaqueBlock;

const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?\s*$/;
const DIVIDER = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

function countColumns(row: string): number {
  return row.split('|').length - 2;
}

/**
 * Separa o markdown em blocos: imagem, bloco opaco e texto. Nao perde linha
 * nenhuma: `joinNoteBody` devolve o markdown original.
 */
export function splitNoteBody(markdown: string): NoteBodyBlock[] {
  const blocks: NoteBodyBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let text: string[] = [];
  const flush = () => {
    if (text.length === 0) return;
    blocks.push({ kind: 'text', id: `b${blocks.length}`, markdown: text.join('\n') });
    text = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const image = IMAGE_LINE.exec(line);
    if (image) {
      flush();
      const width = image[3] ? Number(image[3]) : undefined;
      blocks.push({
        kind: 'image',
        id: `b${blocks.length}`,
        ref: image[2],
        alt: image[1],
        width: width && width > 0 && width <= 100 ? width : undefined,
      });
      continue;
    }

    if (DIVIDER.test(line)) {
      flush();
      blocks.push({
        kind: 'opaque',
        id: `b${blocks.length}`,
        markdown: line.trim(),
        label: 'divisoria',
      });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flush();
      const rows = [line];
      while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1])) {
        i += 1;
        rows.push(lines[i]);
      }
      blocks.push({
        kind: 'opaque',
        id: `b${blocks.length}`,
        markdown: rows.join('\n'),
        label: `tabela ${countColumns(rows[0])}x${rows.length}`,
      });
      continue;
    }

    text.push(line);
  }

  flush();
  return blocks;
}

/** Devolve o markdown dos blocos (o inverso de `splitNoteBody`). */
export function joinNoteBody(blocks: NoteBodyBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'text') return block.markdown;
      if (block.kind === 'opaque') return block.markdown;
      const width = block.width && block.width < 100 ? `{w=${block.width}}` : '';
      return `![${block.alt}](${block.ref})${width}`;
    })
    .join('\n');
}
