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
  /** Tamanho de um ponto de tela em unidades do grafo (1 / zoom). */
  scale: number;
  /** Raio minimo (unidades do grafo) para a bola ganhar nome. */
  minBall?: number;
  /** Area visivel agora, em unidades do grafo. */
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
const CELL_SCREEN = 28;
const MARGIN_SCREEN = 8;
const MAX_LABELS = 40;
/** Bola menor que um quarto da altura do texto fica sem nome: e poeira. */
const MIN_BALL_FONT = 0.25;
/** Raio minimo padrao, em pontos de tela. */
const MIN_BALL_SCREEN = 4;

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
  // Quanto mais perto, mais bolas passam do minimo e ganham nome.
  const minBall = Math.max(options.minBall ?? MIN_BALL_SCREEN * scale, fontSize * MIN_BALL_FONT);

  const occupied = new Set<string>();
  const balls: Box[] = [];
  for (const node of [data.center, ...data.nodes]) {
    const position = layout.positions[node.id];
    if (!position) continue;
    // Bola de poeira nao bloqueia rotulo, mas a que esta no limite ainda pode
    // receber o proprio nome.
    if (position.r < minBall / 2 && node.id !== data.center.id) continue;
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
    if (!forced && position.r < minBall) continue;
    // Bola fora da area visivel nao precisa de nome.
    if (view) {
      if (position.x + position.r < view.minX || position.x - position.r > view.maxX) continue;
      if (position.y + position.r < view.minY || position.y - position.r > view.maxY) continue;
    }

    const text = shortLabel(node);
    if (!text) continue;
    const width = text.length * fontSize * 0.56;
    const halfW = width / 2;
    const halfH = lineHeight / 2;
    const cx = position.x;
    const cy = position.y;

    // Abaixo, acima e nos dois lados: o nome ocupa o primeiro vao livre.
    // Abaixo e o lugar de sempre, como no mapa do dashboard.
    const spots: { x: number; y: number; box: Box }[] = [
      {
        x: cx,
        y: cy + position.r + gap + fontSize * 0.8,
        box: {
          x1: cx - halfW,
          y1: cy + position.r + gap,
          x2: cx + halfW,
          y2: cy + position.r + gap + lineHeight,
        },
      },
      {
        x: cx,
        y: cy - position.r - gap - fontSize * 0.2,
        box: {
          x1: cx - halfW,
          y1: cy - position.r - gap - lineHeight,
          x2: cx + halfW,
          y2: cy - position.r - gap,
        },
      },
      {
        x: cx + position.r + gap + halfW,
        y: cy + fontSize * 0.35,
        box: {
          x1: cx + position.r + gap,
          y1: cy - halfH,
          x2: cx + position.r + gap + width,
          y2: cy + halfH,
        },
      },
      {
        x: cx - position.r - gap - halfW,
        y: cy + fontSize * 0.35,
        box: {
          x1: cx - position.r - gap - width,
          y1: cy - halfH,
          x2: cx - position.r - gap,
          y2: cy + halfH,
        },
      },
    ];

    const placed = spots.find((spot) => {
      const box = spot.box;
      // O topo do mapa tem os chips e o pe tem a folha; as laterais cortam o
      // texto. O nome so entra onde aparece inteiro.
      if (
        view &&
        (box.y1 < view.minY + margin ||
          box.y2 > view.maxY - margin ||
          box.x1 < view.minX + margin ||
          box.x2 > view.maxX - margin)
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

    const minCellX = Math.floor(placed.box.x1 / cell);
    const maxCellX = Math.floor(placed.box.x2 / cell);
    const minCellY = Math.floor(placed.box.y1 / cell);
    const maxCellY = Math.floor(placed.box.y2 / cell);
    for (let gx = minCellX; gx <= maxCellX; gx += 1) {
      for (let gy = minCellY; gy <= maxCellY; gy += 1) {
        occupied.add(`${gx}:${gy}`);
      }
    }

    out.push({
      id: node.id,
      text,
      x: placed.x,
      y: placed.y,
      fontSize,
      kind: node.kind,
      selected,
      forced,
    });
  }

  return out;
}
