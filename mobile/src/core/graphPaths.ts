/**
 * Desenho do mapa em poucos elementos.
 *
 * Cada tipo de aresta vira UM caminho e cada tipo de no vira UM caminho com os
 * circulos como subcaminhos. O numero de views nativas nao cresce com o numero
 * de ligacoes: milhares de arestas continuam sendo tres `<Path>`. E o que
 * permite mostrar o mapa inteiro sem montar milhares de views.
 */

import type { GraphData, GraphEdgeKind, GraphNode, GraphNodeKind } from './graphModel';
import type { GraphLayout } from './graphLayout';

const EDGE_KINDS: GraphEdgeKind[] = ['relation', 'cooccurrence', 'mention'];
const NODE_KINDS: GraphNodeKind[] = ['person', 'place', 'theme', 'decision', 'note'];

function round(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/** Circulo perfeito: o diametro sai do MESMO raio arredondado dos arcos. */
function circlePath(x: number, y: number, radius: number): string {
  const r = Math.round(radius * 10) / 10;
  const d = r * 2;
  return `M${round(x - r)},${round(y)}a${r},${r} 0 1,0 ${d},0a${r},${r} 0 1,0 ${-d},0Z`;
}

/** Quantas grossuras o desenho usa para mostrar a proximidade. */
export const EDGE_BANDS = 3;

/** Caminho com todas as arestas de um tipo (ou so as que tocam `allowed`). */
export function edgesPath(
  data: GraphData,
  layout: GraphLayout,
  kind: GraphEdgeKind,
  allowed?: ReadonlySet<string> | null,
  minWeight = 0,
): string {
  const parts: string[] = [];
  for (const edge of data.edges) {
    if (edge.kind !== kind) continue;
    if (edge.weight < minWeight) continue;
    if (allowed && !(allowed.has(edge.source) && allowed.has(edge.target))) continue;
    const from = layout.positions[edge.source];
    const to = layout.positions[edge.target];
    if (!from || !to) continue;
    parts.push(`M${round(from.x)},${round(from.y)}L${round(to.x)},${round(to.y)}`);
  }
  return parts.join('');
}

/**
 * Arestas de um tipo separadas por peso, em faixas de grossura.
 *
 * A cor nao diz nada: a grossura e que mostra a proximidade. Peso 1 cai na
 * faixa fina; a aresta mais forte do tipo, na grossa.
 */
export function edgeBands(
  data: GraphData,
  layout: GraphLayout,
  kind: GraphEdgeKind,
  allowed?: ReadonlySet<string> | null,
): string[] {
  const bands: string[][] = Array.from({ length: EDGE_BANDS }, () => []);
  let max = 1;
  for (const edge of data.edges) {
    if (edge.kind === kind && edge.weight > max) max = edge.weight;
  }
  for (const edge of data.edges) {
    if (edge.kind !== kind) continue;
    if (allowed && !(allowed.has(edge.source) && allowed.has(edge.target))) continue;
    const from = layout.positions[edge.source];
    const to = layout.positions[edge.target];
    if (!from || !to) continue;
    const share = max <= 1 ? 0 : (edge.weight - 1) / (max - 1);
    const band = Math.min(EDGE_BANDS - 1, Math.max(0, Math.floor(share * EDGE_BANDS)));
    bands[band].push(`M${round(from.x)},${round(from.y)}L${round(to.x)},${round(to.y)}`);
  }
  return bands.map((parts) => parts.join(''));
}

/** Caminho com os nos de um tipo (todos ou so os de `allowed`). */
export function nodesPath(
  data: GraphData,
  layout: GraphLayout,
  kind: GraphNodeKind,
  allowed?: ReadonlySet<string> | null,
): string {
  const parts: string[] = [];
  for (const node of data.nodes) {
    if (node.kind !== kind) continue;
    if (allowed && !allowed.has(node.id)) continue;
    const position = layout.positions[node.id];
    if (!position) continue;
    parts.push(circlePath(position.x, position.y, position.r));
  }
  return parts.join('');
}

export function graphPaths(
  data: GraphData,
  layout: GraphLayout,
  allowed?: ReadonlySet<string> | null,
): {
  edges: Record<GraphEdgeKind, string[]>;
  nodes: Record<GraphNodeKind, string>;
} {
  const edges = {} as Record<GraphEdgeKind, string[]>;
  for (const kind of EDGE_KINDS) edges[kind] = edgeBands(data, layout, kind, allowed);
  const nodes = {} as Record<GraphNodeKind, string>;
  for (const kind of NODE_KINDS) nodes[kind] = nodesPath(data, layout, kind, allowed);
  return { edges, nodes };
}

/** Vizinhos diretos de um no, para acender as conexoes da bola escolhida. */
export function neighborIds(data: GraphData, id: string): Set<string> {
  const ids = new Set<string>();
  for (const edge of data.edges) {
    if (edge.source === id) ids.add(edge.target);
    else if (edge.target === id) ids.add(edge.source);
  }
  ids.delete(id);
  return ids;
}

/** Caminho das arestas que tocam a bola escolhida. */
export function selectedEdgesPath(data: GraphData, layout: GraphLayout, id: string): string {
  const parts: string[] = [];
  for (const edge of data.edges) {
    if (edge.source !== id && edge.target !== id) continue;
    const from = layout.positions[edge.source];
    const to = layout.positions[edge.target];
    if (!from || !to) continue;
    parts.push(`M${round(from.x)},${round(from.y)}L${round(to.x)},${round(to.y)}`);
  }
  return parts.join('');
}

/** Caminho das bolas vizinhas, desenhadas por cima do mapa esmaecido. */
export function selectedNodesPath(
  data: GraphData,
  layout: GraphLayout,
  ids: ReadonlySet<string>,
): string {
  const parts: string[] = [];
  for (const node of data.nodes) {
    if (!ids.has(node.id)) continue;
    const position = layout.positions[node.id];
    if (!position) continue;
    parts.push(circlePath(position.x, position.y, position.r));
  }
  return parts.join('');
}

export function findNode(data: GraphData, id: string | null): GraphNode | null {
  if (!id) return null;
  return data.nodes.find((node) => node.id === id) ?? null;
}
