/**
 * Composicao do documento da nota a partir dos blocos lidos. Puro e testavel.
 *
 * Nada aqui chama modelo: contagem, media, deduplicacao, canonizacao de nome e
 * cobertura sao calculadas. E o que garante que a analise signifique a mesma
 * coisa com qualquer modelo; o que varia e quantos blocos foram lidos.
 */

import type { AnalysisBlock } from './analysisPlan';
import type { AnalysisEmotion, AnalysisTheme, ChunkExtraction } from './analysisChunk';
import { contentWordList } from './analysisChunk';
import { foldText } from './analysisPrompt';

export interface ComposedPerson {
  name: string;
  /** Ocorrencias literais do nome no texto lido. */
  mentions: number;
  /** Blocos em que a pessoa aparece. */
  blocks: number;
  /** Tom medio dos blocos em que aparece (-100..100). */
  tone: number;
  firstMs: number | null;
  lastMs: number | null;
}

export interface ComposedPlace {
  name: string;
  mentions: number;
  blocks: number;
  firstMs: number | null;
  lastMs: number | null;
}

export interface ComposedEmotion {
  name: AnalysisEmotion;
  /** Blocos em que a emocao aparece. */
  blocks: number;
  /** Fracao dos blocos lidos (0..1). */
  share: number;
  /** Tom medio dos blocos com a emocao. */
  tone: number;
}

export interface ComposedTheme {
  name: AnalysisTheme;
  blocks: number;
}

export interface ComposedEvent {
  name: string;
  blocks: number;
  startMs: number | null;
}

export interface ComposedItem {
  text: string;
  /** Blocos em que o item aparece (repeticoes viram contagem). */
  blocks: number;
  startMs: number | null;
}

export interface ComposedMoment {
  text: string;
  startMs: number | null;
  blockIndex: number;
  /** Quanto o bloco se destaca; usado so para escolher os momentos. */
  salience: number;
}

export type ToneLabel = 'positivo' | 'neutro' | 'negativo';

export interface ComposedAnalysis {
  contractVersion: number;
  /** Modelo que leu a maioria dos blocos. */
  model: string;
  /** Modelos que contribuiram (troca de modelo no meio do caminho). */
  models: string[];
  tone: number;
  toneLabel: ToneLabel;
  /** A unica frase da nota; preenchida pelo passo de resumo. */
  sentence: string;
  sentenceSource: 'model' | 'derived';
  people: ComposedPerson[];
  places: ComposedPlace[];
  emotions: ComposedEmotion[];
  themes: ComposedTheme[];
  events: ComposedEvent[];
  decisions: ComposedItem[];
  tasks: ComposedItem[];
  ideas: ComposedItem[];
  /** Percepcoes que mudam o entendimento do autor. */
  epiphanies: ComposedItem[];
  moments: ComposedMoment[];
  blocksRead: number;
  blocksTotal: number;
  charsRead: number;
  charsTotal: number;
  audioCoveredMs: number;
  audioTotalMs: number;
  /** Todos os blocos foram lidos? */
  complete: boolean;
}

export interface AnalysisChunkFact {
  block: AnalysisBlock;
  extraction: ChunkExtraction;
}

export interface ComposeInput {
  blocks: AnalysisBlock[];
  /** Somente os blocos lidos; os demais contam na cobertura. */
  facts: AnalysisChunkFact[];
  model: string;
  models?: string[];
  /** Grafias ja conhecidas no aparelho, para nao duplicar pessoa. */
  known?: { people?: string[]; places?: string[] };
}

const MAX_PEOPLE = 8;
const MAX_PLACES = 8;
const MAX_THEMES = 8;
const MAX_EVENTS = 8;
const MAX_ITEMS = 12;
const MAX_MOMENTS = 8;

export function toneLabelFor(tone: number): ToneLabel {
  if (tone >= 15) return 'positivo';
  if (tone <= -15) return 'negativo';
  return 'neutro';
}

const HONORIFICS = new Set([
  'dona', 'don', 'seu', 'sr', 'sra', 'senhor', 'senhora', 'tio', 'tia', 'vo', 'vovo',
  'vovó', 'vovô', 'primo', 'prima', 'amigo', 'amiga',
]);

/** Chave de comparacao de um nome: sem acento, caixa nem honorifico. */
function nameKey(name: string): string {
  const words = foldText(name).split(' ').filter(Boolean);
  while (words.length > 1 && HONORIFICS.has(words[0])) words.shift();
  return words.join(' ');
}

/** Grafia canonica: a que o aparelho ja usa, quando existir. */
function canonicalName(name: string, known: Map<string, string>): string {
  const key = nameKey(name);
  const existing = known.get(key);
  if (existing) return existing;
  known.set(key, name);
  return name;
}

/**
 * Quantas vezes o nome aparece no texto, como nome inteiro. Comparar pedaco de
 * palavra fazia "Ana" casar com "semana" e inflar a contagem de uma pessoa que
 * nao existe.
 */
function occurrences(text: string, name: string): number {
  const haystack = foldText(text).split(' ').filter(Boolean);
  const needle = foldText(name).split(' ').filter(Boolean);
  if (needle.length === 0 || needle.length > haystack.length) return 0;
  let count = 0;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let same = true;
    for (let offset = 0; same && offset < needle.length; offset += 1) {
      same = haystack[start + offset] === needle[offset];
    }
    if (same) {
      count += 1;
      start += needle.length - 1;
    }
  }
  return count;
}

function tokenSet(text: string): Set<string> {
  return new Set(contentWordList(text));
}

/** Duas frases falam do mesmo item? Sobreposicao de palavras de conteudo. */
function sameItem(a: string, b: string): boolean {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return foldText(a) === foldText(b);
  let common = 0;
  for (const word of left) if (right.has(word)) common += 1;
  const union = left.size + right.size - common;
  return union > 0 && common / union >= 0.6;
}

function pushUnique(list: ComposedItem[], text: string, block: AnalysisBlock): void {
  const existing = list.find((item) => sameItem(item.text, text));
  if (existing) {
    existing.blocks += 1;
    if (existing.startMs === null && block.startMs !== null) existing.startMs = block.startMs;
    return;
  }
  list.push({ text, blocks: 1, startMs: block.startMs });
}

function weightedTone(facts: AnalysisChunkFact[]): number {
  const chars = facts.reduce((total, fact) => total + Math.max(1, fact.block.chars), 0);
  if (chars === 0) return 0;
  const sum = facts.reduce(
    (total, fact) => total + fact.extraction.tone * Math.max(1, fact.block.chars),
    0,
  );
  return Math.round(sum / chars);
}

interface Group {
  name: string;
  mentions: number;
  blocks: number;
  toneSum: number;
  firstMs: number | null;
  lastMs: number | null;
}

function emptyGroup(name: string): Group {
  return { name, mentions: 0, blocks: 0, toneSum: 0, firstMs: null, lastMs: null };
}

/**
 * Documento da nota. `facts` so tem os blocos lidos; a diferenca para `blocks`
 * e a cobertura, exibida como analise parcial (nunca como "o que nao foi lido").
 */
export function composeAnalysis(input: ComposeInput): ComposedAnalysis {
  const { blocks, facts } = input;
  const read = new Set(facts.map((fact) => fact.block.index));

  const knownPeople = new Map<string, string>();
  for (const name of input.known?.people ?? []) {
    const key = nameKey(name);
    if (key !== '') knownPeople.set(key, name.trim());
  }
  const knownPlaces = new Map<string, string>();
  for (const name of input.known?.places ?? []) {
    const key = nameKey(name);
    if (key !== '') knownPlaces.set(key, name.trim());
  }

  const people = new Map<string, Group>();
  const places = new Map<string, Group>();
  const emotions = new Map<AnalysisEmotion, { blocks: number; toneSum: number }>();
  const themes = new Map<AnalysisTheme, number>();
  const events: ComposedItem[] = [];
  const decisions: ComposedItem[] = [];
  const tasks: ComposedItem[] = [];
  const ideas: ComposedItem[] = [];
  const epiphanies: ComposedItem[] = [];
  const moments: ComposedMoment[] = [];

  for (const fact of facts) {
    const { block, extraction } = fact;
    for (const raw of extraction.people) {
      const name = canonicalName(raw, knownPeople);
      const key = nameKey(name);
      const group = people.get(key) ?? emptyGroup(name);
      group.mentions += occurrences(block.text, name);
      group.blocks += 1;
      group.toneSum += extraction.tone;
      if (block.startMs !== null) {
        group.firstMs = group.firstMs === null ? block.startMs : Math.min(group.firstMs, block.startMs);
        const end = block.endMs ?? block.startMs;
        group.lastMs = group.lastMs === null ? end : Math.max(group.lastMs, end);
      }
      people.set(key, group);
    }
    for (const raw of extraction.places) {
      const name = canonicalName(raw, knownPlaces);
      const key = nameKey(name);
      const group = places.get(key) ?? emptyGroup(name);
      group.mentions += occurrences(block.text, name);
      group.blocks += 1;
      if (block.startMs !== null) {
        group.firstMs = group.firstMs === null ? block.startMs : Math.min(group.firstMs, block.startMs);
        const end = block.endMs ?? block.startMs;
        group.lastMs = group.lastMs === null ? end : Math.max(group.lastMs, end);
      }
      places.set(key, group);
    }
    for (const emotion of extraction.emotions) {
      const group = emotions.get(emotion) ?? { blocks: 0, toneSum: 0 };
      group.blocks += 1;
      group.toneSum += extraction.tone;
      emotions.set(emotion, group);
    }
    for (const theme of extraction.themes) {
      themes.set(theme, (themes.get(theme) ?? 0) + 1);
    }
    for (const event of extraction.events) pushUnique(events, event, block);
    for (const decision of extraction.decisions) pushUnique(decisions, decision, block);
    for (const task of extraction.tasks) pushUnique(tasks, task, block);
    for (const idea of extraction.ideas) pushUnique(ideas, idea, block);
    for (const epiphany of extraction.epiphanies) pushUnique(epiphanies, epiphany, block);
    const salience =
      Math.abs(extraction.tone) +
      40 * extraction.people.length +
      40 * extraction.events.length +
      30 * extraction.places.length +
      25 * extraction.decisions.length +
      25 * extraction.epiphanies.length;
    for (const moment of extraction.moments) {
      if (moments.some((item) => sameItem(item.text, moment))) continue;
      moments.push({
        text: moment,
        startMs: block.startMs,
        blockIndex: block.index,
        salience,
      });
    }
  }

  const toPerson = (group: Group): ComposedPerson => ({
    name: group.name,
    mentions: group.mentions,
    blocks: group.blocks,
    tone: Math.round(group.toneSum / Math.max(1, group.blocks)),
    firstMs: group.firstMs,
    lastMs: group.lastMs,
  });
  const toPlace = (group: Group): ComposedPlace => ({
    name: group.name,
    mentions: group.mentions,
    blocks: group.blocks,
    firstMs: group.firstMs,
    lastMs: group.lastMs,
  });
  const byMentions = (a: Group, b: Group): number =>
    b.mentions - a.mentions || b.blocks - a.blocks || a.name.localeCompare(b.name);

  const readBlocks = facts.length;
  const tone = weightedTone(facts);

  return {
    contractVersion: 2,
    model: input.model,
    models: input.models && input.models.length > 0 ? input.models : [input.model],
    tone,
    toneLabel: toneLabelFor(tone),
    sentence: '',
    sentenceSource: 'derived',
    people: [...people.values()].sort(byMentions).slice(0, MAX_PEOPLE).map(toPerson),
    places: [...places.values()].sort(byMentions).slice(0, MAX_PLACES).map(toPlace),
    emotions: [...emotions.entries()]
      .map(([name, group]) => ({
        name,
        blocks: group.blocks,
        share: readBlocks > 0 ? group.blocks / readBlocks : 0,
        tone: Math.round(group.toneSum / Math.max(1, group.blocks)),
      }))
      .sort((a, b) => b.blocks - a.blocks || a.name.localeCompare(b.name)),
    themes: [...themes.entries()]
      .map(([name, count]) => ({ name, blocks: count }))
      .sort((a, b) => b.blocks - a.blocks || a.name.localeCompare(b.name))
      .slice(0, MAX_THEMES),
    events: events.slice(0, MAX_EVENTS).map((item) => ({
      name: item.text,
      blocks: item.blocks,
      startMs: item.startMs,
    })),
    decisions: decisions.slice(0, MAX_ITEMS),
    tasks: tasks.slice(0, MAX_ITEMS),
    ideas: ideas.slice(0, MAX_ITEMS),
    epiphanies: epiphanies.slice(0, MAX_ITEMS),
    moments: pickMoments(moments, blocks.length),
    blocksRead: readBlocks,
    blocksTotal: blocks.length,
    charsRead: facts.reduce((total, fact) => total + fact.block.chars, 0),
    charsTotal: blocks.reduce((total, block) => total + block.chars, 0),
    audioCoveredMs: facts.reduce(
      (total, fact) =>
        fact.block.startMs !== null && fact.block.endMs !== null
          ? total + (fact.block.endMs - fact.block.startMs)
          : total,
      0,
    ),
    audioTotalMs: blocks.reduce(
      (total, block) =>
        block.startMs !== null && block.endMs !== null ? total + (block.endMs - block.startMs) : total,
      0,
    ),
    complete: readBlocks >= blocks.length && blocks.length > 0 && read.size === blocks.length,
  };
}

/**
 * Momentos marcantes: os mais salientes, mas espalhados pela nota. Sem o
 * espalhamento, a nota inteira vira o primeiro trecho da primeira pagina.
 */
function pickMoments(moments: ComposedMoment[], totalBlocks: number): ComposedMoment[] {
  if (moments.length <= MAX_MOMENTS) {
    return [...moments].sort((a, b) => a.blockIndex - b.blockIndex);
  }
  const bucketSize = Math.max(1, Math.ceil(totalBlocks / MAX_MOMENTS));
  const perBucket = new Map<number, number>();
  const picked: ComposedMoment[] = [];
  const ordered = [...moments].sort(
    (a, b) => b.salience - a.salience || a.blockIndex - b.blockIndex,
  );
  for (const moment of ordered) {
    const bucket = Math.floor(moment.blockIndex / bucketSize);
    if ((perBucket.get(bucket) ?? 0) >= 2) continue;
    perBucket.set(bucket, (perBucket.get(bucket) ?? 0) + 1);
    picked.push(moment);
    if (picked.length >= MAX_MOMENTS) break;
  }
  for (const moment of ordered) {
    if (picked.length >= MAX_MOMENTS) break;
    if (!picked.includes(moment)) picked.push(moment);
  }
  return picked.sort((a, b) => a.blockIndex - b.blockIndex);
}

/** Grafia de um nome para relatorio/teste: mesma regra da composicao. */
export function canonicalEntityKey(name: string): string {
  return nameKey(name);
}
