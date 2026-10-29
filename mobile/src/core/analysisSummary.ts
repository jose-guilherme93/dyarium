/**
 * A unica frase gerada sobre a nota. Uma chamada por nota, com entrada de
 * tamanho fixo: o que o modelo le aqui e o que a leitura por bloco ja extraiu
 * (pessoas, tom, momentos, decisoes), nunca a nota inteira.
 *
 * Assim a frase nao depende do tamanho da nota nem da janela do modelo; se o
 * modelo nao escrever algo utilizavel, o codigo escreve uma frase derivada dos
 * campos e a ficha marca que ela nao veio do modelo.
 */

import {
  MAX_READING_CHARS,
  foldText,
  parseJsonObject,
  readingRepeatsInput,
  asText,
} from './analysisPrompt';
import type { ComposedAnalysis } from './analysisCompose';
import type { AnalysisBlock } from './analysisPlan';
import { toAnalysisText } from './analysisText';

export const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frase'],
  properties: { frase: { type: 'string' } },
} as const;

/** Tamanho maximo do trecho de destaque levado ao modelo. */
const FOCUS_CHARS = 400;
const TAIL_CHARS = 200;
const MAX_SUMMARY_WORDS = 26;

export interface SummaryDigest {
  titulo: string;
  autor: string;
  tom: string;
  pessoas: { nome: string; mencoes: number }[];
  lugares: string[];
  temas: string[];
  eventos: string[];
  decisoes: string[];
  tarefas: string[];
  epifanias: string[];
  momentos: { texto: string; tempo: string }[];
  /** Bloco mais saliente: a cena que ancora a frase. */
  trecho: string;
  /** Fim da nota: diario costuma concluir ali. */
  final: string;
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function clip(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/**
 * Foco da frase: o bloco que mais entrega assunto. Usa a mesma saliencia dos
 * momentos, com o tom absoluto como desempate.
 */
export function focusBlock(
  doc: ComposedAnalysis,
  blocks: AnalysisBlock[],
): AnalysisBlock | null {
  if (blocks.length === 0) return null;
  const byIndex = new Map(blocks.map((block) => [block.index, block]));
  const ranked = [...doc.moments].sort((a, b) => b.salience - a.salience);
  for (const moment of ranked) {
    const block = byIndex.get(moment.blockIndex);
    if (block) return block;
  }
  const read = new Set(doc.moments.map((moment) => moment.blockIndex));
  const fallback = blocks.filter((block) => !read.has(block.index));
  return fallback[0] ?? blocks[0] ?? null;
}

export function summaryDigest(
  doc: ComposedAnalysis,
  blocks: AnalysisBlock[],
  input: { title: string; author: string },
): SummaryDigest {
  const focus = focusBlock(doc, blocks);
  const last = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  return {
    titulo: clip(toAnalysisText(input.title).replace(/\n+/g, ' '), 120),
    autor: input.author,
    tom: doc.toneLabel,
    pessoas: doc.people.slice(0, 5).map((person) => ({
      nome: person.name,
      mencoes: person.mentions,
    })),
    lugares: doc.places.slice(0, 3).map((place) => place.name),
    temas: doc.themes.slice(0, 3).map((theme) => theme.name),
    eventos: doc.events.slice(0, 3).map((event) => event.name),
    decisoes: doc.decisions.slice(0, 2).map((item) => item.text),
    tarefas: doc.tasks.slice(0, 2).map((item) => item.text),
    epifanias: doc.epiphanies.slice(0, 2).map((item) => item.text),
    momentos: doc.moments.slice(0, 3).map((moment) => ({
      texto: moment.text,
      tempo: moment.startMs !== null ? mmss(moment.startMs) : '',
    })),
    trecho: clip(focus?.text ?? '', FOCUS_CHARS),
    final: last && last.index !== focus?.index ? clip(last.text, TAIL_CHARS) : '',
  };
}

const SUMMARY_PROMPT = `Voce escreve UMA frase sobre uma nota de diario pessoal em portugues do Brasil.
Recebe o que ja foi extraido da nota (tom, pessoas, lugares, temas, eventos, decisoes, tarefas, epifanias e momentos), o trecho mais marcante e o fim da nota.
Escreva uma interpretacao curta, em terceira pessoa, dizendo o que a nota revela: o assunto, o tom e o momento. No maximo 24 palavras, uma linha.
Quando houver uma pessoa dominante, diga sobre quem e a nota, usando o nome que estiver nos dados.
Nao copie nem repita frases do trecho ou dos momentos; interprete.
Nao use rotulo generico ("tom negativo", "texto pessoal") como frase inteira.
Nao invente fato, pessoa, lugar ou decisao que nao esteja nos dados.
Responda SOMENTE com um objeto JSON valido: {"frase":"..."}`;

export interface SummaryMessage {
  role: 'system' | 'user';
  content: string;
}

export function buildSummaryMessages(input: { digest: SummaryDigest }): SummaryMessage[] {
  return [
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: JSON.stringify(input.digest) },
  ];
}

export function parseSummaryJson(raw: string): string | null {
  const root = parseJsonObject(raw);
  const sentence = asText(root?.frase).replace(/\s+/g, ' ');
  return sentence === '' ? null : sentence;
}

/**
 * Nome proprio que nao esta nos dados. Um modelo pequeno costuma reaproveitar
 * nomes de exemplo; a frase que cita quem nao existe e trocada pela derivada.
 */
function hasInventedName(sentence: string, digest: SummaryDigest): boolean {
  const allowed = new Set<string>();
  const add = (value: string) => {
    for (const token of foldText(value).split(' ')) {
      if (token !== '') allowed.add(token);
    }
  };
  for (const person of digest.pessoas) add(person.nome);
  for (const place of digest.lugares) add(place);
  for (const event of digest.eventos) add(event);
  for (const theme of digest.temas) add(theme);
  add(digest.autor);

  const words = sentence.trim().split(/\s+/);
  let atStart = true;
  for (const raw of words) {
    const word = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    const endsSentence = /[.!?…]$/.test(raw);
    const capitalized = word !== '' && /^\p{Lu}/u.test(word);
    if (capitalized && !atStart) {
      const token = foldText(word);
      if (token.length >= 3 && !allowed.has(token)) return true;
    }
    atStart = endsSentence;
  }
  return false;
}

/** Frase aceitavel: tamanho de uma frase, sem copiar o material de origem. */
export function acceptSummary(
  sentence: string,
  source: string,
  digest?: SummaryDigest,
): boolean {
  const text = sentence.trim();
  if (text.length < 12 || text.length > MAX_READING_CHARS) return false;
  const words = foldText(text).split(' ').filter(Boolean);
  if (words.length < 3 || words.length > MAX_SUMMARY_WORDS) return false;
  if (readingRepeatsInput(text, source)) return false;
  if (digest && hasInventedName(text, digest)) return false;
  return true;
}

/**
 * Frase derivada, quando o modelo nao escreveu uma aceitavel: sai dos campos
 * que o codigo ja calculou, sem inventar nada.
 */
/**
 * Frase de reserva quando o modelo nao escreveu uma aceitavel. Usa o que a
 * composicao ja extraiu: tom, pessoa dominante, acontecimento, epifania ou
 * temas. Nada e inventado; a ficha marca `sentence_source: "derived"`.
 */
export function derivedSentence(doc: ComposedAnalysis): string {
  const parts: string[] = [`Uma nota de tom ${doc.toneLabel}`];
  const person = doc.people[0]?.name;
  if (person) parts.push(`sobre ${person}`);
  const event = doc.events[0]?.name;
  const epiphany = doc.epiphanies[0]?.text;
  const themes = doc.themes.slice(0, 2).map((theme) => theme.name);
  if (event) parts.push(`marcada por ${clip(event, 60)}`);
  else if (epiphany) parts.push(`em que ${clip(epiphany.charAt(0).toLowerCase() + epiphany.slice(1), 60)}`);
  else if (themes.length > 0) parts.push(`com ${themes.join(' e ')}`);
  return clip(`${parts.join(', ')}.`, MAX_READING_CHARS);
}
