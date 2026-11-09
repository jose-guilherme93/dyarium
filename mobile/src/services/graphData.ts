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
import {
  layoutGraph,
  layoutKey,
  type GraphLayout,
  type NodePosition,
} from '@/core/graphLayout';
import type { EntityPanel } from '@/core/graphPanel';
import { buildEntityPanel, buildEntityPanelPage, entityStats } from '@/core/graphPanel';
import type { ServerAnalysis } from '@/core/api';

import type { EntityPanelRow } from './db';
import {
  listEntityAliases,
  listEntityLinks,
  listGraphRecordings,
  listLocalEntities,
  listOwnerAliases,
  loadAnalysisSentiments,
  loadEntityPanelRows,
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
 * Recorte da sessao. O mapa e a tela de relacao pedem o mesmo snapshot varias
 * vezes; sem isso, abrir uma relacao lia a biblioteca inteira de novo e a tela
 * ficava segundos no spinner.
 */
let sessionSnapshot: { key: string; at: number; snapshot: GraphSnapshot } | null = null;
/** Tempo em que o recorte da sessao vale antes de reler o banco. */
const SESSION_SNAPSHOT_MS = 20_000;

function snapshotFiltersKey(filters: GraphFilters): string {
  return `${filters.notebookId ?? ''}|${filters.from ?? ''}|${filters.to ?? ''}`;
}

/** Recorte lido ha pouco para este filtro, sem tocar no banco. */
export function readSessionSnapshot(filters: GraphFilters = {}): GraphSnapshot | null {
  if (!sessionSnapshot) return null;
  if (sessionSnapshot.key !== snapshotFiltersKey(filters)) return null;
  return sessionSnapshot.snapshot;
}

/**
 * Le a biblioteca e devolve tudo o que o mapa precisa. Nao parseia payload de
 * analise nem transcricao: o desenho usa so contagens e o tom, e os trechos sao
 * carregados quando uma entidade e aberta (`loadEntityPanel`).
 */
export async function loadGraphSnapshot(filters: GraphFilters = {}): Promise<GraphSnapshot> {
  const key = snapshotFiltersKey(filters);
  if (
    sessionSnapshot &&
    sessionSnapshot.key === key &&
    Date.now() - sessionSnapshot.at < SESSION_SNAPSHOT_MS
  ) {
    return sessionSnapshot.snapshot;
  }
  // Travessao de tempo por leitura: o mapa abria em segundos e era preciso ver
  // qual consulta (ou fila do banco) segurava a abertura.
  const t0 = Date.now();
  const recordings = await listGraphRecordings();
  const t1 = Date.now();
  const entities = await listLocalEntities();
  const links = await listEntityLinks();
  const aliases = await listEntityAliases();
  const ownerAliases = await listOwnerAliases();
  const settings = await loadAuthorSettings();
  if (__DEV__) {
    console.log(
      `[map] leitura ${recordings.length} notas em ${t1 - t0}ms, ` +
        `entidades/vinculos/aliases em ${Date.now() - t1}ms`,
    );
  }

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

  const snapshot: GraphSnapshot = {
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
  sessionSnapshot = { key, at: Date.now(), snapshot };
  return snapshot;
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

/**
 * Grafo montado a partir do recorte, guardado enquanto o recorte viver.
 *
 * Montar o grafo de 404 notas custa ~490 ms neste aparelho. O mapa e a tela da
 * entidade pedem exatamente o mesmo conjunto (mesmo objeto de snapshot e mesmas
 * opcoes), entao a segunda montagem vira leitura de cache em vez de refazer a
 * conta no gesto de abrir a bola.
 */
const graphCache = new WeakMap<GraphSnapshot, Map<string, GraphData>>();

function graphOptionsKey(options: GraphOptions): string {
  const kinds = options.kinds ? [...options.kinds].sort().join(',') : '';
  return `${options.nodeLimit ?? ''}|${options.edgesPerNode ?? ''}|${options.noteLimit ?? ''}|${options.focus ?? ''}|${kinds}`;
}

/** Monta o grafo (visao do dia a dia ou foco) a partir do snapshot. */
export function graphFromSnapshot(snapshot: GraphSnapshot, options: GraphOptions = {}): GraphData {
  const key = graphOptionsKey(options);
  const byKey = graphCache.get(snapshot);
  const cached = byKey?.get(key);
  if (cached) return cached;
  const graph = buildGraph(snapshot, options);
  const target = byKey ?? new Map<string, GraphData>();
  if (target.size > 8) target.clear();
  target.set(key, graph);
  if (!byKey) graphCache.set(snapshot, target);
  return graph;
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

/**
 * Layout do foco semeado no desenho que esta na tela. As bolas que ja existiam
 * ficam onde estavam, entao a fisica tem pouco a assentar: sai no proprio
 * toque, sem ler o banco nem esperar a simulacao inteira.
 */
export function layoutSeeded(
  data: GraphData,
  focus: string,
  seed: Record<string, NodePosition> | null,
  steps = 60,
): GraphLayout {
  const key = layoutKey(data, focus, steps);
  const memory = layoutMemory.get(key);
  if (memory) return memory;
  const started = Date.now();
  const layout = layoutGraph(data, { focus, seed: seed ?? undefined, steps });
  if (__DEV__) {
    console.log(`[map] foco ${data.nodes.length} nos ${Date.now() - started}ms`);
  }
  remember(key, layout);
  return layout;
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

/** Trechos carregados na primeira pagina do painel. */
export const ENTITY_PANEL_PAGE = 15;
/** Trechos a mais a cada "Ver mais". */
export const ENTITY_PANEL_MORE = 30;
/** Notas hidratadas por consulta enquanto a pagina de trechos nao enche. */
const HYDRATE_CHUNK = 15;

export interface EntityPanelPage {
  panel: EntityPanel | null;
  /** Ha mais trechos alem desta pagina. */
  hasMore: boolean;
}

/**
 * Cache de sessao do painel. Abrir o mesmo no de novo reusa os grupos e os
 * totais sem tocar no banco; a assinatura do recorte invalida quando ele muda.
 */
const PANEL_CACHE_LIMIT = 8;
const panelCache = new Map<string, EntityPanelPage>();

function snapshotSignature(snapshot: GraphSnapshot): string {
  let latest = '';
  for (const entry of snapshot.entries) {
    if (entry.recordedAt > latest) latest = entry.recordedAt;
  }
  return `${snapshot.entries.length}|${snapshot.links.length}|${snapshot.entities.length}|${latest}`;
}

function rememberPanel(key: string, page: EntityPanelPage): void {
  if (panelCache.size >= PANEL_CACHE_LIMIT) panelCache.clear();
  panelCache.set(key, page);
}

function hydrateEntry(entry: GraphEntry, row: EntityPanelRow | undefined): GraphEntry {
  const reading = row?.reading?.trim();
  const summary = row?.summary?.trim();
  const analysis =
    reading || summary
      ? ({ reading: reading || undefined, summary: summary || undefined } as ServerAnalysis)
      : undefined;
  return {
    ...entry,
    text: row?.text,
    transcript: row?.transcript,
    transcriptSegments: row?.transcriptSegments,
    analysis,
  };
}

/**
 * Hidrata as notas da entidade ate encher a pagina de trechos e monta o painel.
 *
 * O limite e por trecho, nao por nota: uma nota pode ter centenas de trechos e
 * a tela nao deve abrir com todos. As notas sao lidas em blocos de 15 e a
 * leitura para assim que a pagina tem mais trechos que o limite (o excedente
 * so serve para saber que existe "Ver mais"). E o unico ponto que paga o custo
 * de ler transcricoes; o mapa inteiro nunca as carrega.
 *
 * Os numeros do painel saem de `entityStats` sobre TODAS as notas do recorte,
 * para mencoes e notas nao encolherem quando a pagina e so um pedaco.
 */
export async function loadEntityPanel(
  snapshot: GraphSnapshot,
  entityId: string,
  options: { limit?: number } = {},
): Promise<EntityPanelPage> {
  const t0 = Date.now();
  const entity = snapshot.entities.find((item) => item.id === entityId);
  if (!entity) return { panel: null, hasMore: false };

  const limit = Math.max(1, options.limit ?? ENTITY_PANEL_PAGE);
  const cacheKey = `${entityId}|${limit}|${snapshotSignature(snapshot)}`;
  const cached = panelCache.get(cacheKey);
  if (cached) return cached;

  const entityLinks = snapshot.links.filter((link) => link.entityId === entityId);
  const noteKeys = [...new Set(entityLinks.map((link) => link.entryId))];
  const notes = noteKeys
    .map((key) => snapshot.entryByKey[key])
    .filter((entry): entry is GraphEntry => Boolean(entry))
    .sort((a, b) =>
      a.recordedAt === b.recordedAt
        ? a.id < b.id
          ? -1
          : 1
        : a.recordedAt < b.recordedAt
          ? 1
          : -1,
    );

  const aliases = snapshot.aliases[entity.id] ?? [];
  const stats = entityStats(entity.id, snapshot.entries, snapshot.links);
  const hydrated: GraphEntry[] = [];
  let totalItems = 0;
  const tq = Date.now();
  let cursor = 0;
  while (cursor < notes.length) {
    const chunk = notes.slice(cursor, cursor + HYDRATE_CHUNK);
    const localIds = chunk
      .map((entry) => entry.localId)
      .filter((id): id is string => Boolean(id));
    const rows = localIds.length > 0 ? await loadEntityPanelRows(localIds) : {};
    for (const entry of chunk) {
      hydrated.push(hydrateEntry(entry, entry.localId ? rows[entry.localId] : undefined));
    }
    cursor += chunk.length;
    totalItems = buildEntityPanelPage(
      entity,
      hydrated,
      entityLinks,
      aliases,
      stats,
      limit,
    ).totalItems;
    // Passou do limite: ja ha o suficiente para a pagina e para saber que ha
    // mais trechos adiante.
    if (totalItems > limit) break;
  }
  const tQueries = Date.now() - tq;

  const slice = buildEntityPanelPage(entity, hydrated, entityLinks, aliases, stats, limit);
  const hasMore = slice.totalItems > limit || cursor < notes.length;
  const result: EntityPanelPage = { panel: slice.panel, hasMore };
  rememberPanel(cacheKey, result);
  if (__DEV__) {
    console.log(
      `[entity] painel ${slice.panel.excerpts.length} de ${slice.totalItems} trechos em ${
        Date.now() - t0
      }ms (banco ${tQueries}ms)`,
    );
  }
  return result;
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
