/**
 * Markdown da nota: uma camada fina sobre o conversor do BlockNote.
 *
 * O BlockNote sabe ler e escrever markdown de tabela, lista aninhada, numeracao,
 * citacao, codigo e titulo. O que ele nao sabe e a **largura da imagem**, que o
 * app define (`{w=50}`) e que precisa sobreviver: sem ela, salvar pelo dashboard
 * apagava o tamanho escolhido no celular.
 *
 * Entao: o conversor oficial faz o trabalho, e aqui a gente reposiciona o marcador
 * de largura — na ida, atando o `{w=N}` a imagem certa; na volta, aplicando a
 * largura de volta no bloco.
 */

import { BlockNoteEditor } from "@blocknote/core";
import { createNoteSchema } from "./schema";

/** Editor sem tipo de schema: aqui so interessa ler e escrever markdown. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

/**
 * Editor descartavel, so para converter markdown quando nao ha um editor em maos
 * (ler o corpo, contar palavras, diff do historico). Criar um editor custa caro,
 * entao este e criado uma vez e reaproveitado.
 */
let scratchEditor: AnyEditor | null = null;

function scratch(): AnyEditor {
  if (!scratchEditor) {
    scratchEditor = BlockNoteEditor.create({ schema: createNoteSchema() }) as AnyEditor;
  }
  return scratchEditor;
}

/** Bloco do editor, sem tipo: aqui so interessa a forma dos dados. */
type PartialBlock = Record<string, unknown>;

/** `{w=50}` depois da referencia da imagem (mesma sintaxe que o app usa). */
const WIDTH = /\{w=(\d{1,3})\}/g;

type AnyBlock = Record<string, unknown> & {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
};

function isImageBlock(block: AnyBlock): boolean {
  return block.type === "image" && typeof block.props?.attachmentId === "string";
}

function imageWidth(block: AnyBlock): number {
  const raw = Number(block.props?.width ?? 0);
  return Number.isFinite(raw) && raw > 0 && raw < 100 ? Math.round(raw) : 0;
}

/**
 * Blocos -> markdown. Reaplica o marcador de largura nas imagens logo apos a
 * linha que o conversor oficial gerou para cada uma, na ordem em que aparecem.
 */
export function blocksToNoteMarkdown(
  editor: AnyEditor,
  blocks: Record<string, unknown>[],
): string {
  const base = editor.blocksToMarkdownLossy(blocks as never[]);
  const widths = (blocks as AnyBlock[]).filter(isImageBlock).map(imageWidth);
  if (widths.length === 0) return base;

  const lines = base.split("\n");
  let image = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^!\[[^\]]*\]\([^)\s]+\)\s*$/.test(lines[i])) continue;
    const width = widths[image];
    image += 1;
    if (width > 0) lines[i] = `${lines[i].trimEnd()}{w=${width}}`;
  }
  return lines.join("\n");
}

/**
 * Markdown -> blocos.
 *
 * Imagem e um bloco sem conteudo no BlockNote, entao o conversor oficial nao
 * reconhece a sintaxe `![alt](anexo)` e a descarta. Como nos dois lados a imagem
 * sempre ocupa uma linha inteira, o texto e quebrado nesses pontos: cada trecho
 * vai para o conversor oficial e as imagens voltam como bloco, na ordem em que
 * estavam. O marcador de largura vai junto.
 */
export function noteMarkdownToBlocks(
  editor: AnyEditor,
  markdown: string,
): PartialBlock[] {
  const out: AnyBlock[] = [];
  for (const part of splitImageLines(normalizeLegacyAttachmentImages(markdown))) {
    if (part.kind === "image") {
      const props: Record<string, string> = {
        attachmentId: part.src.replace(/^attachment:/, ""),
        caption: part.alt,
      };
      if (part.width > 0) props.width = String(part.width);
      out.push({ type: "image", props } as AnyBlock);
      continue;
    }
    if (!part.text.trim()) continue;
    out.push(...(editor.tryParseMarkdownToBlocks(part.text.replace(WIDTH, "")) as AnyBlock[]));
  }
  return out as PartialBlock[];
}

/** Markdown -> blocos, criando um editor descartavel (para quem so le). */
export function blocknoteMarkdownToBlocks(markdown: string): PartialBlock[] {
  return noteMarkdownToBlocks(scratch(), markdown);
}

/** Blocos -> markdown, criando um editor descartavel (para quem so le). */
export function noteBlocksToMarkdown(blocks: Record<string, unknown>[]): string {
  return blocksToNoteMarkdown(scratch(), blocks);
}

/**
 * Texto puro de um markdown: sem marcador, sem codigo e sem tabela. E o que a
 * contagem de palavras e o diff do historico comparam.
 */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/^```[\s\S]*?^```[^\n]*$/gm, "")
    .replace(/^\|.*\|$/gm, "")
    .replace(/\[([^\]]*)\]\(note:[^)\s]+\)/g, "")
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Part =
  | { kind: "text"; text: string }
  | { kind: "image"; alt: string; src: string; width: number };

/**
 * Conserta imagens que versoes antigas do dashboard gravaram como HTML.
 *
 * Sem `toExternalHTML`, o conversor despejava o bloco renderizado no corpo:
 * `<figure><img src="/api/v1/attachments/<id>?token=...">`. Isso perdia a
 * referencia `attachment:<id>` (a imagem sumia na abertura seguinte) e deixava
 * o token da API dentro da nota. Volta para o markdown canonico, sem token.
 */
export function normalizeLegacyAttachmentImages(markdown: string): string {
  return markdown
    .replace(
      /<figure>\s*<img\b[^>]*\bsrc="[^"]*\/attachments\/([A-Za-z0-9]+)[^"]*"[^>]*>(?:\s*<figcaption>([^<]*)<\/figcaption>)?\s*<\/figure>/gi,
      (_match, id: string, caption?: string) => `![${caption ?? ""}](attachment:${id})`,
    )
    .replace(
      /<img\b[^>]*\bsrc="[^"]*\/attachments\/([A-Za-z0-9]+)[^"]*"[^>]*>/gi,
      (_match, id: string) => `![](attachment:${id})`,
    )
    .replace(
      /!\[([^\]]*)\]\(\/api\/v1\/attachments\/([A-Za-z0-9]+)[^)\s]*\)/g,
      (_match, alt: string, id: string) => `![${alt}](attachment:${id})`,
    );
}

/** Quebra o markdown nas linhas de imagem, preservando a ordem. */
function splitImageLines(markdown: string): Part[] {
  const parts: Part[] = [];
  let buffer: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = IMAGE_LINE.exec(line.trim());
    if (!match) {
      buffer.push(line);
      continue;
    }
    parts.push({ kind: "text", text: buffer.join("\n") });
    buffer = [];
    const width = match[3] ? Number(match[3]) : 0;
    parts.push({ kind: "image", alt: match[1], src: match[2], width });
  }
  parts.push({ kind: "text", text: buffer.join("\n") });
  return parts;
}

/** Imagem em linha propria, com o marcador opcional de largura. */
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d{1,3})\})?$/;