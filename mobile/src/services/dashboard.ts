/**
 * Carrega os dados do Painel a partir do servidor: entradas, tags e as analises
 * das entradas mais recentes (para humor/emocoes). Leitura apenas.
 */

import {
  DyariumApi,
  type FetchLike,
  type ServerAnalysis,
  type ServerEntry,
  type ServerTag,
} from '@/core/api';

import { loadServerConfig } from './secure';
import { saveCachedAnalyses } from './db';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface DashboardData {
  entries: ServerEntry[];
  tags: ServerTag[];
  analyses: { entry: ServerEntry; analysis: ServerAnalysis }[];
}

/** Busca os dados do painel. Devolve null quando o servidor nao esta configurado. */
export async function loadDashboard(analysisLimit = 20): Promise<DashboardData | null> {
  const config = await loadServerConfig();
  if (!config) return null;
  const api = new DyariumApi(config, doFetch);
  const [entries, tags] = await Promise.all([api.listEntries(), api.listTags()]);

  const recent = entries.slice(0, analysisLimit);
  const results = await Promise.all(
    recent.map(async (entry) => {
      try {
        const analysis = await api.getAnalysis(entry.id);
        return { entry, analysis };
      } catch {
        return null;
      }
    }),
  );
  const analyses = results.filter(
    (item): item is { entry: ServerEntry; analysis: ServerAnalysis } => item !== null,
  );

  // Ja foram feitas no servidor: guarda no aparelho para o painel mostrar mesmo
  // sem rede (e para nao pedir a mesma analise de novo).
  await saveCachedAnalyses(
    analyses.map(({ entry, analysis }) => ({
      entryId: entry.id,
      title: entry.title || entry.original_filename || 'Nota',
      recordedAt: entry.recorded_at ?? entry.created_at,
      analysis,
    })),
  ).catch(() => undefined);

  return { entries, tags, analyses };
}
