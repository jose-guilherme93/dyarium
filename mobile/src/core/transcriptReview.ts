/**
 * Revisao da transcricao por IA, pura e testavel.
 *
 * O whisper escuta o audio; a revisao so limpa a lingua. Este modulo monta o
 * prompt, fatia os trechos (2 a 3 por vez no aparelho), valida a resposta com as
 * mesmas travas do servidor e conta hesitacao/gagueira no texto cru. Nada aqui
 * toca em audio, em rede ou no banco.
 */

import { parseJsonLoose } from './analysisPrompt';
import type {
  Recording,
  TranscriptOrigin,
  TranscriptReview,
  TranscriptSegment,
} from './types';

/** Versao do prompt e das regras. Entra na chave de cache da revisao. */
export const REVIEW_PROMPT_VERSION = 1;

/** Trechos por chamada no aparelho. Modelos locais pequenos pedem janela curta. */
export const DEVICE_WINDOW = 3;

/**
 * Janela de revisao para o modelo escolhido. Os dois modelos mais leves do
 * catalogo erram menos com 2 trechos por chamada; dos equilibrados para cima, 3.
 */
export function reviewWindow(rank: number): number {
  return rank <= 2 ? 2 : DEVICE_WINDOW;
}

export interface ReviewChunk {
  /** Indices absolutos dos trechos enviados, na ordem. */
  indices: number[];
  /** Ultimo trecho da janela anterior, para a sigla nao se repetir. */
  context: string;
}

/** Texto que o leitor mostra: o revisado quando existe, o cru quando nao. */
export function visibleSegmentText(segment: TranscriptSegment): string {
  return segment.revised && segment.revised.trim() ? segment.revised : segment.text;
}

/** Texto visivel da transcricao inteira, na ordem dos trechos. */
export function visibleTranscript(segments: TranscriptSegment[] | undefined): string {
  if (!segments || segments.length === 0) return '';
  return segments.map(visibleSegmentText).join('\n');
}

/** Texto cru do whisper, o que vai para o servidor como original. */
export function rawTranscript(
  segments: TranscriptSegment[] | undefined,
  fallback: string | undefined,
): string {
  if (!segments || segments.length === 0) return (fallback ?? '').trim();
  return segments.map((segment) => segment.text).join('\n');
}

/**
 * Fatia os trechos em janelas, pulando os escritos a mao. A revisao nunca toca
 * neles e eles nao contam para o tamanho da janela.
 */
export function reviewChunks(
  segments: TranscriptSegment[],
  size = DEVICE_WINDOW,
  from = 0,
  only?: number[],
): ReviewChunk[] {
  const chunks: ReviewChunk[] = [];
  let current: ReviewChunk | null = null;
  const limit = Math.max(1, size);
  const walk = only
    ? [...new Set(only)].filter((index) => index >= 0 && index < segments.length).sort((a, b) => a - b)
    : null;
  // Sem `only`, a passada comeca em `from`: o total e so o que falta, nunca a
  // transcricao inteira. Contar o total cheio aqui estourava o indice ao
  // retomar uma revisao interrompida.
  const start = Math.max(0, from);
  const total = walk ? walk.length : Math.max(0, segments.length - start);
  for (let position = 0; position < total; position += 1) {
    const index = walk ? walk[position] : start + position;
    const segment = segments[index];
    if (!segment || segment.edited) continue;
    if (!current) {
      current = {
        indices: [],
        context: index > 0 ? visibleSegmentText(segments[index - 1]) : '',
      };
    }
    current.indices.push(index);
    if (current.indices.length >= limit) {
      chunks.push(current);
      current = null;
    }
  }
  if (current && current.indices.length > 0) chunks.push(current);
  return chunks;
}

export interface ReviewMessages {
  role: 'system' | 'user';
  content: string;
}

/** Schema pedido ao modelo local: um texto por trecho e a nota de compreensao. */
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['comprehension', 'segments'],
  properties: {
    comprehension: { type: 'integer' },
    segments: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function reviewSystemPrompt(literal: boolean): string {
  const fillers = literal
    ? 'Mantenha hesitacoes ("ee", "hum", "aa") e repeticoes de gagueira ("eu eu falei"): elas fazem parte do que foi dito.'
    : 'Remova apenas hesitacao sem significado ("ee", "hum", "aa") e repeticao de gagueira ("eu eu falei"), preservando todo marcador de fala com sentido: "tipo", "ne", "mermao", "cara", "ai".';
  return `Voce revisa a transcricao automatica de um diario pessoal falado.
O whisper escuta o audio; seu trabalho e somente limpar a lingua, sem reescrever o conteudo.
Corrija ortografia, concordancia nominal e verbal, regencia, pontuacao, reticencias e maiusculas.
${fillers}
Preserve o jeito de falar: girias, marcadores de fala e o ritmo das frases continuam.
Explique uma sigla ambigua entre parenteses, no maximo uma por trecho e com ate 6 palavras,
somente quando o titulo ou o contexto deixarem claro o significado: "pt" vira "PT (Partido dos Trabalhadores)".
Nunca invente fatos, nomes, numeros ou datas, e nunca apague numeros do texto.
Nao junte nem divida trechos: devolva exatamente o mesmo numero de textos, na mesma ordem, um por trecho recebido.
Se um trecho ja estiver correto, devolva-o sem mudanca.
Responda SOMENTE com um JSON valido no formato
{"comprehension": <0 a 100>, "segments": ["<trecho revisado>", "..."]}.
"comprehension" e uma estimativa textual de 0 a 100 de quanto o texto cru representa a fala com logica,
sintaxe e concordancia: 100 para um texto perfeito, 0 para um texto incompreensivel. Voce nao ouve o audio.`;
}

export function buildReviewMessages(input: {
  literal: boolean;
  title?: string;
  context?: string;
  texts: string[];
}): ReviewMessages[] {
  const payload: Record<string, unknown> = { trechos: input.texts };
  if (input.title?.trim()) payload.titulo = input.title.trim();
  if (input.context?.trim()) payload.contexto = input.context.trim();
  return [
    { role: 'system', content: reviewSystemPrompt(input.literal) },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

export interface ParsedReview {
  comprehension: number;
  texts: string[];
}

/** Le a resposta do modelo. Devolve null quando nem o array de trechos existe. */
export function parseReviewJson(raw: string, expected: number): ParsedReview | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const end = cleaned.lastIndexOf('}');
  const candidates = [cleaned.slice(start)];
  if (end > start) candidates.push(cleaned.slice(start, end + 1));
  let value: unknown = null;
  for (const candidate of candidates) {
    value = parseJsonLoose(candidate);
    if (value !== null) break;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.segments)) return null;
  const texts = root.segments.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (texts.length !== expected || texts.some((text) => text === '')) return null;
  // -1 e o "nao medido" que o prompt permite: nao pode virar 0, senao uma
  // janela sem nota puxa a media da transcricao inteira para baixo.
  const rawComprehension =
    typeof root.comprehension === 'number' && Number.isFinite(root.comprehension)
      ? Math.round(root.comprehension)
      : -1;
  const comprehension =
    rawComprehension < 0 ? -1 : Math.min(100, rawComprehension);
  return { comprehension, texts };
}

const MAX_GLOSS_WORDS = 6;

/**
 * As mesmas travas do servidor (internal/review): recusa reescrita que muda
 * numeros, encolhe/cresce demais ou explica mais de uma coisa. Um trecho
 * recusado simplesmente continua como o whisper escreveu.
 */
export function acceptRevision(original: string, revised: string): boolean {
  const before = original.trim();
  const after = revised.trim();
  if (after === '') return false;
  if (before === '') return true;

  const gloss = addedGloss(before, after);
  if (gloss === null) return false;
  const beforeLength = [...before].length;
  const afterLength = [...after].length;
  if (afterLength < (beforeLength * 7) / 10) return false;
  if (afterLength > (beforeLength * 14) / 10 + gloss) return false;
  if (!sameNumbers(before, after)) return false;
  return similarEnough(before, after);
}

/** Runas acrescentadas por uma glosa; null quando ha mais de uma ou e longa. */
function addedGloss(original: string, revised: string): number | null {
  const added = count(revised, '(') - count(original, '(');
  if (added <= 0) return added < 0 ? null : 0;
  if (added > 1) return null;
  const start = revised.indexOf('(');
  const end = revised.indexOf(')', start);
  if (start < 0 || end < 0) return null;
  const gloss = revised.slice(start + 1, end);
  if (gloss.trim().split(/\s+/).filter(Boolean).length > MAX_GLOSS_WORDS) return null;
  return [...gloss].length + 2;
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

function numbers(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const match of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    out.set(match, (out.get(match) ?? 0) + 1);
  }
  return out;
}

function sameNumbers(original: string, revised: string): boolean {
  const before = numbers(original);
  const after = numbers(revised);
  if (before.size !== after.size) return false;
  for (const [value, countBefore] of before) {
    if (after.get(value) !== countBefore) return false;
  }
  return true;
}

function wordSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.split(/\s+/)) {
    const folded = fold(token);
    if (folded) out.add(folded);
  }
  return out;
}

function similarEnough(original: string, revised: string): boolean {
  const before = wordSet(original);
  const after = wordSet(revised);
  if (before.size < 4 || after.size < 4) return true;
  let common = 0;
  for (const word of before) {
    if (after.has(word)) common += 1;
  }
  const union = before.size + after.size - common;
  return union > 0 && common / union >= 0.45;
}

/** Minusculas e sem acento, so para comparar palavras. */
function fold(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface SpeechCounts {
  words: number;
  stutter: number;
  hesitation: number;
}

const HESITATIONS = new Set([
  'ah', 'ahh', 'ahn', 'eh', 'ehh', 'ehm', 'hm', 'hmm', 'hum', 'humm',
  'ih', 'mhm', 'mm', 'mmm', 'uh', 'uhm', 'uhum',
]);

const EMPHATIC_REPEATS = new Set(['nao', 'sim']);

/**
 * Conta gagueira e hesitacao no texto cru. Series separadas porque, para quem
 * e gago, a repeticao e a serie que importa e o "ee" e ruido de fala.
 */
export function speechCounts(text: string): SpeechCounts {
  const counts: SpeechCounts = { words: 0, stutter: 0, hesitation: 0 };
  let previous = '';
  for (const token of text.split(/\s+/)) {
    const folded = fold(token);
    if (!folded) continue;
    counts.words += 1;
    if (isHesitation(folded)) {
      counts.hesitation += 1;
      previous = '';
      continue;
    }
    if (folded === previous && !EMPHATIC_REPEATS.has(folded)) counts.stutter += 1;
    previous = folded;
  }
  return counts;
}

function isHesitation(folded: string): boolean {
  if (HESITATIONS.has(folded)) return true;
  if ([...folded].length < 2) return false;
  const chars = [...folded];
  if (!chars.every((char) => 'aeiouhmn'.includes(char))) return false;
  return chars.every((char) => char === chars[0]);
}

/** Taxa por 100 palavras (0 quando nao ha palavra). */
export function perHundred(value: number, words: number): number {
  if (words <= 0) return 0;
  return (value * 100) / words;
}

/** Identificador do texto cru; muda quando um trecho e reescrito ou editado. */
export function reviewHash(segments: TranscriptSegment[]): string {
  const source = segments
    .map((segment) => `${segment.edited ? '1' : '0'}:${segment.text}`)
    .join('\u0000');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/**
 * A revisao guardada ainda vale para este prompt, modo e texto? O modelo nao
 * entra na comparacao de proposito: uma revisao boa vinda do servidor poupa a
 * bateria do aparelho, mesmo que o modelo local escolhido seja outro.
 */
export function reviewIsCurrent(
  review: TranscriptReview | undefined,
  literal: boolean,
  segments: TranscriptSegment[],
): boolean {
  return Boolean(
    review &&
      review.promptVersion === REVIEW_PROMPT_VERSION &&
      review.literal === literal &&
      // Uma passada interrompida no meio nao vale: os trechos que faltaram
      // continuam com o texto do whisper.
      reviewFinished(review) &&
      review.hash === reviewHash(segments),
  );
}

/** O que o servidor manda sobre uma revisao ja feita (GET /transcript). */
export interface ServerReview {
  revised?: boolean;
  revised_model?: string;
  revised_prompt_version?: number;
  revised_literal?: boolean;
  revised_comprehension?: number;
  revised_rejected?: number;
  revised_pending?: number;
  revised_through?: number;
  revised_finished?: boolean;
}

/**
 * Reconstroi o estado local da revisao a partir do que veio do servidor.
 *
 * O servidor guarda o estado da passada (`revised_through`/`revised_finished`),
 * mas o app precisa da mesma forma que a revisao local usa para o chip e para
 * nao refazer o trabalho. Sem `finishedAt` o estado parecia "revisando para
 * sempre"; e um trecho recusado nao pode ser confundido com um trecho que a
 * passada ainda nao alcancou.
 */
export function reviewFromServer(
  transcript: ServerReview,
  segments: TranscriptSegment[],
): TranscriptReview | undefined {
  if (!transcript.revised_prompt_version || transcript.revised_prompt_version <= 0) {
    return undefined;
  }
  const pending = transcript.revised_pending ?? 0;
  const through =
    typeof transcript.revised_through === 'number'
      ? transcript.revised_through
      : Math.max(0, segments.length - pending);
  const finished =
    typeof transcript.revised_finished === 'boolean'
      ? transcript.revised_finished
      : pending === 0;
  const hasReviewedFlag = segments.some((segment) => typeof segment.reviewed === 'boolean');
  const rejectedIdx = hasReviewedFlag
    ? segments
        .map((segment, index) => ({ segment, index }))
        .filter(
          ({ segment, index }) =>
            !segment.edited && segment.reviewed === false && index < through,
        )
        .map(({ index }) => index)
    : [];
  return {
    model: transcript.revised_model ?? '',
    promptVersion: transcript.revised_prompt_version,
    literal: transcript.revised_literal === true,
    comprehension: transcript.revised_comprehension ?? -1,
    hash: reviewHash(segments),
    rejected: transcript.revised_rejected ?? 0,
    rejectedIdx,
    reviewedThrough: Math.max(0, through),
    // A presenca do campo e o que marca a passada como terminada; a data em si
    // nao e exibida.
    finishedAt: finished ? new Date().toISOString() : undefined,
  };
}

/** Corpo de `GET /entries/{id}/transcript`, no que toca a revisao. */
export interface ServerTranscriptPayload extends ServerReview {
  text?: string;
  language?: string;
  segments?: TranscriptSegment[];
}

/** A passada do servidor e a mesma que o aparelho ja tem? */
function sameReviewState(a: TranscriptReview, b: TranscriptReview): boolean {
  return (
    a.model === b.model &&
    a.promptVersion === b.promptVersion &&
    a.literal === b.literal &&
    a.comprehension === b.comprehension &&
    a.rejected === b.rejected &&
    a.hash === b.hash &&
    a.reviewedThrough === b.reviewedThrough &&
    Boolean(a.finishedAt) === Boolean(b.finishedAt)
  );
}

/**
 * Aplica sobre a copia local uma transcricao vinda do servidor.
 *
 * O primeiro pull de uma nota so acontece enquanto ela nao tem texto; depois
 * disso o servidor pode revisar de novo (outro aparelho, o dashboard). Sem esta
 * fusao a nota aberta no app analisava o texto antigo, e o chip mentia sobre o
 * estado da passada. Devolve `null` quando a copia local deve vencer: edicao
 * manual pendente, nenhuma revisao nova no servidor, ou a mesma passada.
 */
export function mergeServerTranscript(
  recording: Recording,
  transcript: ServerTranscriptPayload,
): Recording | null {
  const segments = transcript.segments ?? [];
  if (segments.length === 0) return null;
  // O que o usuario escreveu a mao ainda vai subir: o servidor nao o conhece.
  if ((recording.transcriptSegments ?? []).some((segment) => segment.edited)) return null;
  const review = reviewFromServer(transcript, segments);
  const localSegments = recording.transcriptSegments ?? [];
  const sameText =
    localSegments.length === segments.length &&
    localSegments.every((segment, index) => segment.text === segments[index].text);
  if (!review) {
    // Sem revisao no servidor e o mesmo texto: a revisao local continua
    // valendo e vai subir pela fila de sync. Com texto diferente houve
    // retranscricao no servidor; a revisao local descrevia o texto antigo e
    // cai junto com ele.
    if (sameText) return null;
    return {
      ...recording,
      transcript: transcript.text ?? visibleTranscript(segments),
      transcriptLanguage: transcript.language ?? recording.transcriptLanguage,
      transcriptOrigin: 'server',
      transcriptStatus: 'ready',
      hasTranscript: true,
      transcriptSegments: segments,
      transcriptReview: undefined,
      updatedAt: new Date().toISOString(),
    };
  }
  if (recording.transcriptReview && sameReviewState(recording.transcriptReview, review)) {
    return null;
  }
  return {
    ...recording,
    transcript: transcript.text ?? visibleTranscript(segments),
    transcriptLanguage: transcript.language ?? recording.transcriptLanguage,
    transcriptOrigin: 'server',
    transcriptStatus: 'ready',
    hasTranscript: true,
    transcriptSegments: segments,
    transcriptReview: review,
    updatedAt: new Date().toISOString(),
  };
}

export interface AppliedRevision {
  segments: TranscriptSegment[];
  /** Trechos que a trava recusou: continuam com o texto do whisper. */
  refused: number;
  /** Quais foram, para o "revisar de novo" poder mirar so neles. */
  refusedIdx: number[];
}

/** Onde uma passada interrompida parou, se ainda vale para este texto e modo. */
export function reviewResumeFrom(
  review: TranscriptReview | undefined,
  literal: boolean,
  segments: TranscriptSegment[],
): { from: number; rejected: number; rejectedIdx: number[] } | null {
  if (!review || review.finishedAt) return null;
  if (review.promptVersion !== REVIEW_PROMPT_VERSION || review.literal !== literal) return null;
  if (review.hash !== reviewHash(segments)) return null;
  const from = review.reviewedThrough ?? 0;
  if (from <= 0) return null;
  return { from, rejected: review.rejected ?? 0, rejectedIdx: review.rejectedIdx ?? [] };
}

/** Aplica os textos aceitos de uma janela; devolve os segmentos e as recusas. */
export function withRevisedTexts(
  segments: TranscriptSegment[],
  indices: number[],
  texts: string[],
): AppliedRevision {
  const next = segments.slice();
  let refused = 0;
  const refusedIdx: number[] = [];
  for (let position = 0; position < indices.length; position += 1) {
    const index = indices[position];
    const segment = next[index];
    const revised = texts[position]?.trim();
    if (!segment || !revised || segment.edited) {
      refused += 1;
      refusedIdx.push(index);
      continue;
    }
    if (!acceptRevision(segment.text, revised)) {
      refused += 1;
      refusedIdx.push(index);
      continue;
    }
    next[index] = {
      ...segment,
      revised: revised === segment.text.trim() ? undefined : revised,
    };
  }
  return { segments: next, refused, refusedIdx };
}

/**
 * Estado da revisao para a tela. Separar os cinco casos e o ponto: "revisou e
 * nao mudou nada", "nao revisou" e "revisou com recusas" pareciam a mesma coisa.
 */
export type ReviewState =
  | { kind: 'none' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'paused'; done: number; total: number }
  | { kind: 'changed'; changed: number; comprehension: number }
  | { kind: 'empty'; comprehension: number }
  | { kind: 'partial'; changed: number; rejected: number; comprehension: number };

/**
 * Estado da revisao para o chip. `running` diz se uma passada esta rodando
 * agora; sem ele uma passada interrompida (app morto, cancelada no servidor)
 * aparecia girando para sempre, como se estivesse trabalhando.
 */
export function reviewState(
  review: TranscriptReview | undefined,
  segments: TranscriptSegment[],
  running = false,
): ReviewState {
  if (!review || !review.model) return { kind: 'none' };
  if (!reviewFinished(review)) {
    const done = review.reviewedThrough ?? 0;
    return running
      ? { kind: 'running', done, total: segments.length }
      : { kind: 'paused', done, total: segments.length };
  }
  const changed = changedSegments(segments);
  const comprehension = review.comprehension ?? -1;
  const rejected = review.rejected ?? 0;
  if (rejected > 0) return { kind: 'partial', changed, rejected, comprehension };
  if (changed > 0) return { kind: 'changed', changed, comprehension };
  return { kind: 'empty', comprehension };
}

/**
 * A passada terminou? `finishedAt` e o marcador atual. Revisoes importadas por
 * uma versao anterior do app nao tinham esse campo nem `reviewedThrough`; para
 * elas a presenca do modelo e do hash ja significa uma passada concluida (uma
 * passada interrompida sempre grava o ponto de retomada). Sem esta leitura, o
 * chip ficava girando para sempre e o app refazia a revisao inteira.
 */
function reviewFinished(review: TranscriptReview): boolean {
  if (review.finishedAt) return true;
  return review.reviewedThrough === undefined && review.rejectedIdx === undefined;
}

/**
 * Uma passada local ficou pela metade e deve ser retomada no boot? So vale para
 * revisao feita no aparelho: a do servidor continua no servidor, e uma revisao
 * importada por versao antiga (sem `reviewedThrough`) ja conta como terminada.
 */
export function reviewNeedsResume(
  review: TranscriptReview | undefined,
  origin: TranscriptOrigin | undefined,
): boolean {
  return Boolean(
    review &&
      review.model &&
      !review.finishedAt &&
      review.reviewedThrough !== undefined &&
      origin !== 'server',
  );
}

/** Quantos trechos tem texto revisado diferente do original. */
export function changedSegments(segments: TranscriptSegment[]): number {
  return segments.filter((segment) => segment.revised && segment.revised !== segment.text).length;
}
