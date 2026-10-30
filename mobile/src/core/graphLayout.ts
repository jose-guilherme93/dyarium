/**
 * Posicoes do mapa.
 *
 * Uma unica relaxacao de forcas, a mesma do dashboard: repulsao entre as bolas,
 * mola pelas ligacoes e ancora fraca no dono. As bolas crescem com as mencoes,
 * entao as perifericas ficam pequenas e o centro domina -- o desenho tem a
 * mesma cara do mapa do web.
 *
 * O layout e deterministico: o mesmo conjunto cai sempre nas mesmas posicoes,
 * entao o resultado pode ser guardado no SQLite.
 */

import type { GraphData, GraphEdgeKind, GraphNode, GraphNodeKind } from './graphModel';

export interface NodePosition {
  x: number;
  y: number;
  r: number;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GraphLayout {
  positions: Record<string, NodePosition>;
  bounds: GraphBounds;
  /** Chave do conjunto desenhado; muda quando as posicoes precisam ser refeitas. */
  key: string;
}

/** Angulo dourado: distribui as sementes sem alinhar tudo num raio. */
const GOLDEN_ANGLE = 2.399963;
/**
 * O layout e calculado em espaco circular e so as posicoes sao esticadas no
 * eixo X para preencher a largura sem virar elipse.
 */
const LAYOUT_STRETCH_X = 1.35;

/** Raio de uma bola de entidade, relativo ao maior da visao (igual ao web). */
export function relativeRadius(mentions: number, maxMentions: number): number {
  const max = Math.max(1, maxMentions);
  const ratio = Math.max(0, Math.min(1, mentions / max));
  return 6 + 20 * Math.sqrt(ratio);
}

/** Hash estavel (FNV-1a) para chaves e testes. */
export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Chave do conjunto: ids + mencoes + foco. Qualquer mudanca refaz o layout. */
export function layoutKey(data: GraphData, focus?: string): string {
  const parts = data.nodes.map((node) => `${node.id}:${node.mentions}:${node.notes}`);
  parts.sort();
  return `v9|${focus ?? ''}|${parts.join(',')}`;
}

function nodeRadius(node: GraphNode, maxMentions: number): number {
  if (node.kind === 'note') return 7;
  return relativeRadius(node.mentions, maxMentions);
}

interface SimNode extends NodePosition {
  id: string;
  kind: GraphNodeKind;
  vx: number;
  vy: number;
  fixed: boolean;
}

/** Sementes deterministicas: espiral de angulo dourado a partir do centro. */
function seedNodes(data: GraphData, focus?: string): SimNode[] {
  let maxMentions = 1;
  for (const node of data.nodes) {
    if (node.kind !== 'note' && node.mentions > maxMentions) maxMentions = node.mentions;
  }
  const centerRadius = Math.max(36, relativeRadius(maxMentions, maxMentions) * 1.35);
  const nodes: SimNode[] = [
    {
      id: data.center.id,
      kind: 'user',
      x: 0,
      y: 0,
      r: centerRadius,
      vx: 0,
      vy: 0,
      fixed: true,
    },
  ];

  let entityIndex = 0;
  let noteIndex = 0;
  for (const node of data.nodes) {
    let x = 0;
    let y = 0;
    if (focus && node.id === focus) {
      x = 0;
      y = -90;
    } else if (node.kind === 'note') {
      const angle = noteIndex * GOLDEN_ANGLE;
      noteIndex += 1;
      x = Math.cos(angle) * 260;
      y = Math.sin(angle) * 260;
    } else {
      const angle = entityIndex * GOLDEN_ANGLE;
      entityIndex += 1;
      const spread = 150 + 18 * Math.sqrt(entityIndex);
      x = Math.cos(angle) * spread;
      y = Math.sin(angle) * spread;
    }
    nodes.push({
      id: node.id,
      kind: node.kind,
      x,
      y,
      r: nodeRadius(node, maxMentions),
      vx: 0,
      vy: 0,
      fixed: false,
    });
  }
  return nodes;
}

interface SimLink {
  a: number;
  b: number;
  kind: GraphEdgeKind;
}

/** Uma passada de fisica, identica ao web: repulsao, mola e ancora. */
function relax(nodes: SimNode[], links: SimLink[]): void {
  // Menos passos em grafos grandes: o resultado ainda assenta, e a abertura
  // deixa de pagar centenas de milhares de pares. O layout fica em cache.
  const steps = nodes.length > 90 ? 110 : nodes.length > 50 ? 170 : 220;
  // Repulsao por vizinhanca: a forca cai com o quadrado da distancia, entao
  // so os pares proximos importam. Uma grade uniforme troca o custo O(n^2) por
  // O(n), e o mapa abre em milissegundos mesmo com centenas de bolas.
  const cell = 160;
  const grid = new Map<string, number[]>();
  for (let step = 0; step < steps; step += 1) {
    grid.clear();
    for (let i = 0; i < nodes.length; i += 1) {
      const key = `${Math.floor(nodes[i].x / cell)}:${Math.floor(nodes[i].y / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
        for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
          const bucket = grid.get(`${gx}:${gy}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = nodes[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              // Empurrao deterministico quando duas bolas coincidem (o web usa
              // Math.random; aqui o hash mantem o resultado reproduzivel).
              const seed = stableHash(`${a.id}|${b.id}`);
              dx = ((seed & 0xff) / 0xff) - 0.5;
              dy = (((seed >>> 8) & 0xff) / 0xff) - 0.5;
              d2 = 1;
            }
            const strength = a.kind === 'user' || b.kind === 'user' ? 4200 : 2400;
            const force = strength / Math.max(d2, 2500);
            const inv = 1 / Math.sqrt(d2);
            const fx = dx * inv * force;
            const fy = dy * inv * force;
            if (!a.fixed) {
              a.vx += fx;
              a.vy += fy;
            }
            if (!b.fixed) {
              b.vx -= fx;
              b.vy -= fy;
            }
          }
        }
      }
    }

    for (const link of links) {
      const a = nodes[link.a];
      const b = nodes[link.b];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      // Folga entre bolas como no dashboard: as pequenas nao colam no centro e
      // a nuvem abre espaco para os rotulos.
      const target =
        a.r +
        b.r +
        (link.kind === 'mention' ? 104 : link.kind === 'cooccurrence' ? 66 : 48);
      const force = (dist - target) * (link.kind === 'cooccurrence' ? 0.005 : 0.009);
      const ux = dx / dist;
      const uy = dy / dist;
      if (!a.fixed) {
        a.vx += ux * force;
        a.vy += uy * force;
      }
      if (!b.fixed) {
        b.vx -= ux * force;
        b.vy -= uy * force;
      }
    }

    for (const node of nodes) {
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx += -node.x * 0.0008;
      node.vy += -node.y * 0.0008;
      node.vx *= 0.87;
      node.vy *= 0.87;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 24) {
        node.vx *= 24 / speed;
        node.vy *= 24 / speed;
      }
      node.x += node.vx;
      node.y += node.vy;
    }
  }
}

function forcePositions(data: GraphData, focus?: string): Record<string, NodePosition> {
  const nodes = seedNodes(data, focus);
  const index = new Map(nodes.map((node, position) => [node.id, position]));
  const links: SimLink[] = [];
  for (const edge of data.edges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a === undefined || b === undefined) continue;
    links.push({ a, b, kind: edge.kind });
  }
  relax(nodes, links);
  const positions: Record<string, NodePosition> = {};
  for (const node of nodes) {
    positions[node.id] = { x: node.x * LAYOUT_STRETCH_X, y: node.y, r: node.r };
  }
  return positions;
}

export function layoutGraph(data: GraphData, options: { focus?: string } = {}): GraphLayout {
  const positions = forcePositions(data, options.focus);
  return { positions, bounds: boundsOf(positions), key: layoutKey(data, options.focus) };
}

function boundsOf(positions: Record<string, NodePosition>): GraphBounds {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const position of Object.values(positions)) {
    minX = Math.min(minX, position.x - position.r);
    minY = Math.min(minY, position.y - position.r);
    maxX = Math.max(maxX, position.x + position.r);
    maxY = Math.max(maxY, position.y + position.r);
  }
  return { minX, minY, maxX, maxY };
}

export interface FittedCamera {
  zoom: number;
  /** Deslocamento em relacao ao centro da faixa (zero no encaixe). */
  panX: number;
  panY: number;
  /** Centro do desenho em coordenadas do grafo. */
  originX: number;
  originY: number;
}

/**
 * Encaixa o desenho inteiro na faixa visivel. O desenho e o retangulo das
 * bolas: nada fica fora da tela, e o que e periferico aparece pequeno.
 */
export function fitCamera(
  bounds: GraphBounds,
  width: number,
  height: number,
  options: {
    padding?: number;
    minZoom?: number;
    maxZoom?: number;
    /** `cover` preenche a tela (transborda); `contain` mostra tudo. */
    mode?: 'contain' | 'cover';
  } = {},
): FittedCamera {
  const padding = options.padding ?? 24;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const fitX = (width - padding * 2) / spanX;
  const fitY = (height - padding * 2) / spanY;
  const rawZoom = options.mode === 'cover' ? Math.max(fitX, fitY) : Math.min(fitX, fitY);
  return {
    zoom: clamp(rawZoom, options.minZoom ?? 0.05, options.maxZoom ?? 1.6),
    panX: 0,
    panY: 0,
    originX: (bounds.minX + bounds.maxX) / 2,
    originY: (bounds.minY + bounds.maxY) / 2,
  };
}

export interface VisibleBand {
  top: number;
  bottom: number;
  /** Centro vertical da faixa: e onde o mapa se encaixa. */
  centerY: number;
  height: number;
}

/**
 * Faixa da tela onde o mapa aparece: do topo do conteudo ate a borda da folha.
 * `viewportBottom` e a posicao do topo da folha; zero ou invalido cai para a
 * tela inteira.
 */
export function visibleBand(
  height: number,
  viewportTop = 0,
  viewportBottom = 0,
): VisibleBand {
  const top = viewportTop > 0 ? viewportTop : 0;
  const bottom = viewportBottom > top ? viewportBottom : height;
  return {
    top,
    bottom,
    centerY: (top + bottom) / 2,
    height: Math.max(140, bottom - top),
  };
}

/**
 * Limites de pan, em dp de tela. O desenho nunca sai da area disponivel: se ele
 * cabe, nao arrasta; se esta ampliado, arrasta so ate a propria borda.
 */
export function panLimits(
  bounds: GraphBounds,
  zoom: number,
  width: number,
  height: number,
): { limitX: number; limitY: number } {
  const spanX = Math.max(1, bounds.maxX - bounds.minX) * zoom;
  const spanY = Math.max(1, bounds.maxY - bounds.minY) * zoom;
  return {
    limitX: Math.max(0, (spanX - width) / 2),
    limitY: Math.max(0, (spanY - height) / 2),
  };
}

export interface CameraState {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Zoom mantendo parado o ponto entre os dedos. Devolve a camera nova.
 */
export function zoomAround(
  start: CameraState,
  nextZoom: number,
  focalX: number,
  focalY: number,
  width: number,
  centerY: number,
): CameraState {
  const ratio = nextZoom / start.zoom;
  const localX = focalX - width / 2;
  const localY = focalY - centerY;
  return {
    zoom: nextZoom,
    panX: localX - (localX - start.panX) * ratio,
    panY: localY - (localY - start.panY) * ratio,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
