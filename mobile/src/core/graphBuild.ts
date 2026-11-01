/**
 * Monta o grafo do mapa a partir do banco local.
 *
 * Regras iguais as do servidor (`internal/store/graph.go`):
 * - o centro e o dono; cada entidade aparece uma vez;
 * - a aresta do centro pesa o numero de notas que mencionam a entidade;
 * - duas entidades que dividem uma nota ganham uma aresta de co-ocorrencia, e
 *   cada entidade guarda no maximo `edgesPerNode` parceiros (sem isso um tema
 *   central conecta com tudo e esconde o resto);
 * - o foco abre uma entidade com as notas dela como evidencia.
 *
 * Nada aqui limita o tamanho do mapa: o desenho e que decide o que cabe na tela.
 */

import type {
  EntityKind,
  GraphData,
  GraphEdge,
  GraphEntry,
  GraphEntity,
  GraphNode,
  GraphOptions,
  EntityLink,
} from './graphModel';
import { isEntityKind, nodeId, splitNodeId, userNode } from './graphModel';

const DEFAULT_EDGES_PER_NODE = 16;
/** Quantas bolas o dono toca diretamente; o resto chega pela teia. */
const HUB_MIN = 8;
const HUB_MAX = 14;
const DEFAULT_NODE_LIMIT = 250;
const DEFAULT_NOTE_LIMIT = 100;

export interface GraphSource {
  entries: GraphEntry[];
  entities: GraphEntity[];
  links: EntityLink[];
  centerLabel: string;
}

interface Aggregate {
  node: GraphNode;
  sentimentSum: number;
  sentimentCount: number;
  lastSeen: string;
}

/** Quantas bolas o dono toca diretamente, cresce devagar com o mapa. */
function hubCount(total: number): number {
  return Math.min(HUB_MAX, Math.max(HUB_MIN, Math.round(Math.sqrt(total) * 2)));
}

/** Notas visiveis pelo filtro de tipo (o mapa inteiro e as de todos os tipos). */
function allowedKinds(options: GraphOptions): ReadonlySet<EntityKind> {
  return options.kinds ?? new Set<EntityKind>(['person', 'place', 'theme', 'decision']);
}

export function buildGraph(source: GraphSource, options: GraphOptions = {}): GraphData {
  const kinds = allowedKinds(options);
  const entries = new Map(source.entries.map((entry) => [entry.id, entry]));
  const entities = new Map(source.entities.map((entity) => [entity.id, entity]));

  const links = source.links.filter((link) => {
    const entity = entities.get(link.entityId);
    return Boolean(entity) && entries.has(link.entryId) && kinds.has(entity!.kind);
  });

  if (options.focus) {
    return buildFocusGraph(source, links, entries, entities, options);
  }

  const aggregates = new Map<string, Aggregate>();
  for (const link of links) {
    const entity = entities.get(link.entityId);
    if (!entity) continue;
    const entry = entries.get(link.entryId);
    let agg = aggregates.get(entity.id);
    if (!agg) {
      agg = {
        node: {
          id: nodeId(entity.kind, entity.id),
          kind: entity.kind,
          label: entity.name,
          icon: entity.icon || undefined,
          mentions: 0,
          notes: 0,
          sentiment: undefined,
          lastSeen: undefined,
        },
        sentimentSum: 0,
        sentimentCount: 0,
        lastSeen: '',
      };
      aggregates.set(entity.id, agg);
    }
    agg.node.mentions += Math.max(1, link.count);
    agg.node.notes += 1;
    if (typeof link.sentiment === 'number') {
      agg.sentimentSum += link.sentiment;
      agg.sentimentCount += 1;
    }
    const seen = entry?.recordedAt ?? '';
    if (seen > agg.lastSeen) agg.lastSeen = seen;
  }

  const nodes = [...aggregates.values()]
    .map((agg) => {
      const node = agg.node;
      if (agg.sentimentCount > 0) {
        node.sentiment = agg.sentimentSum / agg.sentimentCount;
      }
      if (agg.lastSeen) node.lastSeen = agg.lastSeen;
      return node;
    })
    .sort((a, b) => b.mentions - a.mentions || a.label.localeCompare(b.label));

  const totalNodes = nodes.length;
  const limit = options.nodeLimit ?? DEFAULT_NODE_LIMIT;
  const kept = limit > 0 ? nodes.slice(0, limit) : nodes;
  const keptEntityIds = new Set(
    kept.map((node) => node.id.slice(node.id.indexOf(':') + 1)),
  );

  const cooccurrence = cooccurrenceEdges(
    links,
    aggregates,
    kinds,
    options.edgesPerNode,
    keptEntityIds,
  );

  // O dono puxa so os hubs (as mais mencionadas); as outras chegam pela teia
  // de co-ocorrencia. Sem isso o centro vira um sol e o mapa, um leque de
  // raios em vez de teia. Bola que ficaria sem nenhuma ligacao ainda ganha a
  // aresta direta, para nada flutuar solto.
  const hubs = new Set(
    kept.slice(0, hubCount(kept.length)).map((node) => node.id),
  );
  const linked = new Set<string>();
  for (const edge of cooccurrence) {
    linked.add(edge.source);
    linked.add(edge.target);
  }
  const edges: GraphEdge[] = [];
  for (const node of kept) {
    if (!hubs.has(node.id) && linked.has(node.id)) continue;
    edges.push({
      source: 'user',
      target: node.id,
      kind: 'relation',
      weight: node.notes,
    });
  }
  edges.push(...cooccurrence);

  return {
    center: userNode(source.centerLabel),
    nodes: kept,
    edges,
    totalNodes,
    totalEdges: edges.length,
  };
}

/**
 * Arestas entidade-entidade: quantas notas duas entidades dividem. Ordena pelas
 * mais fortes e corta por entidade, como o servidor.
 */
function cooccurrenceEdges(
  links: EntityLink[],
  aggregates: Map<string, Aggregate>,
  kinds: ReadonlySet<EntityKind>,
  edgesPerNode = DEFAULT_EDGES_PER_NODE,
  keptEntityIds?: ReadonlySet<string>,
): GraphEdge[] {
  const byEntry = new Map<string, Set<string>>();
  for (const link of links) {
    if (keptEntityIds && !keptEntityIds.has(link.entityId)) continue;
    let ids = byEntry.get(link.entryId);
    if (!ids) {
      ids = new Set();
      byEntry.set(link.entryId, ids);
    }
    ids.add(link.entityId);
  }

  const shared = new Map<string, number>();
  for (const ids of byEntry.values()) {
    const list = [...ids].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]}\u0000${list[j]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }

  const pairs = [...shared.entries()]
    .map(([key, weight]) => {
      const [a, b] = key.split('\u0000');
      return { a, b, weight };
    })
    .sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  const perNode = new Map<string, number>();
  const edges: GraphEdge[] = [];
  for (const pair of pairs) {
    const left = aggregates.get(pair.a);
    const right = aggregates.get(pair.b);
    if (!left || !right) continue;
    if (!isEntityKind(left.node.kind) || !kinds.has(left.node.kind)) continue;
    if (!isEntityKind(right.node.kind) || !kinds.has(right.node.kind)) continue;
    if (keptEntityIds && (!keptEntityIds.has(pair.a) || !keptEntityIds.has(pair.b))) continue;
    if ((perNode.get(pair.a) ?? 0) >= edgesPerNode) continue;
    if ((perNode.get(pair.b) ?? 0) >= edgesPerNode) continue;
    perNode.set(pair.a, (perNode.get(pair.a) ?? 0) + 1);
    perNode.set(pair.b, (perNode.get(pair.b) ?? 0) + 1);
    edges.push({
      source: left.node.id,
      target: right.node.id,
      kind: 'cooccurrence',
      weight: pair.weight,
    });
  }
  return edges;
}

/**
 * Foco: a entidade, as notas dela e as entidades dessas notas. O centro liga so
 * na entidade focada; as notas sao evidencia, nao um segundo centro.
 */
function buildFocusGraph(
  source: GraphSource,
  links: EntityLink[],
  entries: Map<string, GraphEntry>,
  entities: Map<string, GraphEntity>,
  options: GraphOptions,
): GraphData {
  const parsed = splitNodeId(options.focus ?? '');
  const center = userNode(source.centerLabel);
  const empty: GraphData = { center, nodes: [], edges: [], totalNodes: 0, totalEdges: 0 };
  if (!parsed || !isEntityKind(parsed.kind)) return empty;
  const focusEntity = entities.get(parsed.id);
  if (!focusEntity) return empty;

  const noteLimit = options.noteLimit ?? DEFAULT_NOTE_LIMIT;
  const entryIds = new Set<string>();
  for (const link of links) {
    if (link.entityId === focusEntity.id) entryIds.add(link.entryId);
  }
  const focusEntries = [...entryIds]
    .map((id) => entries.get(id)!)
    .filter(Boolean)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
    .slice(0, noteLimit);
  const visibleEntries = new Set(focusEntries.map((entry) => entry.id));

  const focusNode: GraphNode = {
    id: nodeId(focusEntity.kind, focusEntity.id),
    kind: focusEntity.kind,
    label: focusEntity.name,
    icon: focusEntity.icon || undefined,
    mentions: 0,
    notes: focusEntries.length,
  };
  for (const link of links) {
    if (link.entityId === focusEntity.id && visibleEntries.has(link.entryId)) {
      focusNode.mentions += Math.max(1, link.count);
    }
  }

  const aggregates = new Map<string, Aggregate>();
  for (const link of links) {
    if (!visibleEntries.has(link.entryId)) continue;
    if (link.entityId === focusEntity.id) continue;
    const entity = entities.get(link.entityId);
    if (!entity) continue;
    let agg = aggregates.get(entity.id);
    if (!agg) {
      agg = {
        node: {
          id: nodeId(entity.kind, entity.id),
          kind: entity.kind,
          label: entity.name,
          icon: entity.icon || undefined,
          mentions: 0,
          notes: 0,
        },
        sentimentSum: 0,
        sentimentCount: 0,
        lastSeen: '',
      };
      aggregates.set(entity.id, agg);
    }
    agg.node.mentions += Math.max(1, link.count);
    agg.node.notes += 1;
    if (typeof link.sentiment === 'number') {
      agg.sentimentSum += link.sentiment;
      agg.sentimentCount += 1;
    }
    const seen = entries.get(link.entryId)?.recordedAt ?? '';
    if (seen > agg.lastSeen) agg.lastSeen = seen;
  }

  const neighbors = [...aggregates.values()]
    .map((agg) => {
      if (agg.sentimentCount > 0) agg.node.sentiment = agg.sentimentSum / agg.sentimentCount;
      if (agg.lastSeen) agg.node.lastSeen = agg.lastSeen;
      return agg.node;
    })
    .sort((a, b) => b.mentions - a.mentions || a.label.localeCompare(b.label));

  const noteNodes: GraphNode[] = focusEntries.map((entry) => ({
    id: nodeId('note', entry.id),
    kind: 'note',
    label: entry.title,
    mentions: 0,
    notes: 1,
    date: entry.recordedAt,
    author: entry.author,
  }));

  const nodes = [focusNode, ...neighbors, ...noteNodes];
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [
    { source: 'user', target: focusNode.id, kind: 'relation', weight: focusNode.notes },
  ];
  for (const link of links) {
    if (!visibleEntries.has(link.entryId)) continue;
    const entity = entities.get(link.entityId);
    if (!entity) continue;
    const target = nodeId(entity.kind, entity.id);
    if (!visibleNodeIds.has(target)) continue;
    edges.push({
      source: nodeId('note', link.entryId),
      target,
      kind: 'mention',
      weight: Math.max(1, link.count),
    });
  }

  return {
    center,
    nodes,
    edges,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };
}

/** Notas analisadas e notas totais; o vazio do mapa precisa de contexto. */
export function analyzedCount(entries: GraphEntry[]): { analyzed: number; total: number } {
  let analyzed = 0;
  for (const entry of entries) {
    if (entry.hasAnalysis ?? Boolean(entry.analysis)) analyzed += 1;
  }
  return { analyzed, total: entries.length };
}
