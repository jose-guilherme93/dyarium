/**
 * Analise de uma nota pronta para a ficha de propriedades. Puro e testavel:
 * recebe o documento composto (ou a copia do servidor) e entrega so o que a
 * tela mostra, sem depender de rede.
 */

import type { ServerAnalysis } from './api';
import { CHUNK_PROMPT_VERSION } from './analysisChunk';
import type { ComposedAnalysis, ToneLabel } from './analysisCompose';

export interface NoteAnalysisMoment {
  startMs: number;
  text: string;
}

export interface NoteAnalysisEmotion {
  name: string;
  intensity: number;
}

export interface NoteAnalysisSection {
  heading: string;
  kind: string;
  reading: string;
  summary: string;
  sentimentLabel: string;
}

export interface NoteAnalysisCoverage {
  blocksRead: number;
  blocksTotal: number;
  charsRead: number;
  charsTotal: number;
  audioMs: number;
  /** Falta bloco: a ficha oferece continuar a analise. */
  partial: boolean;
}

export interface NoteAnalysisView {
  sentiment: number | null;
  sentimentLabel: string;
  summary: string;
  /** Leitura curta da IA; cai no resumo quando a analise e antiga. */
  reading: string;
  /** A frase veio do modelo ou foi derivada dos campos pelo codigo. */
  sentenceSource: '' | 'model' | 'derived';
  /** Leitura de cada secao (titulos do texto e a transcricao). */
  sections: NoteAnalysisSection[];
  themes: string[];
  emotions: NoteAnalysisEmotion[];
  people: string[];
  /** Pessoas com a contagem de mencoes, quando a analise informou. */
  peopleDetail: { name: string; count: number }[];
  places: string[];
  placesDetail: { name: string; count: number }[];
  moments: NoteAnalysisMoment[];
  questions: string[];
  decisions: string[];
  tasks: string[];
  ideas: string[];
  events: string[];
  epiphanies: string[];
  /** 0-100; null quando nao medida. */
  comprehension: number | null;
  /** "review" quando veio da revisao, "analysis" para a estimativa do modelo. */
  comprehensionSource: string;
  stutterRate: number;
  hesitationRate: number;
  /** Cobertura da leitura por bloco; null em analise antiga, sem blocos. */
  coverage: NoteAnalysisCoverage | null;
  /** Versao do contrato do documento; 0/ausente em analise antiga. */
  contractVersion: number;
}

function cleanList(items: (string | null | undefined)[] | null | undefined): string[] {
  if (!items) return [];
  const out: string[] = [];
  for (const item of items) {
    const value = item?.trim();
    if (value) out.push(value);
  }
  return out;
}

function sentimentText(score: number | null, label: string | undefined): string {
  const named = label?.trim();
  if (named) return named;
  if (score === null) return '';
  if (score > 0.15) return 'positivo';
  if (score < -0.15) return 'negativo';
  return 'neutro';
}

function toEmotions(
  emotions: Record<string, number> | null | undefined,
): NoteAnalysisEmotion[] {
  if (!emotions) return [];
  const out: NoteAnalysisEmotion[] = [];
  for (const [name, intensity] of Object.entries(emotions)) {
    const label = name.trim();
    const value = Number(intensity);
    if (!label || !Number.isFinite(value)) continue;
    out.push({ name: label, intensity: value });
  }
  return out.sort((a, b) => b.intensity - a.intensity);
}

const POSITIVE_WORDS = new Set([
  'bom',
  'boa',
  'feliz',
  'alegre',
  'alegria',
  'tranquilo',
  'tranquila',
  'calmo',
  'calma',
  'leve',
  'grato',
  'grata',
  'amor',
  'gostei',
  'melhor',
  'melhorei',
  'sucesso',
  'esperanca',
  'animado',
  'animada',
  'orgulho',
  'conquista',
]);

const NEGATIVE_WORDS = new Set([
  'ruim',
  'triste',
  'tristeza',
  'cansado',
  'cansada',
  'ansioso',
  'ansiosa',
  'medo',
  'raiva',
  'dificil',
  'pior',
  'dor',
  'perda',
  'culpa',
  'estresse',
  'preocupado',
  'preocupada',
  'sozinho',
  'sozinha',
  'frustrado',
  'frustrada',
  'chorar',
]);

function normalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Ultima linha de defesa: quando nao ha analise por bloco, estima o tom pelas
 * palavras da nota. Nao e uma analise: a ficha marca como leitura simplificada,
 * nunca sobe ao servidor e nao entra na serie de sentimento do painel.
 */
export function simplifiedAnalysis(text: string): ServerAnalysis {
  const words = normalizedWords(text);
  let positive = 0;
  let negative = 0;
  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positive += 1;
    if (NEGATIVE_WORDS.has(word)) negative += 1;
  }
  const score = Math.max(-1, Math.min(1, (positive - negative) / Math.max(1, positive + negative + 2)));
  const label = score > 0.15 ? 'positivo' : score < -0.15 ? 'negativo' : 'neutro';
  return {
    model: 'local-fallback',
    origin: 'app',
    sentiment: score,
    sentiment_label: label,
    emotions: null,
    people: null,
    places: null,
    summary: `Leitura simplificada: tom ${label}.`,
    themes: null,
    key_moments: null,
    questions: null,
    decisions: null,
    tasks: null,
    ideas: null,
    events: null,
    epiphanies: null,
    comprehension: -1,
    comprehension_source: 'analysis',
    coverage: null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ServerAnalysisExtras {
  /** Compreensao medida pela revisao da transcricao (0-100). */
  comprehension?: number;
  comprehensionSource?: string;
  stutterRate?: number;
  hesitationRate?: number;
  revisedSegments?: number;
}

/**
 * Converte o documento composto para o formato que a ficha, o cache e o
 * servidor entendem. O texto bruto e os segmentos nunca saem do aparelho; so
 * este JSON derivado e guardado.
 */
export function toServerAnalysis(
  doc: ComposedAnalysis,
  model: string,
  extras: ServerAnalysisExtras = {},
): ServerAnalysis {
  const comprehension =
    typeof extras.comprehension === 'number' && extras.comprehension >= 0
      ? Math.round(extras.comprehension)
      : -1;
  return {
    model,
    origin: 'app',
    schema_version: doc.contractVersion,
    prompt_version: CHUNK_PROMPT_VERSION,
    sentiment: round2(doc.tone / 100),
    sentiment_label: doc.toneLabel,
    emotions: Object.fromEntries(doc.emotions.map((emotion) => [emotion.name, round2(emotion.share)])),
    people: doc.people.map((person) => person.name),
    people_detail: doc.people.map((person) => ({
      name: person.name,
      count: person.mentions,
      sentiment: round2(person.tone / 100),
    })),
    places: doc.places.map((place) => place.name),
    places_detail: doc.places.map((place) => ({ name: place.name, count: place.mentions })),
    summary: doc.sentence,
    sentence_source: doc.sentenceSource,
    themes: doc.themes.map((theme) => ({
      name: theme.name,
      confidence: round2(theme.blocks / Math.max(1, doc.blocksRead)),
    })),
    key_moments: doc.moments
      .filter((moment) => moment.startMs !== null)
      .map((moment) => ({ start_ms: moment.startMs ?? 0, text: moment.text })),
    questions: null,
    decisions: doc.decisions.map((item) => item.text),
    tasks: doc.tasks.map((item) => item.text),
    ideas: doc.ideas.map((item) => item.text),
    events: doc.events.map((event) => event.name),
    epiphanies: doc.epiphanies.map((item) => item.text),
    comprehension,
    comprehension_source:
      extras.comprehensionSource ?? (comprehension >= 0 ? 'analysis' : ''),
    stutter_rate: extras.stutterRate ?? 0,
    hesitation_rate: extras.hesitationRate ?? 0,
    revised_segments: extras.revisedSegments ?? 0,
    coverage: {
      blocks_read: doc.blocksRead,
      blocks_total: doc.blocksTotal,
      chars_read: doc.charsRead,
      chars_total: doc.charsTotal,
      audio_ms: doc.audioCoveredMs,
      partial: !doc.complete,
    },
  };
}

/**
 * Converte a analise do servidor (ou do cache) para a ficha da nota. Devolve
 * null quando ainda nao ha nada de conteudo: o menu mostra "sem analise" em vez
 * de uma secao vazia.
 */
export function toNoteAnalysis(
  analysis: ServerAnalysis | null | undefined,
): NoteAnalysisView | null {
  if (!analysis) return null;

  const summary = (analysis.summary ?? '').trim();
  const reading = (analysis.reading ?? '').trim();
  const sections = (analysis.sections ?? [])
    .map((section) => ({
      heading: (section.heading ?? '').trim(),
      kind: (section.kind ?? '').trim(),
      reading: (section.reading ?? '').trim(),
      summary: (section.summary ?? '').trim(),
      sentimentLabel: (section.sentiment?.label ?? '').trim(),
    }))
    .filter((section) => section.heading !== '' || section.reading !== '' || section.summary !== '');
  const themes = cleanList((analysis.themes ?? []).map((theme) => theme.name));
  const emotions = toEmotions(analysis.emotions);
  const people = cleanList(analysis.people);
  const places = cleanList(analysis.places);
  const peopleDetail = (analysis.people_detail ?? [])
    .map((person) => ({
      name: (person.name ?? '').trim(),
      count: Math.max(1, Math.round(person.count ?? 1)),
    }))
    .filter((person) => person.name !== '');
  const placesDetail = (analysis.places_detail ?? [])
    .map((place) => ({
      name: (place.name ?? '').trim(),
      count: Math.max(1, Math.round(place.count ?? 1)),
    }))
    .filter((place) => place.name !== '');
  // Analise antiga so tem a lista de nomes: conta 1 para nao esconder a pessoa.
  const peopleWithCounts =
    peopleDetail.length > 0 ? peopleDetail : people.map((name) => ({ name, count: 1 }));
  const placesWithCounts =
    placesDetail.length > 0 ? placesDetail : places.map((name) => ({ name, count: 1 }));
  const moments = (analysis.key_moments ?? [])
    .map((moment) => ({ startMs: moment.start_ms, text: (moment.text ?? '').trim() }))
    .filter((moment) => moment.text !== '');
  const questions = cleanList(analysis.questions);
  const decisions = cleanList(analysis.decisions);
  const tasks = cleanList(analysis.tasks);
  const ideas = cleanList(analysis.ideas);
  const events = cleanList(analysis.events);
  const epiphanies = cleanList(analysis.epiphanies);
  const comprehension =
    typeof analysis.comprehension === 'number' && analysis.comprehension >= 0
      ? Math.round(analysis.comprehension)
      : null;

  if (
    summary === '' &&
    reading === '' &&
    sections.length === 0 &&
    themes.length === 0 &&
    emotions.length === 0 &&
    people.length === 0 &&
    places.length === 0 &&
    moments.length === 0 &&
    questions.length === 0 &&
    decisions.length === 0 &&
    tasks.length === 0 &&
    ideas.length === 0 &&
    events.length === 0 &&
    epiphanies.length === 0 &&
    comprehension === null
  ) {
    return null;
  }

  const sentiment =
    typeof analysis.sentiment === 'number' && Number.isFinite(analysis.sentiment)
      ? analysis.sentiment
      : null;

  const coverage = analysis.coverage
    ? {
        blocksRead: Math.max(0, Math.round(analysis.coverage.blocks_read ?? 0)),
        blocksTotal: Math.max(0, Math.round(analysis.coverage.blocks_total ?? 0)),
        charsRead: Math.max(0, Math.round(analysis.coverage.chars_read ?? 0)),
        charsTotal: Math.max(0, Math.round(analysis.coverage.chars_total ?? 0)),
        audioMs: Math.max(0, Math.round(analysis.coverage.audio_ms ?? 0)),
        partial:
          analysis.coverage.partial === true ||
          (analysis.coverage.blocks_total ?? 0) > (analysis.coverage.blocks_read ?? 0),
      }
    : null;

  return {
    sentiment,
    sentimentLabel: sentimentText(sentiment, analysis.sentiment_label),
    summary,
    reading,
    sentenceSource: analysis.sentence_source ?? '',
    sections,
    themes,
    emotions,
    people,
    peopleDetail: peopleWithCounts,
    places,
    placesDetail: placesWithCounts,
    moments,
    questions,
    decisions,
    tasks,
    ideas,
    events,
    epiphanies,
    comprehension,
    comprehensionSource: (analysis.comprehension_source ?? '').trim(),
    stutterRate:
      typeof analysis.stutter_rate === 'number' && analysis.stutter_rate > 0
        ? analysis.stutter_rate
        : 0,
    hesitationRate:
      typeof analysis.hesitation_rate === 'number' && analysis.hesitation_rate > 0
        ? analysis.hesitation_rate
        : 0,
    coverage,
    contractVersion: Math.max(0, Math.round(analysis.schema_version ?? 0)),
  };
}

/** Rotulo de tom para a ficha (usado pelos testes de composicao). */
export function toneText(tone: number): ToneLabel {
  if (tone >= 15) return 'positivo';
  if (tone <= -15) return 'negativo';
  return 'neutro';
}
