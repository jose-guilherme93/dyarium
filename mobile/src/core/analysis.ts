/**
 * Analise de uma nota pronta para a ficha de propriedades. Puro e testavel:
 * recebe o que o servidor ja produziu (ou o cache do aparelho) e entrega so o
 * que a tela mostra, sem depender de rede.
 */

import type { ServerAnalysis } from './api';

export interface NoteAnalysisMoment {
  startMs: number;
  text: string;
}

export interface NoteAnalysisEmotion {
  name: string;
  intensity: number;
}

export interface NoteAnalysisView {
  sentiment: number | null;
  sentimentLabel: string;
  summary: string;
  themes: string[];
  emotions: NoteAnalysisEmotion[];
  people: string[];
  places: string[];
  moments: NoteAnalysisMoment[];
  questions: string[];
  decisions: string[];
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
  const themes = cleanList((analysis.themes ?? []).map((theme) => theme.name));
  const emotions = toEmotions(analysis.emotions);
  const people = cleanList(analysis.people);
  const places = cleanList(analysis.places);
  const moments = (analysis.key_moments ?? [])
    .map((moment) => ({ startMs: moment.start_ms, text: (moment.text ?? '').trim() }))
    .filter((moment) => moment.text !== '');
  const questions = cleanList(analysis.questions);
  const decisions = cleanList(analysis.decisions);

  if (
    summary === '' &&
    themes.length === 0 &&
    emotions.length === 0 &&
    people.length === 0 &&
    places.length === 0 &&
    moments.length === 0 &&
    questions.length === 0 &&
    decisions.length === 0
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
    themes,
    emotions,
    people,
    places,
    moments,
    questions,
    decisions,
  };
}
