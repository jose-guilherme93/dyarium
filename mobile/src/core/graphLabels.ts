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
  /**
   * No grafo estatico da entidade o que importa e o nome das relacoes; as
   * notas so entram se sobrar espaco. No mapa interativo a ordem e a de antes.
   */
  preferEntities?: boolean;
  /** Nomes so destes nos (as relacoes da entidade aberta). */
  onlyIds?: ReadonlySet<string>;
  /**
   * Nome no sentido do no a partir do centro: quem esta embaixo tem o nome
   * embaixo, quem esta em cima tem o nome em cima, e assim por diante.
   */
  radialSides?: boolean;
}

export interface GraphLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  r: number;
  side: LabelSide;
  /** Deslocamento do nome em relacao ao lugar natural do lado, em pixels. */
  dx: number;
  dy: number;
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
  const { camera, selectedId = null, budget = 200, preferEntities = false, onlyIds, radialSides = false } = options;
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
    if (a.kind === 'note' && b.kind !== 'note') return preferEntities ? 1 : -1;
    if (b.kind === 'note' && a.kind !== 'note') return preferEntities ? -1 : 1;
    return b.mentions - a.mentions || a.label.localeCompare(b.label, 'pt-BR');
  });

  // Na previa da entidade o no do dono ("Voce") nao e relacao nenhuma: o nome
  // dele so ocupa o melhor lugar, ao lado da entidade focada.
  let candidates = preferEntities
    ? ordered.filter((node) => node.id !== data.center.id || node.id === selectedId)
    : ordered;
  if (onlyIds) candidates = candidates.filter((node) => onlyIds.has(node.id));

  const out: GraphLabel[] = [];
  // Nomes ja postos: dois nomes nunca se encostam.
  const taken: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const overlaps = (
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number },
  ) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

  for (const node of candidates) {
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
    // O rótulo nunca fica acima da bola. Escolhe o lado oposto ao da tela:
    // bola na metade esquerda -> rótulo à direita; bola na metade direita ->
    // rótulo à esquerda; centro -> abaixo.
    // Na previa o nome sai no mesmo sentido do no em relacao ao centro: a bola
    // de baixo tem o nome embaixo, a de cima em cima, a da esquerda a esquerda.
    // Assim o nome fica do lado de fora do desenho, colado no dono.
    const radial: LabelSide =
      Math.abs(position.x) >= Math.abs(position.y)
        ? position.x >= 0
          ? 'right'
          : 'left'
        : position.y >= 0
          ? 'below'
          : 'above';
    const preferred: LabelSide[] = radialSides
      ? // O lado certo primeiro; se nao couber de jeito nenhum, ainda tenta os
        // outros antes de deixar a relacao sem nome.
        ([radial, 'right', 'below', 'left', 'above'] as LabelSide[]).filter(
          (side, index, list) => list.indexOf(side) === index,
        )
      : sx < camera.width / 2 ? ['right', 'below', 'left']
        : sx > camera.width / 2 ? ['left', 'below', 'right']
        : ['below', 'right', 'left'];

    let chosenSide: LabelSide | null = null;
    let chosenDx = 0;
    let chosenDy = 0;
    // Se o nome encosta em outro ou sai da tela, ele anda mais para fora (no
    // mesmo sentido) em vez de pular para outro lado da bola.
    const stepSize = LABEL_LINE_HEIGHT + 4;
    const steps = radialSides ? [0, stepSize, stepSize * 2, stepSize * 3] : [0];
    const natural = (side: LabelSide) => {
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
        default: // left
          return {
            x1: sx - sr - LABEL_GAP - width,
            y1: sy - half,
            x2: sx - sr - LABEL_GAP,
            y2: sy + half,
          };
      }
    };

    for (const candidate of preferred) {
      for (const step of steps) {
        const base = natural(candidate);
        const b = { ...base };
        if (candidate === 'below') {
          b.y1 += step;
          b.y2 += step;
        } else if (candidate === 'above') {
          b.y1 -= step;
          b.y2 -= step;
        } else if (candidate === 'right') {
          b.x1 += step;
          b.x2 += step;
        } else {
          b.x1 -= step;
          b.x2 -= step;
        }

        // Na previa o nome desliza para dentro da tela em vez de sumir: ele
        // continua no mesmo lado da bola, so um pouco mais para dentro.
        if (radialSides) {
          if (b.x1 < 2) {
            const shift = 2 - b.x1;
            b.x1 += shift;
            b.x2 += shift;
          }
          if (b.x2 > camera.width - 2) {
            const shift = b.x2 - (camera.width - 2);
            b.x1 -= shift;
            b.x2 -= shift;
          }
          if (b.y1 < camera.bandTop + 2) {
            const shift = camera.bandTop + 2 - b.y1;
            b.y1 += shift;
            b.y2 += shift;
          }
          if (b.y2 > camera.bandBottom - 2) {
            const shift = b.y2 - (camera.bandBottom - 2);
            b.y1 -= shift;
            b.y2 -= shift;
          }
        }

        // Cabe inteiro na faixa visível?
        if (b.x1 < 2 || b.x2 > camera.width - 2) continue;
        if (b.y1 < camera.bandTop + 2 || b.y2 > camera.bandBottom - 2) continue;

        // Na previa o resto do mapa esta apagado: o nome pode passar por cima de
        // uma bola de contexto para ficar colado na bola dele. Nome contra nome
        // continua proibido -- dois textos sobrepostos ninguem le.
        if (!radialSides && balls.some((ball) => overlaps(ball, b))) continue;
        const padded = radialSides
          ? { x1: b.x1 - 3, y1: b.y1 - 2, x2: b.x2 + 3, y2: b.y2 + 2 }
          : b;
        if (taken.some((box) => overlaps(box, padded))) continue;

        chosenSide = candidate;
        chosenDx = b.x1 - base.x1;
        chosenDy = b.y1 - base.y1;
        taken.push(padded);
        break;
      }
      if (chosenSide) break;
    }

    if (!chosenSide) continue;

    out.push({
      id: node.id,
      text,
      x: position.x,
      y: position.y,
      r: position.r,
      side: chosenSide,
      dx: chosenDx,
      dy: chosenDy,
      kind: node.kind,
      selected: node.id === selectedId,
    });
  }

  return out;
}