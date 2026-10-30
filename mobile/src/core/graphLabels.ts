/**
 * Rotulos do mapa: recompensa do zoom.
 *
 * O desenho e um so, mas o texto e caro: no encaixe aparecem os mais
 * mencionados, e aproximar revela mais bolas. A escolha acontece no fim do
 * gesto, nunca por frame, e usa uma grade de colisao em coordenadas de tela.
 */

import type { GraphData, GraphNode } from './graphModel';
import type { GraphLayout } from './graphLayout';

export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
  /** Centro do desenho em coordenadas do grafo (padrao: a origem). */
  originX?: number;
  originY?: number;
  /** Centro vertical da faixa visivel (padrao: o meio da tela). */
  centerY?: number;
  /** Limites verticais da faixa visivel (padrao: a tela inteira). */
  bandTop?: number;
  bandBottom?: number;
}

export interface GraphLabel {
  id: string;
  text: string;
  /** Posicao em coordenadas do grafo. */
  x: number;
  y: number;
  /** Tamanho em unidades do grafo, para ficar ~11pt na tela. */
  fontSize: number;
  kind: GraphNode['kind'];
  selected: boolean;
  /** Rotulo que nao cede espaco: o dono e a bola escolhida. */
  forced: boolean;
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

const FONT_SCREEN = 10;
const LINE_HEIGHT = 13;
const CELL = 48;
const MARGIN = 8;

/** Quantos rotulos cada faixa de zoom comporta. */
export function labelBudget(zoom: number): number {
  if (zoom < 0.5) return 14;
  if (zoom < 1) return 20;
  if (zoom < 1.8) return 28;
  if (zoom < 2.4) return 36;
  return 48;
}

function shortLabel(node: GraphNode): string {
  const text = node.label.trim();
  if (text.length <= 26) return text;
  return `${text.slice(0, 25)}…`;
}

export function pickLabels(
  data: GraphData,
  layout: GraphLayout,
  camera: Camera,
  selectedId: string | null,
  budget = labelBudget(camera.zoom),
): GraphLabel[] {
  const occupied = new Set<string>();
  // Bolas em coordenadas de tela: um rotulo nunca cai em cima de uma delas.
  const balls: Box[] = [];
  const out: GraphLabel[] = [];

  const originX = camera.originX ?? 0;
  const originY = camera.originY ?? 0;
  const centerY = camera.centerY ?? camera.height / 2;
  const bandTop = camera.bandTop ?? 0;
  const bandBottom = camera.bandBottom ?? camera.height;

  const toScreenX = (x: number) =>
    camera.width / 2 + camera.panX + (x - originX) * camera.zoom;
  const toScreenY = (y: number) => centerY + camera.panY + (y - originY) * camera.zoom;

  const addBall = (id: string) => {
    const position = layout.positions[id];
    if (!position) return;
    const sr = position.r * camera.zoom;
    // Bola pequena demais nao bloqueia rotulo: e poeira, nao referencia.
    if (sr < 4) return;
    const sx = toScreenX(position.x);
    const sy = toScreenY(position.y);
    balls.push({ x1: sx - sr, y1: sy - sr, x2: sx + sr, y2: sy + sr });
  };
  addBall(data.center.id);
  for (const node of data.nodes) addBall(node.id);

  // O dono e sempre o primeiro rotulo: o centro do mapa precisa de nome mesmo
  // quando as bolas ao redor disputam espaco.
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

  // As bolas principais ganham nome sempre: sao a leitura do mapa.
  const pinned = new Set(ordered.slice(0, 4).map((node) => node.id));

  for (const node of ordered) {
    if (out.length >= budget) break;
    const position = layout.positions[node.id];
    if (!position) continue;
    const screenRadius = position.r * camera.zoom;
    const selected = node.id === selectedId;
    const forced = selected || pinned.has(node.id);
    if (!forced && screenRadius < 2.5) continue;

    const text = shortLabel(node);
    if (!text) continue;
    const width = text.length * FONT_SCREEN * 0.56;
    const height = LINE_HEIGHT;
    const cx = toScreenX(position.x);
    const cy = toScreenY(position.y);
    // Abaixo da bola, como no mapa do dashboard; sem espaco, tenta acima.
    const placed = ([1, -1] as const)
      .map((dir) => {
        const top = dir > 0 ? cy + screenRadius + 7 : cy - screenRadius - 7 - height;
        const left = cx - width / 2;
        const inside =
          left >= MARGIN &&
          top >= bandTop + MARGIN &&
          left + width <= camera.width - MARGIN &&
          top + height <= bandBottom - MARGIN;
        return { dir, top, left, inside };
      })
      .find((spot) => {
        if (!spot.inside) return false;
        if (forced) return true;
        const box: Box = {
          x1: spot.left,
          y1: spot.top,
          x2: spot.left + width,
          y2: spot.top + height,
        };
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
    if (!placed) continue;

    const minCellX = Math.floor(placed.left / CELL);
    const maxCellX = Math.floor((placed.left + width) / CELL);
    const minCellY = Math.floor(placed.top / CELL);
    const maxCellY = Math.floor((placed.top + height) / CELL);
    for (let gx = minCellX; gx <= maxCellX; gx += 1) {
      for (let gy = minCellY; gy <= maxCellY; gy += 1) {
        occupied.add(`${gx}:${gy}`);
      }
    }

    const gap = (7 + FONT_SCREEN * 0.8) / camera.zoom;
    out.push({
      id: node.id,
      text,
      x: position.x,
      // Direcao do encaixe: abaixo ou acima da bola (o `dir` escolhido).
      y:
        placed.dir > 0
          ? position.y + position.r + gap
          : position.y - position.r - (7 + FONT_SCREEN * 0.25) / camera.zoom,
      fontSize: FONT_SCREEN / camera.zoom,
      kind: node.kind,
      selected,
      forced,
    });
  }

  return out;
}
