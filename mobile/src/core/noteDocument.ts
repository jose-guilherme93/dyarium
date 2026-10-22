/**
 * Documento da nota: o texto e as midias, na ordem em que aparecem.
 *
 * O markdown continua sendo o formato canonico (servidor, dashboard, backup).
 * O corpo, porem, e **um editor so**: o texto inteiro da nota (todos os
 * paragrafos) e um no, e cada midia e um no proprio. Isso importa porque o
 * editor e o campo nativo do app: um editor por paragrafo fazia o campo ser
 * desmontado e remontado a cada troca de paragrafo, e o custo (e o lag) era
 * do documento inteiro.
 *
 * Marcadores no markdown:
 * - imagem: `![alt](local:arquivo.jpg){w=50}` (a linha inteira e um no);
 * - audio: `!audio[local:audio.aac]{d=12.5}` (duracao em segundos, opcional).
 *
 * O parser e o serializer sao puros e devolvem exatamente o markdown de entrada
 * quando nada muda: o texto de um no e o conteudo que o editor mostra, as
 * quebras que fecham a linha antes de uma midia ficam no `breakAfter` do no, e
 * os nos sao concatenados (conteudo + separador) na volta. A insercao no
 * cursor divide o no de texto na posicao exata, que e o que permite colocar
 * foto e audio entre dois trechos de texto.
 */

import { clampImageWidth } from './image';

export interface NoteTextNode {
  kind: 'text';
  /** Identidade estavel enquanto a estrutura do documento nao muda. */
  id: string;
  /**
   * O texto do trecho: e o que o editor mostra e devolve.
   *
   * As quebras de linha do usuario estao aqui dentro (inclusive as linhas em
   * branco entre os paragrafos e as do fim do texto).
   */
  markdown: string;
  /**
   * As quebras de linha que ficam **depois** do trecho, antes do proximo no.
   *
   * E o separador da midia que vem a seguir: nao faz parte do texto que o
   * editor mostra e nao pode ser misturado com ele, senao as quebras que o
   * usuario digita no fim do texto somem.
   */
  breakAfter?: string;
}

export interface NoteImageNode {
  kind: 'image';
  id: string;
  /** Referencia canonica (`local:...`, `attachment:...` ou URL). */
  ref: string;
  alt: string;
  /** Largura em percentual da nota (100 = largura total). */
  width: number;
  /** As quebras de linha depois da midia (o separador do texto seguinte). */
  breakAfter?: string;
}

export interface NoteAudioNode {
  kind: 'audio';
  id: string;
  /** Referencia canonica (`local:...` ou `attachment:...`). */
  ref: string;
  /** Duracao conhecida; 0 quando o marcador nao a traz. */
  durationMs: number;
  /** As quebras de linha depois da midia (o separador do texto seguinte). */
  breakAfter?: string;
}

export type NoteNode = NoteTextNode | NoteImageNode | NoteAudioNode;

/** Posicao de insercao: no de texto e deslocamento no texto visivel. */
export interface NoteInsertPosition {
  /** Id do no de texto onde a insercao acontece. */
  nodeId: string;
  /** Deslocamento no texto visivel do no. */
  offset: number;
}

const AUDIO_LINE = /^\s*!audio\[([^\]\s]+)\](?:\{d=([0-9]+(?:\.[0-9]+)?)\})?\s*$/;
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?\s*$/;

/**
 * Teto de um no de texto.
 *
 * O no de texto e o **editor nativo** do app: um no por paragrafo faria o
 * campo ser desmontado e remontado a cada troca de paragrafo (com o custo e o
 * lag do documento inteiro). Por isso o texto da nota e um no so, e o teto
 * existe so para o caso de uma nota gigante.
 *
 * O corte e em fronteira de palavra e as partes voltam coladas no markdown: o
 * texto do usuario nao muda. O editor continua sendo um so para o que o usuario
 * esta lendo e editando.
 */
export const MAX_TEXT_CHARS = 8000;

function textNode(markdown: string, index: number, breakAfter = ''): NoteTextNode {
  return { kind: 'text', id: `t${index}`, markdown, breakAfter };
}

function audioNode(
  ref: string,
  durationMs: number,
  index: number,
  breakAfter = '',
): NoteAudioNode {
  return { kind: 'audio', id: `a${index}`, ref, durationMs, breakAfter };
}

function imageNode(
  ref: string,
  alt: string,
  width: number,
  index: number,
  breakAfter = '',
): NoteImageNode {
  return { kind: 'image', id: `i${index}`, ref, alt, width, breakAfter };
}

/**
 * Separa o markdown em nos: o texto (todo ele, com os paragrafos dentro) e as
 * midias, na ordem em que aparecem.
 *
 * O texto de um no e o **conteudo** que o editor mostra; as quebras que
 * fecham a linha antes de uma midia ficam no `breakAfter` do no. Os nos sao
 * concatenados na volta (conteudo + separador), entao
 * `serializeNoteDocument(parseNoteDocument(x))` devolve `x` sem perder linha,
 * espaco ou marcador.
 */
export function parseNoteDocument(markdown: string): NoteNode[] {
  const text = markdown.replace(/\r\n/g, '\n');
  const nodes: NoteNode[] = [];

  let offset = 0;
  let segmentStart = 0;
  let hasText = false;

  /**
   * Fecha o trecho de texto.
   *
   * O conteudo vai inteiro para o no (com as quebras do usuario). Se uma
   * midia vier depois, as quebras do fim do trecho viram o separador dela.
   */
  const pushText = (end: number) => {
    const slice = hasText ? text.slice(segmentStart, end) : '';
    hasText = false;
    if (slice === '') {
      // Uma midia logo depois de outra (ou no fim do documento) precisa de um
      // trecho de texto vazio: e o lugar onde o usuario digita abaixo dela.
      // Sem esse no, a pagina fica sem campo nenhum depois da ultima midia.
      if (nodes[nodes.length - 1]?.kind !== 'text' && nodes.length > 0) {
        nodes.push(textNode('', nodes.length));
      }
      return;
    }
    for (const part of splitSegment(slice)) {
      nodes.push(textNode(part, nodes.length));
    }
  };

  for (const line of text.split('\n')) {
    const audio = AUDIO_LINE.exec(line);
    const image = audio ? null : IMAGE_LINE.exec(line);
    if (audio ?? image) {
      // O texto ate aqui e um no so (todos os paragrafos juntos).
      pushText(offset);

      // A midia ocupa a propria linha: as quebras do fim do texto vao para
      // o separador (o editor mostra so o conteudo) e as quebras depois da
      // midia tambem (o texto seguinte comeca na linha seguinte).
      const previous = nodes[nodes.length - 1];
      if (previous?.kind === 'text') {
        const content = previous.markdown.replace(/\n+$/, '');
        nodes[nodes.length - 1] = {
          ...previous,
          markdown: content,
          breakAfter: `${previous.breakAfter ?? ''}${previous.markdown.slice(content.length)}`,
        };
      }
      const lineEnd = offset + line.length + 1;
      let after = lineEnd;
      while (after < text.length && text[after] === '\n') after += 1;
      // O separador da midia comeca na quebra que fecha a linha dela.
      const breakAfter = text.slice(offset + line.length, after);

      if (audio) {
        const seconds = audio[2] ? Number(audio[2]) : 0;
        const durationMs =
          Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
        nodes.push(audioNode(audio[1], durationMs, nodes.length, breakAfter));
      } else if (image) {
        const rawWidth = image[3] ? Number(image[3]) : 100;
        const width = Number.isFinite(rawWidth) ? Math.min(100, Math.max(1, rawWidth)) : 100;
        nodes.push(imageNode(image[2], image[1], width, nodes.length, breakAfter));
      }
      // A proxima linha comeca depois da linha da midia; o texto seguinte
      // comeca depois das quebras que a midia carrega.
      offset = lineEnd;
      segmentStart = after;
      continue;
    }
    hasText = true;
    offset += line.length + 1;
  }
  pushText(text.length);

  if (nodes.length === 0) nodes.push(textNode('', 0));
  return nodes;
}

/**
 * Corta um trecho de texto grande demais, na fronteira de uma palavra.
 *
 * As partes voltam coladas: o markdown do usuario nao muda. So entra em jogo
 * com uma nota enorme, e ainda assim o usuario esta lendo e editando um no so
 * por vez.
 */
function splitSegment(text: string): string[] {
  if (text.length <= MAX_TEXT_CHARS) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_TEXT_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_TEXT_CHARS);
    if (cut <= 0) {
      parts.push(rest.slice(0, MAX_TEXT_CHARS));
      rest = rest.slice(MAX_TEXT_CHARS);
      continue;
    }
    parts.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  parts.push(rest);
  return parts;
}

function seconds(durationMs: number): string {
  const value = Math.max(0, durationMs) / 1000;
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Devolve o markdown dos nos, na ordem.
 *
 * Cada no contribui com o seu conteudo e com o separador que vem depois dele
 * (as quebras entre o no e o proximo). As partes de um trecho cortado voltam
 * coladas. O markdown de entrada volta igual.
 */
export function serializeNoteDocument(nodes: NoteNode[]): string {
  let out = '';
  let previous: NoteNode['kind'] | null = null;
  for (const node of nodes) {
    const piece = serializeNode(node);
    // Texto digitado logo abaixo de uma midia precisa de uma quebra: sem ela,
    // a linha `![foto](...)texto` deixaria de ser imagem na proxima abertura.
    if (
      node.kind === 'text' &&
      piece !== '' &&
      (previous === 'image' || previous === 'audio') &&
      !out.endsWith('\n')
    ) {
      out += '\n';
    }
    out += `${piece}${node.breakAfter ?? ''}`;
    previous = node.kind;
  }
  return out;
}

function serializeNode(node: NoteNode): string {
  if (node.kind === 'text') return node.markdown;
  if (node.kind === 'audio') {
    const duration = node.durationMs > 0 ? `{d=${seconds(node.durationMs)}}` : '';
    return `!audio[${node.ref}]${duration}`;
  }
  const width = node.width > 0 && node.width < 100 ? `{w=${Math.round(node.width)}}` : '';
  return `![${node.alt}](${node.ref})${width}`;
}

/** Nos de audio do documento, na ordem em que aparecem. */
export function noteAudioNodes(markdown: string): NoteAudioNode[] {
  return parseNoteDocument(markdown).filter(
    (node): node is NoteAudioNode => node.kind === 'audio',
  );
}

/** Nos de imagem do documento, na ordem em que aparecem. */
export function noteImageNodes(markdown: string): NoteImageNode[] {
  return parseNoteDocument(markdown).filter(
    (node): node is NoteImageNode => node.kind === 'image',
  );
}

/**
 * Remove um no de imagem/audio da lista. Os dois trechos de texto que ficam
 * vizinhos viram um so, na mesma ordem, para o usuario continuar digitando sem
 * um paragrafo fantasma no lugar da midia.
 *
 * A edicao do corpo trabalha na lista (e nao no markdown): os ids dos nos nao
 * mudam e a foto nao pode "pular" de lugar por causa de um id recalculado.
 */
export function removeFromNoteNodes(nodes: NoteNode[], id: string): NoteNode[] {
  const index = nodes.findIndex((node) => node.id === id && node.kind !== 'text');
  if (index < 0) return nodes;
  const next = [...nodes.slice(0, index), ...nodes.slice(index + 1)];
  const at = index - 1;
  const left = next[at];
  const right = next[index];
  if (left?.kind === 'text' && right?.kind === 'text') {
    // Os dois trechos viram um so. O conteudo de cada um se concatena e o
    // separador do primeiro fica no meio (a midia que estava entre eles
    // desapareceu, mas as quebras em volta dela continuam).
    next.splice(at, 2, {
      ...left,
      markdown: `${left.markdown}${left.breakAfter ?? ''}${right.markdown}`,
      breakAfter: right.breakAfter ?? '',
    });
  }
  return next;
}

/** Remove um no de midia do markdown (a nota inteira). */
export function removeNoteNode(markdown: string, id: string): string {
  return serializeNoteDocument(removeFromNoteNodes(parseNoteDocument(markdown), id));
}

/**
 * Muda a largura de um no de imagem (percentual da largura da nota), na lista.
 *
 * A largura faz parte do documento: ela viaja no markdown (`{w=50}`) e e o
 * que mantem a foto do mesmo tamanho no app e no dashboard. Uma largura fora
 * da faixa segura e ajustada para dentro dela.
 */
export function setWidthInNoteNodes(
  nodes: NoteNode[],
  id: string,
  percent: number,
): NoteNode[] {
  const index = nodes.findIndex((node) => node.id === id && node.kind === 'image');
  if (index < 0) return nodes;
  const node = nodes[index] as NoteImageNode;
  const width = clampImageWidth(percent);
  if (width === node.width) return nodes;
  const next = [...nodes];
  next[index] = { ...node, width };
  return next;
}

/** Muda a largura de uma foto no markdown (a nota inteira). */
export function setNoteNodeWidth(markdown: string, id: string, percent: number): string {
  return serializeNoteDocument(setWidthInNoteNodes(parseNoteDocument(markdown), id, percent));
}

/** Troca a referencia de audio (por exemplo `local:` -> `attachment:`) sem mexer no resto. */
export function replaceAudioRef(markdown: string, from: string, to: string): string {
  if (from === to || !markdown.includes(from)) return markdown;
  const nodes = parseNoteDocument(markdown).map((node) =>
    node.kind === 'audio' && node.ref === from ? { ...node, ref: to } : node,
  );
  return serializeNoteDocument(nodes);
}

/**
 * Insere um no no cursor, na lista. Sem posicao (ou posicao invalida), entra no
 * fim. A midia sempre deixa um trecho de texto do lado direito (mesmo vazio):
 * e ali que o usuario continua digitando embaixo dela.
 */
export function insertIntoNoteNodes(
  nodes: NoteNode[],
  node: NoteImageNode | NoteAudioNode,
  at?: NoteInsertPosition | null,
): NoteNode[] {
  const index = at ? nodes.findIndex((item) => item.id === at.nodeId && item.kind === 'text') : -1;

  if (index < 0) {
    // Sem cursor: a midia entra no fim da nota, na sua propria linha.
    const last = nodes[nodes.length - 1];
    if (!last) return [{ ...node, breakAfter: '\n' }, textNode('', 1)];
    if (last.kind === 'text' && last.markdown === '') {
      // O trecho vazio continua sendo o lugar de digitar, agora depois da
      // midia nova (o resto do documento fica como esta).
      return [
        ...nodes.slice(0, -1),
        { ...node, breakAfter: '\n' },
        { ...last, breakAfter: '' },
      ];
    }
    if (last.kind === 'text') {
      return [
        ...nodes.slice(0, -1),
        { ...last, breakAfter: `${last.breakAfter ?? ''}\n` },
        { ...node, breakAfter: '\n' },
        textNode('', nodes.length + 1),
      ];
    }
    return [...nodes, { ...node, breakAfter: '\n' }, textNode('', nodes.length + 1)];
  }

  const target = nodes[index] as NoteTextNode;
  const { before, after } = splitMarkdownAtCursor(target.markdown, at?.offset ?? 0);
  // A midia entra na sua propria linha: o markdown continua legivel (e a
  // foto continua no meio do texto, como no corpo).
  const head = before.replace(/\n+$/, '');
  const replacement: NoteNode[] = [];
  if (head !== '') {
    replacement.push({ ...target, markdown: head, breakAfter: '\n' });
  }
  // A midia fecha a propria linha: o texto que vem depois ja comeca na linha
  // seguinte.
  replacement.push({ ...node, breakAfter: '\n' });
  replacement.push({
    ...target,
    id: `${target.id}b`,
    markdown: after,
    breakAfter: target.breakAfter ?? '',
  });

  return [...nodes.slice(0, index), ...replacement, ...nodes.slice(index + 1)];
}

/** Insere um no de midia no markdown (a nota inteira). */
export function insertNoteNode(
  markdown: string,
  node: NoteImageNode | NoteAudioNode,
  at?: NoteInsertPosition | null,
): string {
  return serializeNoteDocument(insertIntoNoteNodes(parseNoteDocument(markdown), node, at));
}

/**
 * Divide o markdown de um no no deslocamento do texto visivel. Marcadores de
 * enfase/codigo abertos sao fechados de um lado e reabertos do outro; o prefixo
 * de bloco (lista, citacao, titulo) e repetido quando a divisao cai no meio da
 * linha.
 */
export function splitMarkdownAtCursor(
  markdown: string,
  offset: number,
): { before: string; after: string } {
  const visible = Math.max(0, Math.round(offset));
  // As quebras de linha das pontas do trecho sao separadores (a linha em
  // branco antes de uma midia, por exemplo): elas nao sao texto visivel, e o
  // cursor conta so o que o usuario ve.
  const leading = markdown.match(/^\n*/)?.[0].length ?? 0;
  const trailing = markdown.match(/\n*$/)?.[0].length ?? 0;
  const core = markdown.slice(leading, markdown.length - trailing);
  const index = leading + markdownIndexAtVisibleOffset(core, visible);
  let before = markdown.slice(0, index);
  let after = markdown.slice(index);
  if (after === '' && before === '') return { before: '', after: '' };

  const marks = openInlineMarks(before);
  const closers = marks.map((mark) => mark.close).reverse().join('');
  const openers = marks.map((mark) => mark.open).join('');
  before += closers;
  after = openers + after;

  const prefix = lineBlockPrefix(before);
  if (prefix && after.trim() !== '' && !after.startsWith(prefix)) {
    after = prefix + after;
  }
  return { before, after };
}

interface InlineMark {
  open: string;
  close: string;
}

/** Marcadores inline abertos no fim do trecho, na ordem em que foram abertos. */
function openInlineMarks(value: string): InlineMark[] {
  const stack: InlineMark[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '`') {
      const open = stack.findIndex((mark) => mark.open === '`');
      if (open >= 0) stack.splice(open, 1);
      else stack.push({ open: '`', close: '`' });
      index += 1;
      continue;
    }
    const pair = value.slice(index, index + 2);
    if (pair === '**' || pair === '__' || pair === '~~') {
      const open = pair === '__' ? '_' : pair;
      const close = open;
      const position = stack.findIndex((mark) => mark.open === open);
      if (position >= 0) stack.splice(position, 1);
      else stack.push({ open, close });
      index += 2;
      continue;
    }
    if (char === '*' || char === '_') {
      const position = stack.findIndex((mark) => mark.open === char);
      if (position >= 0) stack.splice(position, 1);
      else stack.push({ open: char, close: char });
      index += 1;
      continue;
    }
    index += 1;
  }
  return stack;
}

/** Prefixo de bloco da ultima linha, quando houver. */
function lineBlockPrefix(value: string): string | undefined {
  const line = value.slice(value.lastIndexOf('\n') + 1);
  const match = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/.exec(line);
  if (!match) return undefined;
  // A divisao antes do conteudo da linha nao precisa repetir o prefixo.
  if (line.length <= match[1].length + match[2].length) return undefined;
  return match[1] + match[2];
}

/**
 * Indice do markdown correspondente ao deslocamento no texto visivel. Marcadores
 * de formatacao nao contam; imagens contam como um caractere (o objeto).
 */
export function markdownIndexAtVisibleOffset(markdown: string, offset: number): number {
  let visible = 0;
  let index = 0;
  while (index < markdown.length) {
    const atLineStart = index === 0 || markdown[index - 1] === '\n';
    if (atLineStart) {
      // Cursor antes do marcador de lista/titulo divide antes dele, nao depois.
      if (visible >= offset) return index;
      const prefix = /^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/.exec(markdown.slice(index));
      if (prefix) {
        index += prefix[0].length;
        continue;
      }
    }

    const char = markdown[index];
    if (char === '\\' && index + 1 < markdown.length) {
      if (visible >= offset) return index;
      visible += 1;
      index += 2;
      continue;
    }

    if (char === '`') {
      const end = markdown.indexOf('`', index + 1);
      if (end > index) {
        const content = markdown.slice(index + 1, end);
        if (offset <= visible + content.length) {
          return index + 1 + Math.max(0, offset - visible);
        }
        visible += content.length;
        index = end + 1;
        continue;
      }
    }

    if (char === '!' && markdown[index + 1] === '[') {
      const end = markerEnd(markdown, index);
      if (end > index) {
        if (visible >= offset) return index;
        visible += 1;
        index = end;
        continue;
      }
    }

    if (char === '[') {
      const link = /^\[([^\]]*)\]\(([^)]*)\)/.exec(markdown.slice(index));
      if (link) {
        const label = link[1];
        if (offset <= visible + label.length) {
          return index + 1 + Math.max(0, offset - visible);
        }
        visible += label.length;
        index += link[0].length;
        continue;
      }
    }

    if ((char === '*' || char === '_' || char === '~') && markdown[index + 1] === char) {
      index += 2;
      continue;
    }
    if (char === '*' || char === '_') {
      index += 1;
      continue;
    }

    if (visible >= offset) return index;
    visible += 1;
    index += 1;
  }
  return markdown.length;
}

/** Fim do marcador `![...](...)` ou `!audio[...]`, ou -1. */
function markerEnd(value: string, start: number): number {
  if (value.startsWith('!audio[', start)) {
    const close = value.indexOf(']', start);
    return close >= 0 ? close + 1 : -1;
  }
  const open = value.indexOf('](', start);
  if (open < 0) return -1;
  const close = value.indexOf(')', open + 2);
  return close >= 0 ? close + 1 : -1;
}
