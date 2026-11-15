import type { GraphData, GraphEdgeKind } from './graphModel';

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
  key: string;
}

const GOLDEN_ANGLE = 2.3999632297286533;
const CENTER_RADIUS = 24;
const MIN_ENTITY_RADIUS = 4;
const MAX_ENTITY_RADIUS = 10;
const BASE_RADIUS = 40;
const NOTE_RING_RADIUS = 160;
const NOTE_RADIUS = 5;

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function relativeRadius(mentions: number, maxMentions: number): number {
  const max = Math.max(1, maxMentions);
  const ratio = Math.max(0, Math.min(1, mentions / max));
  return MIN_ENTITY_RADIUS + (MAX_ENTITY_RADIUS - MIN_ENTITY_RADIUS) * Math.sqrt(ratio);
}

export function layoutKey(data: GraphData, focus?: string, steps?: number): string {
  const parts = data.nodes.map((node) => `${node.id}:${node.mentions}:${node.notes}`);
  parts.sort();
  const mode = steps === undefined ? 'full' : `seed${steps}`;
  // v3: o raio do dono passou a ser o dobro da segunda maior bola. A chave
  // entra no cache do SQLite, entao subir a versao descarta o layout antigo --
  // sem isso o aparelho continuava desenhando o dono com o raio velho.
  return `spiral:v3:${mode}|${focus ?? ''}|${parts.join(',')}`;
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angle: number): { x: number; y: number } {
  return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle),
  };
}

export function layoutGraph(data: GraphData, options: { focus?: string; seed?: Record<string, NodePosition>; steps?: number } = {}): GraphLayout {
  const { focus } = options;
  const positions: Record<string, NodePosition> = {};

  const center = data.center;

  if (data.nodes.length === 0) {
    positions[center.id] = { x: 0, y: 0, r: CENTER_RADIUS };
    return { positions, bounds: boundsOf(positions), key: layoutKey(data, focus) };
  }

  let maxMentions = 1;
  for (const node of data.nodes) {
    if (node.kind !== 'note' && node.mentions > maxMentions) maxMentions = node.mentions;
  }

  const entities = data.nodes.filter((n) => n.kind !== 'note');
  const notes = data.nodes.filter((n) => n.kind === 'note');

  // A bola do dono e o dobro da segunda maior, nao um disco gigante a parte:
  // ela e so a maior bola do desenho, com a mesma cor e o mesmo traco.
  let secondRadius = NOTE_RADIUS;
  for (const node of entities) {
    const r = relativeRadius(node.mentions, maxMentions);
    if (r > secondRadius) secondRadius = r;
  }
  positions[center.id] = { x: 0, y: 0, r: secondRadius * 2 };

  const sortedEntities = [...entities].sort((a, b) => b.mentions - a.mentions || a.label.localeCompare(b.label));

  for (let i = 0; i < sortedEntities.length; i += 1) {
    const node = sortedEntities[i];
    const angle = i * GOLDEN_ANGLE;
    const radius = BASE_RADIUS + Math.sqrt(i) * 10;
    const r = relativeRadius(node.mentions, maxMentions);

    let finalAngle = angle;
    if (node.id === focus) {
      finalAngle = -Math.PI / 2;
    }

    const pos = polarToCartesian(0, 0, node.id === focus ? BASE_RADIUS : radius, finalAngle);
    positions[node.id] = { x: pos.x, y: pos.y, r };
  }

  if (focus && notes.length > 0) {
    const focusNotes = notes.filter((n) => {
      return data.edges.some((e) => (e.source === focus && e.target === n.id) || (e.target === focus && e.source === n.id));
    });
    for (let i = 0; i < focusNotes.length; i += 1) {
      const node = focusNotes[i];
      const angle = (i / Math.max(1, focusNotes.length)) * 2 * Math.PI - Math.PI / 2;
      const pos = polarToCartesian(0, 0, NOTE_RING_RADIUS, angle);
      positions[node.id] = { x: pos.x, y: pos.y, r: NOTE_RADIUS };
    }
  }

  return { positions, bounds: boundsOf(positions), key: layoutKey(data, focus) };
}

function boundsOf(positions: Record<string, NodePosition>): GraphBounds {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let first = true;
  for (const pos of Object.values(positions)) {
    if (first) {
      minX = pos.x - pos.r;
      minY = pos.y - pos.r;
      maxX = pos.x + pos.r;
      maxY = pos.y + pos.r;
      first = false;
    } else {
      minX = Math.min(minX, pos.x - pos.r);
      minY = Math.min(minY, pos.y - pos.r);
      maxX = Math.max(maxX, pos.x + pos.r);
      maxY = Math.max(maxY, pos.y + pos.r);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Teto do zoom. */
export const MAX_ZOOM = 4.5;

/**
 * Quanto da para afastar alem do encaixe: em 35% dele o mapa vira uma nuvem de
 * pontos, que e o limite util da tela. Sem isso o encaixe era o minimo e a
 * abertura do mapa nunca aparecia.
 */
export const MIN_ZOOM_RATIO = 0.35;

export interface ZoomRange {
  min: number;
  max: number;
}

export function zoomRange(fitZoom: number): ZoomRange {
  const fit = fitZoom > 0 ? fitZoom : 1;
  return { min: fit * MIN_ZOOM_RATIO, max: MAX_ZOOM };
}

export interface FittedCamera {
  zoom: number;
  panX: number;
  panY: number;
  originX: number;
  originY: number;
}

export function fitCamera(
  bounds: GraphBounds,
  width: number,
  height: number,
  options: {
    padding?: number;
    minZoom?: number;
    maxZoom?: number;
    mode?: 'contain' | 'cover';
  } = {},
): FittedCamera {
  const padding = options.padding ?? 8;
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
  centerY: number;
  height: number;
}

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

export interface CameraState {
  zoom: number;
  panX: number;
  panY: number;
}

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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface LayoutOptions {
  focus?: string;
  seed?: Record<string, NodePosition>;
  steps?: number;
}

export function layoutSeeded(
  data: GraphData,
  focus: string,
  _seed: Record<string, NodePosition> | null,
): GraphLayout {
  return layoutGraph(data, { focus });
}

/**
 * Layout da previa de uma entidade: o mesmo espiral do mapa geral.
 *
 * Nada de circulo perfeito: as relacoes ficam em volta da entidade com angulo
 * aureo e raio crescente, entao algumas ficam mais para dentro e outras mais
 * para fora, como no desenho do mapa. A entidade aberta e o centro.
 */
export function layoutRelationPreview(data: GraphData): GraphLayout {
  return layoutGraph(data);
}

export function edgeKindCounts(data: GraphData): Record<GraphEdgeKind, number> {
  const counts: Record<GraphEdgeKind, number> = {
    relation: 0,
    cooccurrence: 0,
    mention: 0,
  };
  for (const edge of data.edges) {
    counts[edge.kind] += 1;
  }
  return counts;
}
