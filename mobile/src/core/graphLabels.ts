import type { GraphData, GraphNode } from './graphModel';
import type { GraphLayout } from './graphLayout';

export type LabelSide = 'below' | 'above' | 'right' | 'left';

export interface LabelCamera {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
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
  x: number;
  y: number;
  r: number;
  side: LabelSide;
  kind: GraphNode['kind'];
  selected: boolean;
}

export const LABEL_FONT = 10;
export const LABEL_LINE_HEIGHT = 13;
export const LABEL_GAP = 6;
const LABEL_CHAR = 0.56;

export function labelWidth(text: string): number {
  'worklet';
  return text.length * LABEL_FONT * LABEL_CHAR;
}

function toScreen(camera: LabelCamera, x: number, y: number): { sx: number; sy: number } {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  return {
    sx: camera.width / 2 + camera.panX + (x - camera.originX) * zoom,
    sy: camera.centerY + camera.panY + (y - camera.originY) * zoom,
  };
}

export function pickLabels(
  data: GraphData,
  layout: GraphLayout,
  options: LabelOptions,
): GraphLabel[] {
  const { camera, selectedId = null, budget = 200 } = options;
  const zoom = camera.zoom > 0 ? camera.zoom : 1;

  // Bolas de todos os nos, para detectar sobreposicao.
  const balls: { x1: number; y1: number; x2: number; y2: number; id: string }[] = [];
  for (const node of [data.center, ...data.nodes]) {
    const position = layout.positions[node.id];
    if (!position) continue;
    const { sx, sy } = toScreen(camera, position.x, position.y);
    const sr = position.r * zoom;
    balls.push({ x1: sx - sr, y1: sy - sr, x2: sx + sr, y2: sy + sr, id: node.id });
  }

  // Ordem: centro, selecionado, entidades por menções, notas
  const ordered = [
    data.center,
    ...data.nodes.filter((n) => n.id !== data.center.id),
  ].sort((a, b) => {
    if (a.id === data.center.id) return -1;
    if (b.id === data.center.id) return 1;
    if (a.id === selectedId) return -1;
    if (b.id === selectedId) return 1;
    if (a.kind === 'note' && b.kind !== 'note') return -1;
    if (b.kind === 'note' && a.kind !== 'note') return 1;
    return b.mentions - a.mentions || a.label.localeCompare(b.label, 'pt-BR');
  });

  const out: GraphLabel[] = [];
  // Nomes ja postos: dois nomes nunca se encostam.
  const taken: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const overlaps = (
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number },
  ) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

  for (const node of ordered) {
    if (out.length >= budget) break;
    const position = layout.positions[node.id];
    if (!position) continue;
    // Nome inteiro ou nada: cortar com reticencias mentia sobre o que a bola e.
    const text = node.label.trim();
    if (!text) continue;

    const { sx, sy } = toScreen(camera, position.x, position.y);
    const sr = position.r * zoom;

    // Bola fora da faixa nao precisa de rotulo
    if (sx + sr < 0 || sx - sr > camera.width) continue;
    if (sy + sr < camera.bandTop || sy - sr > camera.bandBottom) continue;

    const width = labelWidth(text);
    const half = LABEL_LINE_HEIGHT / 2;
    const SIDES: LabelSide[] = ['below', 'above', 'right', 'left'];

    let chosenSide: LabelSide | null = null;
    for (const candidate of SIDES) {
      let b: { x1: number; y1: number; x2: number; y2: number };
      switch (candidate) {
        case 'below':
          b = { x1: sx - width / 2, y1: sy + sr + LABEL_GAP, x2: sx + width / 2, y2: sy + sr + LABEL_GAP + LABEL_LINE_HEIGHT };
          break;
        case 'above':
          b = { x1: sx - width / 2, y1: sy - sr - LABEL_GAP - LABEL_LINE_HEIGHT, x2: sx + width / 2, y2: sy - sr - LABEL_GAP };
          break;
        case 'right':
          b = { x1: sx + sr + LABEL_GAP, y1: sy - half, x2: sx + sr + LABEL_GAP + width, y2: sy + half };
          break;
        default:
          b = { x1: sx - sr - LABEL_GAP - width, y1: sy - half, x2: sx - sr - LABEL_GAP, y2: sy + half };
          break;
      }

      // Cabe inteiro na faixa visivel?
      if (b.x1 < 2 || b.x2 > camera.width - 2) continue;
      if (b.y1 < camera.bandTop + 2 || b.y2 > camera.bandBottom - 2) continue;

      // Nao pode encostar em bola nenhuma nem em outro nome.
      if (balls.some((ball) => overlaps(ball, b))) continue;
      if (taken.some((box) => overlaps(box, b))) continue;

      chosenSide = candidate;
      taken.push(b);
      break;
    }

    if (!chosenSide) continue;

    out.push({
      id: node.id,
      text,
      x: position.x,
      y: position.y,
      r: position.r,
      side: chosenSide,
      kind: node.kind,
      selected: node.id === selectedId,
    });
  }

  return out;
}