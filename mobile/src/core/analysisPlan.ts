/**
 * Fatiamento da nota para a analise por bloco. Puro e testavel: nada de IO.
 *
 * O bloco e a unidade que o modelo le e a unidade de cache. No texto escrito o
 * bloco e o paragrafo; na fala, a frase entre duas pausas. Assim o resultado da
 * analise nao depende do tamanho da nota nem da janela de contexto do modelo:
 * cada chamada le um bloco pequeno e o documento e composto depois, no codigo.
 */

import { toAnalysisText } from './analysisText';
import { markdownToPlain } from './richText';
import { visibleSegmentText, visibleTranscript } from './transcriptReview';
import type { Recording, TranscriptSegment } from './types';

/** Paragrafo curto demais para uma chamada propria funde com o vizinho. */
export const MIN_BLOCK_CHARS = 120;
/** Teto de um bloco: o modelo le o paragrafo inteiro, nunca a nota inteira. */
export const MAX_BLOCK_CHARS = 900;
/** Silencio que separa duas frases faladas (a "quebra de paragrafo" da fala). */
export const TRANSCRIPT_PAUSE_MS = 800;
/** Teto de caracteres de um bloco de fala. */
export const MAX_TRANSCRIPT_BLOCK_CHARS = 700;
/** Contexto levado ao modelo: a ultima frase do bloco anterior. */
export const MAX_CONTEXT_CHARS = 200;

export type AnalysisBlockKind = 'text' | 'transcript';

export interface AnalysisBlock {
  /** Posicao no plano, de 0 em diante. */
  index: number;
  kind: AnalysisBlockKind;
  /** Titulo da secao escrita; vazio antes do primeiro titulo. */
  heading: string;
  text: string;
  /**
   * Ultima frase do bloco anterior. So serve para "ela" e "ali" terem
   * referente; nao entra na contagem do bloco.
   */
  context: string;
  chars: number;
  /** Tempo no audio original; `null` em bloco escrito. */
  startMs: number | null;
  endMs: number | null;
  /** Chave de cache: muda quando o texto ou o contexto mudam. */
  hash: string;
}

export interface AnalysisPlan {
  blocks: AnalysisBlock[];
  /** Caracteres de conteudo da nota (soma dos blocos). */
  chars: number;
  /** Duracao coberta pela transcricao, em ms. */
  audioMs: number;
}

/** Hash estavel e nao criptografico; so identifica conteudo local. */
export function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Corpo em markdown e o mesmo corpo em texto puro (fotos e links nao contam).
 * A comparacao com a transcricao usa o mesmo texto que vai ao modelo, senao uma
 * nota de audio com HTML ou emoji pareceria diferente da propria fala.
 */
function noteParts(recording: Pick<Recording, 'text'>): { markdown: string; body: string } {
  const markdown = (recording.text ?? '').trim();
  return { markdown, body: toAnalysisText(markdownToPlain(markdown)).trim() };
}

interface Section {
  heading: string;
  text: string;
}

/**
 * Quebra o markdown pelos titulos. Le o texto antes de virar prosa: o
 * `markdownToPlain` apaga o `#`, e depois dele nao ha mais como saber onde
 * comeca uma secao. `#` no meio da linha e dentro de bloco de codigo nao conta.
 */
function markdownSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let heading = '';
  let lines: string[] = [];
  let fenced = false;
  const flush = () => {
    const text = toAnalysisText(markdownToPlain(lines.join('\n'))).trim();
    if (text !== '') sections.push({ heading, text });
    heading = '';
    lines = [];
  };
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      lines.push(line);
      continue;
    }
    const match = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      flush();
      heading = toAnalysisText(markdownToPlain(match[2])).trim();
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

/** Corta no limite, preferindo o ultimo espaco para nao partir palavra. */
function clipToWord(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

/** Frases de um paragrafo: ponto, interrogacao e exclamacao. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/(?<=[.!?…])\s+/)) {
    const value = part.trim();
    if (value) out.push(value);
  }
  return out.length > 0 ? out : [text.trim()];
}

/** Divide um paragrafo acima do teto em blocos de frases inteiras. */
function splitLongParagraph(text: string): string[] {
  if (text.length <= MAX_BLOCK_CHARS) return [text];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences(text)) {
    if (current !== '' && current.length + 1 + sentence.length > MAX_BLOCK_CHARS) {
      out.push(current);
      current = sentence;
      continue;
    }
    current = current === '' ? sentence : `${current} ${sentence}`;
    if (current.length > MAX_BLOCK_CHARS) {
      // Frase unica maior que o teto (texto sem pontuacao): corta em palavra.
      out.push(clipToWord(current, MAX_BLOCK_CHARS));
      current = '';
    }
  }
  if (current !== '') out.push(current);
  return out;
}

/**
 * Paragrafos de uma secao, fundindo os muito curtos. A fusao existe para nao
 * gastar uma chamada de modelo com "Bom dia." — o conteudo continua sendo lido
 * junto com o vizinho, nunca descartado.
 */
function sectionParagraphs(section: Section): string[] {
  const paragraphs = section.text
    .split(/\n{2,}/)
    .map((part) => part.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  const out: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current !== '') {
      if (current.length < MIN_BLOCK_CHARS && current.length + 1 + paragraph.length <= MAX_BLOCK_CHARS) {
        current = `${current}\n${paragraph}`;
        continue;
      }
      out.push(current);
      current = '';
    }
    current = paragraph;
  }
  if (current !== '') out.push(current);

  return out.flatMap(splitLongParagraph).filter((text) => text.trim() !== '');
}

/** Ultima frase de um texto, para servir de contexto ao bloco seguinte. */
function lastSentence(text: string): string {
  const parts = sentences(text);
  return (parts[parts.length - 1] ?? '').trim().slice(0, MAX_CONTEXT_CHARS);
}

interface RawBlock {
  kind: AnalysisBlockKind;
  heading: string;
  text: string;
  startMs: number | null;
  endMs: number | null;
}

/** Blocos escritos: paragrafos dos titulos do markdown. */
function textBlocks(markdown: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  for (const section of markdownSections(markdown)) {
    for (const text of sectionParagraphs(section)) {
      blocks.push({ kind: 'text', heading: section.heading, text, startMs: null, endMs: null });
    }
  }
  return blocks;
}

/**
 * Blocos falados: trechos agrupados por pausa. A pausa e a quebra natural da
 * fala e ainda da o tempo exato de cada bloco, que e o que permite marcar um
 * momento no audio sem o modelo inventar milissegundos.
 */
function transcriptBlocks(segments: TranscriptSegment[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let current: { startMs: number; endMs: number; texts: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.texts.join(' ').trim();
    if (text !== '' && current.startMs >= 0) {
      blocks.push({
        kind: 'transcript',
        heading: '',
        text,
        startMs: current.startMs,
        endMs: current.endMs,
      });
    }
    current = null;
  };
  for (const segment of segments) {
    const text = toAnalysisText(visibleSegmentText(segment)).trim();
    if (text === '') continue;
    const start = Math.max(0, segment.start_ms ?? 0);
    const end = Math.max(start, segment.end_ms ?? start);
    if (current) {
      const gap = start - current.endMs;
      const size = current.texts.join(' ').length + 1 + text.length;
      if (gap >= 0 && gap < TRANSCRIPT_PAUSE_MS && size <= MAX_TRANSCRIPT_BLOCK_CHARS) {
        current.texts.push(text);
        current.endMs = end;
        continue;
      }
      flush();
    }
    current = { startMs: start, endMs: end, texts: [text] };
  }
  flush();
  return blocks;
}

/** Transcricao sem segmentos: quebra em paragrafos como o texto escrito. */
function transcriptTextBlocks(transcript: string): RawBlock[] {
  const paragraphs = toAnalysisText(transcript)
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return paragraphs
    .flatMap(splitLongParagraph)
    .filter((text) => text !== '')
    .map((text) => ({ kind: 'transcript' as const, heading: '', text, startMs: null, endMs: null }));
}

/**
 * Plano de leitura da nota. Corpo e transcricao viajam juntos quando a fala
 * difere do texto escrito; quando o corpo e a propria transcricao (nota de
 * audio sem anotacao), a fala aparece uma vez so.
 */
export function planAnalysis(
  recording: Pick<Recording, 'text' | 'transcript' | 'transcriptSegments'>,
): AnalysisPlan {
  const { markdown, body } = noteParts(recording);
  const segments = recording.transcriptSegments ?? [];
  // A fala pode existir so nos segmentos (transcricao em andamento ou revisao
  // gravada trecho a trecho). Sem juntar aqui, esses audios ficariam de fora.
  const transcriptText = toAnalysisText(
    (recording.transcript ?? '').trim() || visibleTranscript(segments).trim(),
  );
  const normalizedBody = body.replace(/\s+/g, ' ').trim();
  const normalizedTranscript = transcriptText.replace(/\s+/g, ' ').trim();
  const transcriptDiffers = transcriptText !== '' && normalizedTranscript !== normalizedBody;

  const raw: RawBlock[] = textBlocks(markdown);
  if (transcriptDiffers) {
    raw.push(
      ...(segments.length > 0
        ? transcriptBlocks(segments)
        : transcriptTextBlocks(transcriptText)),
    );
  }

  const blocks: AnalysisBlock[] = [];
  let context = '';
  for (const block of raw) {
    const text = block.text.trim();
    if (text === '') continue;
    const hash = stableHash(`${block.kind}\u0000${text}\u0000${context}`);
    blocks.push({
      index: blocks.length,
      kind: block.kind,
      heading: block.heading,
      text,
      context,
      chars: text.length,
      startMs: block.startMs,
      endMs: block.endMs,
      hash,
    });
    context = lastSentence(text);
  }

  const audioMs = blocks.reduce(
    (total, block) =>
      block.startMs !== null && block.endMs !== null ? total + (block.endMs - block.startMs) : total,
    0,
  );

  return {
    blocks,
    chars: blocks.reduce((total, block) => total + block.chars, 0),
    audioMs,
  };
}
