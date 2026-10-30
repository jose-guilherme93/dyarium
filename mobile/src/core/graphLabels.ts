/**
 * Rotulos do mapa.
 *
 * Eles fazem parte do desenho: posicao e tamanho em unidades do grafo, como as
 * bolas. O zoom nao recalcula nada, so amplia a mesma imagem. A escolha de
 * quem ganha nome acontece uma vez por conjunto, com colisao em espaco de
 * grafo: o que nao encosta no encaixe tambem nao encosta em zoom nenhum.
 */

import type { GraphData, GraphNode } from './graphModel';
import type { GraphLayout } from './graphLayout';

export interface LabelOptions {
  /** Tamanho de um ponto de tela em unidades do grafo (1 / zoom do encaixe). */
  scale: number;
  /** Area visivel no encaixe, em unidades do grafo. */
  view?: { minX: number; minY: number; maxX: number; maxY: number };
  selectedId?: string | null;
  budget?: number;
}

export interface GraphLabel {
  id: string;
  text: string;
  /** Posicao em coordenadas do grafo. */
  x: number;
  y: number;
  /** Tamanho em unidades do grafo: acompanha o zoom junto com a bola. */
  fontSize: number;
  kind: GraphNode['kind'];
  selected: boolean;
  /** Rotulo que nao cede espaco: o dono, a bola escolhida e as principais. */
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
const LINE_HEIGHT_SCREEN = 13;
const GAP_SCREEN = 7;
const CELL_SCREEN = 48;
const MARGIN_SCREEN = 8;
const MAX_LABELS = 40;
/** Bola menor que um quarto da altura do texto fica sem nome: e poeira. */
const MIN_BALL_FONT = 0.25;

function shortLabel(node: GraphNode): string {
  const text = node.label.trim();
  if (text.length <= 26) return text;
  return `${text.slice(0, 25)}…`;
}

export function pickLabels(
  data: GraphData,
  layout: GraphLayout,
  options: LabelOptions,
): GraphLabel[] {
  const scale = options.scale > 0 ? options.scale : 1;
  const fontSize = FONT_SCREEN * scale;
  const lineHeight = LINE_HEIGHT_SCREEN * scale;
  const gap = GAP_SCREEN * scale;
  const cell = CELL_SCREEN * scale;
  const budget = options.budget ?? MAX_LABELS;
  const selectedId = options.selectedId ?? null;
  const margin = MARGIN_SCREEN * scale;
  const view = options.view;

  const occupied = new Set<string>();
  const balls: Box[] = [];
  for (const node of [data.center, ...data.nodes]) {
    const position = layout.positions[node.id];
    if (!position) continue;
    // Bola pequena demais nao bloqueia rotulo: e poeira, nao referencia.
    if (position.r < fontSize * MIN_BALL_FONT && node.id !== data.center.id) continue;
    balls.push({
      x1: position.x - position.r,
      y1: position.y - position.r,
      x2: position.x + position.r,
      y2: position.y + position.r,
    });
  }

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

  const out: GraphLabel[] = [];
  for (const node of ordered) {
    if (out.length >= budget) break;
    const position = layout.positions[node.id];
    if (!position) continue;
    const selected = node.id === selectedId;
    const forced = selected || pinned.has(node.id);
    if (!forced && position.r < fontSize * MIN_BALL_FONT) continue;

    const text = shortLabel(node);
    if (!text) continue;
    const width = text.length * fontSize * 0.56;
    const cx = position.x;

    // Abaixo da bola, como no mapa do dashboard; sem espaco, tenta acima.
    const placed = ([1, -1] as const)
      .map((dir) => {
        const top =
          dir > 0
            ? position.y + position.r + gap
            : position.y - position.r - gap - lineHeight;
        return { dir, top, left: cx - width / 2 };
      })
      .find((spot) => {
        const box: Box = {
          x1: spot.left,
          y1: spot.top,
          x2: spot.left + width,
          y2: spot.top + lineHeight,
        };
        // Fora da area visivel no encaixe o nome ficaria atras da folha.
        if (
          view &&
          (box.x1 < view.minX + margin ||
            box.x2 > view.maxX - margin ||
            box.y1 < view.minY + margin ||
            box.y2 > view.maxY - margin)
        ) {
          return false;
        }
        if (forced) return true;
        if (balls.some((ball) => overlaps(ball, box))) return false;
        const minCellX = Math.floor(box.x1 / cell);
        const maxCellX = Math.floor(box.x2 / cell);
        const minCellY = Math.floor(box.y1 / cell);
        const maxCellY = Math.floor(box.y2 / cell);
        for (let gx = minCellX; gx <= maxCellX; gx += 1) {
          for (let gy = minCellY; gy <= maxCellY; gy += 1) {
            if (occupied.has(`${gx}:${gy}`)) return false;
          }
        }
        return true;
      });
    if (!placed) continue;

    const minCellX = Math.floor(placed.left / cell);
    const maxCellX = Math.floor((placed.left + width) / cell);
    const minCellY = Math.floor(placed.top / cell);
    const maxCellY = Math.floor((placed.top + lineHeight) / cell);
    for (let gx = minCellX; gx <= maxCellX; gx += 1) {
      for (let gy = minCellY; gy <= maxCellY; gy += 1) {
        occupied.add(`${gx}:${gy}`);
      }
    }

    out.push({
      id: node.id,
      text,
      x: position.x,
      y:
        placed.dir > 0
          ? position.y + position.r + gap + fontSize * 0.8
          : position.y - position.r - gap - fontSize * 0.2,
      fontSize,
      kind: node.kind,
      selected,
      forced,
    });
  }

  return out;
}
