/**
 * Dados do mapa a partir do SQLite do aparelho.
 *
 * Nada aqui chama o servidor: o grafo e uma leitura das analises que ja estao
 * no aparelho, para abrir o mapa no aviao, no metro ou sem instancia. A
 * reconciliacao com o servidor (nomes, icones, "sou eu") e um passo separado e
 * best-effort; quando ela nao roda, o mapa continua valendo o que esta local.
 */

import type {
  EntityKind,
  GraphData,
  GraphEntry,
  GraphOptions,
} from '@/core/graphModel';
import { buildGraph, type GraphSource } from '@/core/graphBuild';
import type { GraphLayout } from '@/core/graphLayout';
import { layoutGraph, layoutKey } from '@/core/graphLayout';
import type { EntityPanel } from '@/core/graphPanel';
import { buildEntityPanel } from '@/core/graphPanel';
import type { ServerAnalysis } from '@/core/api';

import {
  listEntityAliases,
  listEntityLinks,
  listGraphRecordings,
  listLocalEntities,
  listOwnerAliases,
  loadAnalysisComments,
  loadAnalysisSentiments,
  loadGraphEntryDetails,
  loadGraphLayout,
  loadGraphSnapshotCache,
  saveGraphLayout,
  saveGraphSnapshotCache,
} from './db';
import { loadAuthorSettings } from './authorSettings';
import { DEFAULT_NOTEBOOK_ID } from '@/core/notebooks';
import { buildMoodSeries, type MoodPoint } from '@/core/graphMood';

export interface GraphFilters {
  notebookId?: string;
  /** Inicio do periodo, `YYYY-MM-DD` no fuso do aparelho. */
  from?: string;
  to?: string;
}

export interface GraphSnapshot extends GraphSource {
  ownerName: string;
  ownerAliases: string[];
  aliases: Record<string, string[]>;
  allNotesMine: boolean;
  /** Notas com analise e notas totais da biblioteca (para o estado vazio). */
  analyzed: number;
  total: number;
  /** Entrada por chave de analise, para abrir uma nota a partir de um no. */
  entryByKey: Record<string, GraphEntry>;
}

function dayOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function withinPeriod(recordedAt: string, filters: GraphFilters): boolean {
  const day = dayOf(recordedAt);
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  return true;
}

/**
 * Le a biblioteca e devolve tudo o que o mapa precisa. Nao parseia payload de
 * analise nem transcricao: o desenho usa so contagens e o tom, e os trechos sao
 * carregados quando uma entidade e aberta (`loadEntityPanel`).
 */
export async function loadGraphSnapshot(filters: GraphFilters = {}): Promise<GraphSnapshot> {
  const [recordings, entities, links, aliases, ownerAliases, settings] = await Promise.all([
    listGraphRecordings(),
    listLocalEntities(),
    listEntityLinks(),
    listEntityAliases(),
    listOwnerAliases(),
    loadAuthorSettings(),
  ]);

  const entries: GraphEntry[] = [];
  const entryByKey: Record<string, GraphEntry> = {};
  let analyzed = 0;

  for (const recording of recordings) {
    if (recording.archived) continue;
    if (!withinPeriod(recording.recordedAt, filters)) continue;
    if (filters.notebookId && recording.notebookId !== filters.notebookId) continue;
    // A analise pode estar sob o id local (antes do upload) ou sob o entry id
    // do servidor. Uma analise local pendente vence a copia antiga do servidor,
    // como na tela da nota.
    const definitive = recording.definitive;
    const pending = recording.local;
    const usePending = pending?.origin === 'local' && definitive?.origin !== 'local';
    const chosen = usePending ? pending : (definitive ?? pending);
    const analysisKey = usePending
      ? recording.localId
      : definitive
        ? (recording.entryId ?? definitive.key)
        : recording.localId;
    const entry: GraphEntry = {
      id: analysisKey,
      localId: recording.localId,
      entryId: recording.entryId,
      title: recording.title,
      recordedAt: recording.recordedAt,
      notebookId: recording.notebookId || DEFAULT_NOTEBOOK_ID,
      author: recording.author,
      hasAnalysis: Boolean(chosen),
    };
    if (chosen) analyzed += 1;
    entries.push(entry);
    entryByKey[analysisKey] = entry;
  }

  const keys = new Set(entries.map((entry) => entry.id));
  const visibleLinks = links.filter((link) => keys.has(link.entryId));
  const entityIds = new Set(visibleLinks.map((link) => link.entityId));
  const visibleEntities = entities.filter((entity) => entityIds.has(entity.id));

  return {
    entries,
    entities: visibleEntities,
    links: visibleLinks,
    centerLabel: settings.ownerName.trim() || 'Você',
    ownerName: settings.ownerName,
    ownerAliases,
    aliases,
    allNotesMine: settings.allNotesMine,
    analyzed,
    total: entries.length,
    entryByKey,
  };
}

/** Ultimo recorte gravado para este filtro, sem tocar nas tabelas. */
export async function readCachedSnapshot(key: string): Promise<GraphSnapshot | null> {
  const json = await loadGraphSnapshotCache(key).catch(() => null);
  if (!json) return null;
  try {
    return JSON.parse(json) as GraphSnapshot;
  } catch {
    return null;
  }
}

/** Guarda o recorte para a proxima abertura (best-effort, nunca no caminho). */
export function rememberSnapshot(key: string, snapshot: GraphSnapshot): void {
  try {
    void saveGraphSnapshotCache(key, JSON.stringify(snapshot)).catch(() => undefined);
  } catch {
    // Cache e otimizacao: se o JSON falhar, o mapa segue com a leitura normal.
  }
}

/** Monta o grafo (visao do dia a dia ou foco) a partir do snapshot. */
export function graphFromSnapshot(snapshot: GraphSnapshot, options: GraphOptions = {}): GraphData {
  return buildGraph(snapshot, options);
}

/**
 * Layout com cache no aparelho. A conta e deterministica, entao reaproveitar a
 * posicao nao muda o desenho; so evita refazer o mesmo trabalho ao reabrir.
 */
/**
 * Layout com cache no aparelho. A conta e deterministica, entao reaproveitar a
 * posicao nao muda o desenho; so evita refazer o mesmo trabalho ao reabrir. O
 * cache em memoria evita ate a leitura do SQLite quando a tela volta.
 */
const layoutMemory = new Map<string, GraphLayout>();

function remember(key: string, layout: GraphLayout): void {
  // Mantem so os ultimos conjuntos: evita crescer sem limite durante a sessao.
  if (layoutMemory.size > 12) layoutMemory.clear();
  layoutMemory.set(key, layout);
  void saveGraphLayout(layout).catch(() => undefined);
}

export async function layoutForGraph(
  data: GraphData,
  focus?: string,
): Promise<GraphLayout> {
  const started = Date.now();
  const key = layoutKey(data, focus);
  const memory = layoutMemory.get(key);
  if (memory) {
    if (__DEV__) {
      console.log(`[map] layout mem ${data.nodes.length} nos ${Date.now() - started}ms`);
    }
    return memory;
  }
  const cached = await loadGraphLayout(key).catch(() => null);
  if (cached) {
    layoutMemory.set(key, cached);
    if (__DEV__) {
      console.log(`[map] layout cache ${data.nodes.length} nos ${Date.now() - started}ms`);
    }
    return cached;
  }
  const simStarted = Date.now();
  const layout = layoutGraph(data, { focus });
  remember(key, layout);
  if (__DEV__) {
    console.log(
      `[map] layout sim ${data.nodes.length} nos ${data.edges.length} arestas ${
        Date.now() - simStarted
      }ms (total ${Date.now() - started}ms)`,
    );
  }
  return layout;
}

/** Painel de uma entidade com todos os trechos das notas que a mencionam. */
export function panelForEntity(
  snapshot: GraphSnapshot,
  entityId: string,
): EntityPanel | null {
  const entity = snapshot.entities.find((item) => item.id === entityId);
  if (!entity) return null;
  return buildEntityPanel(
    entity,
    snapshot.entries,
    snapshot.links,
    snapshot.aliases[entity.id] ?? [],
  );
}

/**
 * Hidrata so as notas da entidade escolhida (texto, transcricao e leitura) e
 * monta o painel. E o unico ponto que paga o custo de ler transcricoes; o mapa
 * inteiro nunca as carrega.
 */
export async function loadEntityPanel(
  snapshot: GraphSnapshot,
  entityId: string,
): Promise<EntityPanel | null> {
  const entity = snapshot.entities.find((item) => item.id === entityId);
  if (!entity) return null;
  const entityLinks = snapshot.links.filter((link) => link.entityId === entityId);
  const keys = [...new Set(entityLinks.map((link) => link.entryId))];
  const entries = keys
    .map((key) => snapshot.entryByKey[key])
    .filter((entry): entry is GraphEntry => Boolean(entry));
  const localIds = entries
    .map((entry) => entry.localId)
    .filter((id): id is string => Boolean(id));
  const [details, comments] = await Promise.all([
    loadGraphEntryDetails(localIds),
    loadAnalysisComments(entries.map((entry) => entry.id)),
  ]);
  const hydrated = entries.map((entry) => {
    const detail = entry.localId ? details[entry.localId] : undefined;
    const comment = comments[entry.id];
    const analysis =
      comment && (comment.reading || comment.summary)
        ? ({ reading: comment.reading, summary: comment.summary } as ServerAnalysis)
        : undefined;
    return {
      ...entry,
      text: detail?.text,
      transcript: detail?.transcript,
      transcriptSegments: detail?.transcriptSegments,
      analysis,
    };
  });
  return buildEntityPanel(entity, hydrated, entityLinks, snapshot.aliases[entity.id] ?? []);
}

/** Serie de humor do recorte visivel, lida sob demanda (aba Humor). */
export async function loadMoodSeries(entries: GraphEntry[]): Promise<MoodPoint[]> {
  const keys = entries
    .filter((entry) => entry.hasAnalysis ?? Boolean(entry.analysis))
    .map((entry) => entry.id);
  const scores = await loadAnalysisSentiments(keys);
  return buildMoodSeries(
    entries.map((entry) => ({
      ...entry,
      sentiment: scores[entry.id] ?? entry.sentiment,
    })),
  );
}

/** Chave da analise de um no de nota (`note:<key>`). */
export function noteKeyFromNode(nodeId: string): string {
  return nodeId.startsWith('note:') ? nodeId.slice('note:'.length) : '';
}

/** Tipos presentes no grafo, para os chips do topo. */
export function kindCounts(data: GraphData): Record<EntityKind, number> {
  const counts: Record<EntityKind, number> = {
    person: 0,
    place: 0,
    theme: 0,
    decision: 0,
  };
  for (const node of data.nodes) {
    if (node.kind === 'person' || node.kind === 'place' || node.kind === 'theme' || node.kind === 'decision') {
      counts[node.kind] += 1;
    }
  }
  return counts;
}
