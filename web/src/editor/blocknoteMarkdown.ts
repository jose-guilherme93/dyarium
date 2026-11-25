/**
 * Markdown da nota: uma camada fina sobre o conversor do BlockNote.
 *
 * O BlockNote sabe ler e escrever markdown de tabela, lista aninhada, numeracao,
 * citacao, codigo e titulo. O que ele não sabe e a **largura da imagem** e o
 * **marcador de audio**, que o app define (`{w=50}`, `!audio[...]`) e que
 * precisam sobreviver: sem eles, salvar pelo dashboard apagava o tamanho da foto
 * e transformava o audio em texto solto.
 *
 * Entao: o conversor oficial faz o trabalho, e aqui a gente reposiciona os
 * marcadores — na ida, atando o `{w=N}` a imagem certa; na volta, aplicando a
 * largura de volta no bloco e trocando o paragrafo temporario do audio pelo
 * marcador canonico.
 */

import { BlockNoteEditor } from "@blocknote/core";
import { AUDIO_PLACEHOLDER, DETAILS_PLACEHOLDER, audioMarker, createNoteSchema } from "./schema";

/** Editor sem tipo de schema: aqui so interessa ler e escrever markdown. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

/**
 * Editor descartavel, so para converter markdown quando não ha um editor em maos
 * (ler o corpo, contar palavras, diff do histórico). Criar um editor custa caro,
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

/** Marcador de midia: `{w=50}` / `{w=50,c=1}` / `{c=1}`. */
const MARKER = /\{(?:w=\d{1,3}(?:,c=[01])?|c=[01])\}/g;

type AnyBlock = Record<string, unknown> & {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
};

function isImageBlock(block: AnyBlock): boolean {
  return (
    block.type === "image" &&
    typeof block.props?.attachmentId === "string" &&
    block.props.attachmentId.trim() !== ""
  );
}

function isAudioBlock(block: AnyBlock): boolean {
  return block.type === "audio" && typeof block.props?.attachmentId === "string";
}

function imageWidth(block: AnyBlock): number {
  const raw = Number(block.props?.width ?? 0);
  return Number.isFinite(raw) && raw > 0 && raw < 100 ? Math.round(raw) : 0;
}

/** `1` = cor original, `0` = preto e branco, vazio = padrao do contexto. */
function imageColor(block: AnyBlock): string {
  const raw = String(block.props?.color ?? "");
  return raw === "1" || raw === "0" ? raw : "";
}

/** Marcador de uma imagem, com largura e/ou excecao de cor. */
function imageMarker(width: number, color: string): string {
  const parts: string[] = [];
  if (width > 0) parts.push(`w=${width}`);
  if (color) parts.push(`c=${color}`);
  return parts.length > 0 ? `{${parts.join(",")}}` : "";
}

/**
 * Blocos -> markdown. O conversor oficial gera o texto e o paragrafo temporario
 * de cada audio; aqui os marcadores são repostos no lugar certo: o `{w=N}` na
 * imagem e o `!audio[...]{d=...}` no audio.
 */
export function blocksToNoteMarkdown(
  editor: AnyEditor,
  blocks: Record<string, unknown>[],
): string {
  const typed = blocks as AnyBlock[];
  // Foto ainda subindo nao tem anexo: nao entra no corpo, senao o autosave
  // gravaria um `attachment:` vazio e a imagem sumiria ao reabrir.
  const savable = typed.filter(
    (block) => block.type !== "image" || isImageBlock(block),
  );
  const base = editor.blocksToMarkdownLossy(savable as never[]);
  const images = savable.filter(isImageBlock).map((block) => ({
    width: imageWidth(block),
    color: imageColor(block),
  }));
  const audioById = new Map<string, AnyBlock>();
  for (const block of savable) {
    if (!isAudioBlock(block)) continue;
    const id = String(block.props?.attachmentId ?? "");
    if (id) audioById.set(id, block);
  }
  const detailsBlocks = savable.filter((block) => block.type === "details");
  if (images.length === 0 && audioById.size === 0 && detailsBlocks.length === 0) return base;

  const lines = base.split("\n");
  const out: string[] = [];
  let image = 0;
  const detailsQueue = [...detailsBlocks];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === DETAILS_PLACEHOLDER) {
      const block = detailsQueue.shift();
      if (block) {
        const summary = String(block.props?.summary ?? "Detalhes técnicos");
        const open = Boolean(block.props?.open);
        const body = String(block.props?.body ?? "");
        out.push(open ? `:::details open ${summary}` : `:::details ${summary}`);
        if (body !== "") out.push(...body.split("\n"));
        out.push(":::");
        continue;
      }
    }
    if (trimmed.startsWith(AUDIO_PLACEHOLDER)) {
      // So troca quando o paragrafo veio do bloco de audio de verdade: um texto
      // do usuario que por acaso comece com o prefixo fica como esta.
      const audio = audioById.get(trimmed.slice(AUDIO_PLACEHOLDER.length));
      if (audio) {
        out.push(
          audioMarker(
            String(audio.props?.attachmentId ?? ""),
            String(audio.props?.duration ?? ""),
          ),
        );
        continue;
      }
      out.push(lines[i]);
      continue;
    }
    if (/^!\[[^\]]*\]\([^)\s]+\)\s*$/.test(lines[i])) {
      const current = images[image];
      image += 1;
      const marker = imageMarker(current?.width ?? 0, current?.color ?? "");
      if (marker) out.push(`${lines[i].trimEnd()}${marker}`);
      else out.push(lines[i]);
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/**
 * Markdown -> blocos.
 *
 * Imagem e audio sao blocos sem conteudo no BlockNote, entao o conversor oficial
 * não reconhece a sintaxe `![alt](anexo)` nem `!audio[anexo]` e a descarta. Como
 * nos dois lados cada midia sempre ocupa uma linha inteira, o texto e quebrado
 * nesses pontos: cada trecho vai para o conversor oficial e as midias voltam
 * como bloco, na ordem em que estavam. Os marcadores vao junto.
 */
export function noteMarkdownToBlocks(
  editor: AnyEditor,
  markdown: string,
): PartialBlock[] {
  const normalized = normalizeLegacyAttachmentImages(markdown);
  const out: AnyBlock[] = [];
  for (const segment of splitDetailsFences(normalized)) {
    if (segment.kind === "details") {
      out.push({
        type: "details",
        props: {
          summary: segment.summary,
          body: segment.body,
          open: segment.open,
        },
      } as AnyBlock);
      continue;
    }
    for (const part of splitMediaLines(segment.text)) {
      if (part.kind === "image") {
        const props: Record<string, string> = {
          attachmentId: part.src.replace(/^attachment:/, ""),
          caption: part.alt,
        };
        if (part.width > 0) props.width = String(part.width);
        if (part.color) props.color = part.color;
        out.push({ type: "image", props } as AnyBlock);
        continue;
      }
      if (part.kind === "audio") {
        out.push({
          type: "audio",
          props: {
            attachmentId: part.src.replace(/^attachment:/, ""),
            duration: part.duration,
          },
        } as AnyBlock);
        continue;
      }
      if (!part.text.trim()) continue;
      out.push(...(editor.tryParseMarkdownToBlocks(part.text.replace(MARKER, "")) as AnyBlock[]));
    }
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
 * contagem de palavras e o diff do histórico comparam.
 */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/^```[\s\S]*?^```[^\n]*$/gm, "")
    .replace(/^\|.*\|$/gm, "")
    .replace(/!audio\[[^\]]*\](?:\{d=[^}]*\})?/g, "")
    .replace(/\[([^\]]*)\]\(note:[^)\s]+\)/g, "")
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/\{(?:w=\d{1,3}(?:,c=[01])?|c=[01])\}/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ids de anexo de audio citados no corpo, na ordem em que aparecem. A tela usa
 * isto para nao repetir na pilha do topo um audio que ja tem player no texto.
 */
export function audioAttachmentIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(/!audio\[attachment:([^\]\s]+)\]/g)) {
    ids.add(match[1]);
  }
  return ids;
}

type Part =
  | { kind: "text"; text: string }
  | { kind: "image"; alt: string; src: string; width: number; color: string }
  | { kind: "audio"; src: string; duration: string };

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

type DetailsSegment =
  | { kind: "text"; text: string }
  | { kind: "details"; summary: string; body: string; open: boolean };

/** Extrai blocos `:::details` do markdown, preservando o texto ao redor. */
function splitDetailsFences(markdown: string): DetailsSegment[] {
  const lines = markdown.split("\n");
  const result: DetailsSegment[] = [];
  let buffer: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const opening = /^:::details(?:\s+(.*))?$/.exec(trimmed);
    if (!opening) {
      buffer.push(lines[i]);
      i += 1;
      continue;
    }
    const rest = (opening[1] ?? "").trim();
    const tokens = rest.split(/\s+/).filter(Boolean);
    let open = false;
    let summaryTokens = tokens;
    if (tokens[0] === "open") {
      open = true;
      summaryTokens = tokens.slice(1);
    }
    const summary = summaryTokens.join(" ") || "Detalhes técnicos";

    // Procura o fechamento `:::`.
    let j = i + 1;
    const bodyLines: string[] = [];
    let found = false;
    while (j < lines.length) {
      if (lines[j].trim() === ":::") {
        found = true;
        break;
      }
      bodyLines.push(lines[j]);
      j += 1;
    }
    if (!found) {
      buffer.push(lines[i]);
      i += 1;
      continue;
    }
    if (buffer.length > 0) {
      result.push({ kind: "text", text: buffer.join("\n") });
      buffer = [];
    }
    result.push({ kind: "details", summary, body: bodyLines.join("\n"), open });
    i = j + 1;
  }
  if (buffer.length > 0 || result.length === 0) {
    result.push({ kind: "text", text: buffer.join("\n") });
  }
  return result;
}

/** Quebra o markdown nas linhas de midia, preservando a ordem. */
function splitMediaLines(markdown: string): Part[] {
  const parts: Part[] = [];
  let buffer: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    const image = IMAGE_LINE.exec(trimmed);
    const audio = image ? null : AUDIO_LINE.exec(trimmed);
    if (!image && !audio) {
      buffer.push(line);
      continue;
    }
    parts.push({ kind: "text", text: buffer.join("\n") });
    buffer = [];
    if (image) {
      const width = image[3] ? Number(image[3]) : 0;
      const color = image[4] ?? "";
      parts.push({ kind: "image", alt: image[1], src: image[2], width, color });
    } else if (audio) {
      parts.push({ kind: "audio", src: audio[1], duration: audio[2] ?? "" });
    }
  }
  parts.push({ kind: "text", text: buffer.join("\n") });
  return parts;
}

/** Imagem em linha propria, com marcador opcional de largura e cor. */
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{(?:w=(\d{1,3}))?(?:,?c=([01]))?\})?$/;

/** Audio em linha propria, com a duracao opcional em segundos. */
const AUDIO_LINE = /^!audio\[([^\]\s]+)\](?:\{d=([0-9]+(?:\.[0-9]+)?)\})?$/;
