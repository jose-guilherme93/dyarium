/**
 * Agregacao das metricas do servidor para o Painel do app. Puro e testavel:
 * recebe as entradas e as analises e devolve os numeros prontos para exibir.
 */

import type { ServerAnalysis, ServerEntry } from './api';

export interface RankedItem {
  label: string;
  value: number;
}

export interface DashboardSummary {
  total: number;
  transcribed: number;
  analyzed: number;
  failed: number;
  totalDurationSeconds: number;
  totalSizeBytes: number;
  statusCounts: RankedItem[];
  averageSentiment: number | null;
  emotions: RankedItem[];
  people: RankedItem[];
  places: RankedItem[];
}

const TRANSCRIBED_STATUSES = ['transcribed', 'analyzing', 'enriched', 'ready'];

function countAll(lists: (string[] | null)[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const key = item.trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return map;
}

function toRanked(map: Map<string, number>): RankedItem[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export interface AnalysisSource {
  entryId: string;
  title: string;
  recordedAt: string;
  analysis: ServerAnalysis;
}

export interface AnalysisInsight {
  entryId: string;
  title: string;
  recordedAt: string;
  summary: string;
  themes: string[];
  sentimentLabel: string;
}

/**
 * Prepara os insights que o servidor ja produziu para o bloco "Escrita" do
 * painel: os mais recentes primeiro, sem notas vazias, com temas legiveis.
 */
export function toAnalysisInsights(items: AnalysisSource[], limit = 6): AnalysisInsight[] {
  return [...items]
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
    .filter((item) => {
      const summary = item.analysis.summary.trim();
      const themes = item.analysis.themes ?? [];
      return summary !== '' || themes.length > 0;
    })
    .slice(0, limit)
    .map((item) => ({
      entryId: item.entryId,
      title: item.title.trim() || 'Nota',
      recordedAt: item.recordedAt,
      summary: item.analysis.summary.trim(),
      themes: (item.analysis.themes ?? []).map((theme) => theme.name.trim()).filter(Boolean),
      sentimentLabel: item.analysis.sentiment_label ?? '',
    }));
}

export function summarize(entries: ServerEntry[], analyses: ServerAnalysis[]): DashboardSummary {
  const statusMap = new Map<string, number>();
  let totalDurationSeconds = 0;
  let totalSizeBytes = 0;
  let transcribed = 0;
  let failed = 0;

  for (const entry of entries) {
    statusMap.set(entry.status, (statusMap.get(entry.status) ?? 0) + 1);
    totalDurationSeconds += entry.duration_seconds || 0;
    totalSizeBytes += entry.size_bytes || 0;
    if (TRANSCRIBED_STATUSES.includes(entry.status)) transcribed += 1;
    if (entry.status === 'failed') failed += 1;
  }

  const sentiments = analyses
    .map((analysis) => analysis.sentiment)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  const averageSentiment =
    sentiments.length > 0 ? sentiments.reduce((sum, value) => sum + value, 0) / sentiments.length : null;

  const emotionMap = new Map<string, number>();
  for (const analysis of analyses) {
    if (!analysis.emotions) continue;
    for (const [label, value] of Object.entries(analysis.emotions)) {
      emotionMap.set(label, (emotionMap.get(label) ?? 0) + (Number(value) || 0));
    }
  }

  return {
    total: entries.length,
    transcribed,
    analyzed: analyses.length,
    failed,
    totalDurationSeconds,
    totalSizeBytes,
    statusCounts: toRanked(statusMap),
    averageSentiment,
    emotions: toRanked(emotionMap).slice(0, 8),
    people: toRanked(countAll(analyses.map((analysis) => analysis.people))).slice(0, 8),
    places: toRanked(countAll(analyses.map((analysis) => analysis.places))).slice(0, 8),
  };
}
