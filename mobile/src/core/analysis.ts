/**
 * Analise de uma nota pronta para a ficha de propriedades. Puro e testavel:
 * recebe o que o servidor ja produziu (ou o cache do aparelho) e entrega so o
 * que a tela mostra, sem depender de rede.
 */

import type { ServerAnalysis } from './api';
import type { ParsedAnalysis } from './analysisPrompt';

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

export interface NoteAnalysisView {
  sentiment: number | null;
  sentimentLabel: string;
  summary: string;
  /** Leitura curta da IA; cai no resumo quando a analise e antiga. */
  reading: string;
  /** Leitura de cada secao (titulos do texto e a transcricao). */
  sections: NoteAnalysisSection[];
  themes: string[];
  emotions: NoteAnalysisEmotion[];
  people: string[];
  places: string[];
  moments: NoteAnalysisMoment[];
  questions: string[];
  decisions: string[];
  /** 0-100; null quando nao medida. */
  comprehension: number | null;
  /** "review" quando veio da revisao, "analysis" para a estimativa do modelo. */
  comprehensionSource: string;
  stutterRate: number;
  hesitationRate: number;
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
 * Ultima linha de defesa: quando o modelo nao devolve JSON utilizavel, estima o
 * tom pelas palavras da nota. Nao substitui a analise rica; a ficha avisa que e
 * simplificada.
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
    comprehension: -1,
    comprehension_source: 'analysis',
  };
}

/**
 * Converte o resultado do modelo local para o formato que a ficha e o cache ja
 * entendem. O texto bruto e os segmentos nunca saem do aparelho; so este JSON
 * derivado e guardado.
 */
export function toServerAnalysis(parsed: ParsedAnalysis, model: string): ServerAnalysis {
  return {
    model,
    sentiment: parsed.sentiment.score,
    sentiment_label: parsed.sentiment.label,
    emotions: Object.fromEntries(
      parsed.emotions.map((emotion) => [emotion.name, emotion.value]),
    ),
    people: parsed.people.map((person) => person.name),
    places: parsed.places.map((place) => place.name),
    summary: parsed.reading,
    themes: parsed.themes.map((theme) => ({ name: theme.name, confidence: theme.value })),
    key_moments: null,
    questions: null,
    decisions: parsed.decisions,
    comprehension: parsed.comprehension ?? -1,
    comprehension_source: 'analysis',
  };
}

/**
 * Converte a analise do servidor para a ficha da nota. Devolve null quando
 * ainda nao ha nada de conteudo: o menu mostra "sem analise" em vez de uma
 * secao vazia.
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
  const moments = (analysis.key_moments ?? [])
    .map((moment) => ({ startMs: moment.start_ms, text: (moment.text ?? '').trim() }))
    .filter((moment) => moment.text !== '');
  const questions = cleanList(analysis.questions);
  const decisions = cleanList(analysis.decisions);
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
    comprehension === null
  ) {
    return null;
  }

  const sentiment =
    typeof analysis.sentiment === 'number' && Number.isFinite(analysis.sentiment)
      ? analysis.sentiment
      : null;

  return {
    sentiment,
    sentimentLabel: sentimentText(sentiment, analysis.sentiment_label),
    summary,
    reading,
    sections,
    themes,
    emotions,
    people,
    places,
    moments,
    questions,
    decisions,
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
  };
}
