/**
 * Rotulos do mapa.
 *
 * O nome e texto de tela: tamanho fixo e legivel em qualquer zoom, colado na
 * bola por uma ancora em coordenadas do grafo. Quem decide quais aparecem e
 * uma condicao de espaco -- se o nome cabe entre as bolas, ele entra, e quanto
 * mais perto o mapa estiver, mais nomes cabem.
 *
 * A escolha roda uma vez no fim do gesto, nunca por quadro.
 */

import type { GraphData, GraphNode } from './graphModel';
import type { GraphLayout } from './graphLayout';

/** De que lado da bola o nome fica. */
export type LabelSide = 'below' | 'above' | 'right' | 'left';

export interface LabelCamera {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  /** Centro vertical da faixa visivel. */
  centerY: number;
  bandTop: number;
  bandBottom: number;
  originX: number;
  originY: number;
}

export interface LabelOptions {
  camera: LabelCamera;
  selectedId?: string | null;
  budget?: number;
}

export interface GraphLabel {
  id: string;
  text: string;
  /** Centro da bola, em coordenadas do grafo. */
  x: number;
  y: number;
  /** Raio da bola, em unidades do grafo. */
  r: number;
  side: LabelSide;
  kind: GraphNode['kind'];
  selected: boolean;
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/** Medidas do nome, em pontos de tela. */
export const LABEL_FONT = 10;
export const LABEL_LINE_HEIGHT = 13;
export const LABEL_GAP = 6;
/** Largura media de um caractere nesta fonte, para prever a caixa. */
export const LABEL_CHAR = 0.56;

const MARGIN = 6;
const CELL = 24;
const MAX_LABELS = 40;

export function labelWidth(text: string): number {
  return text.length * LABEL_FONT * LABEL_CHAR;
}

export function shortLabel(node: GraphNode): string {
  const text = node.label.trim();
  if (text.length <= 26) return text;
  return `${text.slice(0, 25)}…`;
}

/** Caixa do nome na tela, para a posicao escolhida. */
function labelBox(
  sx: number,
  sy: number,
  sr: number,
  width: number,
  side: LabelSide,
): Box {
  const half = LABEL_LINE_HEIGHT / 2;
  switch (side) {
    case 'below':
      return {
        x1: sx - width / 2,
        y1: sy + sr + LABEL_GAP,
        x2: sx + width / 2,
        y2: sy + sr + LABEL_GAP + LABEL_LINE_HEIGHT,
      };
    case 'above':
      return {
        x1: sx - width / 2,
        y1: sy - sr - LABEL_GAP - LABEL_LINE_HEIGHT,
        x2: sx + width / 2,
        y2: sy - sr - LABEL_GAP,
      };
    case 'right':
      return {
        x1: sx + sr + LABEL_GAP,
        y1: sy - half,
        x2: sx + sr + LABEL_GAP + width,
        y2: sy + half,
      };
    default:
      return {
        x1: sx - sr - LABEL_GAP - width,
        y1: sy - half,
        x2: sx - sr - LABEL_GAP,
        y2: sy + half,
      };
  }
}

const SIDES: LabelSide[] = ['below', 'above', 'right', 'left'];

export function pickLabels(
  data: GraphData,
  layout: GraphLayout,
  options: LabelOptions,
): GraphLabel[] {
  const { camera } = options;
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const selectedId = options.selectedId ?? null;
  const budget = options.budget ?? MAX_LABELS;

  const toScreenX = (x: number) => camera.width / 2 + camera.panX + (x - camera.originX) * zoom;
  const toScreenY = (y: number) => camera.centerY + camera.panY + (y - camera.originY) * zoom;

  // Bolas e nomes ja desenhados, para nao encostar.
  const balls: Box[] = [];
  for (const node of [data.center, ...data.nodes]) {
    const position = layout.positions[node.id];
    if (!position) continue;
    const sx = toScreenX(position.x);
    const sy = toScreenY(position.y);
    const sr = position.r * zoom;
    balls.push({ x1: sx - sr, y1: sy - sr, x2: sx + sr, y2: sy + sr });
  }

  const occupied = new Set<string>();
  const inside = (box: Box) =>
    box.x1 >= MARGIN &&
    box.x2 <= camera.width - MARGIN &&
    box.y1 >= camera.bandTop + MARGIN &&
    box.y2 <= camera.bandBottom - MARGIN;

  const ordered = [
    data.center,
    ...data.nodes.filter((node) => node.id !== data.center.id),
  ].sort((a, b) => {
    if (a.id === data.center.id) return -1;
    if (b.id === data.center.id) return 1;
    if (a.id === selectedId) return -1;
    if (b.id === selectedId) return 1;
    return b.mentions - a.mentions || a.label.localeCompare(b.label);
  });

  const out: GraphLabel[] = [];
  for (const node of ordered) {
    if (out.length >= budget) break;
    const position = layout.positions[node.id];
    if (!position) continue;
    const text = shortLabel(node);
    if (!text) continue;

    const sx = toScreenX(position.x);
    const sy = toScreenY(position.y);
    const sr = position.r * zoom;
    // Bola fora da faixa nao precisa de nome.
    if (sx + sr < 0 || sx - sr > camera.width) continue;
    if (sy + sr < camera.bandTop || sy - sr > camera.bandBottom) continue;

    const width = labelWidth(text);
    const selected = node.id === selectedId;
    const side = SIDES.find((candidate) => {
      const box = labelBox(sx, sy, sr, width, candidate);
      if (!inside(box)) return false;
      if (selected) return true;
      if (balls.some((ball) => overlaps(ball, box))) return false;
      const minCellX = Math.floor(box.x1 / CELL);
      const maxCellX = Math.floor(box.x2 / CELL);
      const minCellY = Math.floor(box.y1 / CELL);
      const maxCellY = Math.floor(box.y2 / CELL);
      for (let gx = minCellX; gx <= maxCellX; gx += 1) {
        for (let gy = minCellY; gy <= maxCellY; gy += 1) {
          if (occupied.has(`${gx}:${gy}`)) return false;
        }
      }
      return true;
    });
    if (!side) continue;

    const box = labelBox(sx, sy, sr, width, side);
    for (let gx = Math.floor(box.x1 / CELL); gx <= Math.floor(box.x2 / CELL); gx += 1) {
      for (let gy = Math.floor(box.y1 / CELL); gy <= Math.floor(box.y2 / CELL); gy += 1) {
        occupied.add(`${gx}:${gy}`);
      }
    }

    out.push({
      id: node.id,
      text,
      x: position.x,
      y: position.y,
      r: position.r,
      side,
      kind: node.kind,
      selected,
    });
  }

  return out;
}
