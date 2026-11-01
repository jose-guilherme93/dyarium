import { buildGraph } from '../graphBuild';
import type { EntityLink, GraphEntry, GraphEntity } from '../graphModel';
import { layoutGraph } from '../graphLayout';
import {
  LABEL_FONT,
  LABEL_LINE_HEIGHT,
  pickLabels,
  type LabelCamera,
} from '../graphLabels';

const now = '2026-10-20T10:00:00Z';

function buildData(count: number) {
  const entities: GraphEntity[] = Array.from({ length: count }, (_, index) => ({
    id: `e${index}`,
    kind: index % 2 === 0 ? 'person' : 'place',
    name: `Entidade ${index}`,
    icon: '',
    updatedAt: '',
  }));
  const entries: GraphEntry[] = [{ id: 'n1', title: 'Nota', recordedAt: now, notebookId: 'nb' }];
  const links: EntityLink[] = entities.map((entity, index) => ({
    entryId: 'n1',
    entityId: entity.id,
    count: count - index,
  }));
  return buildGraph({ entries, entities, links, centerLabel: 'Você' });
}

/** Camera com o desenho centrado na faixa. */
function camera(zoom: number, width = 360, height = 300): LabelCamera {
  return {
    zoom,
    panX: 0,
    panY: 0,
    width,
    centerY: height / 2,
    bandTop: 0,
    bandBottom: height,
    originX: 0,
    originY: 0,
  };
}

describe('pickLabels', () => {
  const data = buildData(30);
  const layout = layoutGraph(data);

  const screenBox = (label: ReturnType<typeof pickLabels>[number], cam: LabelCamera) => {
    const sx = cam.width / 2 + cam.panX + (label.x - cam.originX) * cam.zoom;
    const sy = cam.centerY + cam.panY + (label.y - cam.originY) * cam.zoom;
    const sr = label.r * cam.zoom;
    const width = label.text.length * LABEL_FONT * 0.56;
    const half = LABEL_LINE_HEIGHT / 2;
    switch (label.side) {
      case 'below':
        return {
          x1: sx - width / 2,
          y1: sy + sr + 6,
          x2: sx + width / 2,
          y2: sy + sr + 6 + LABEL_LINE_HEIGHT,
        };
      case 'above':
        return {
          x1: sx - width / 2,
          y1: sy - sr - 6 - LABEL_LINE_HEIGHT,
          x2: sx + width / 2,
          y2: sy - sr - 6,
        };
      case 'right':
        return {
          x1: sx + sr + 6,
          y1: sy - half,
          x2: sx + sr + 6 + width,
          y2: sy + half,
        };
      default:
        return {
          x1: sx - sr - 6 - width,
          y1: sy - half,
          x2: sx - sr - 6,
          y2: sy + half,
        };
    }
  };

  it('começa pelo dono e nunca repete um nome', () => {
    const labels = pickLabels(data, layout, { camera: camera(1) });
    const texts = labels.map((label) => label.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[0]).toBe('Você');
  });

  it('mais perto, mais bolas visíveis ganham nome', () => {
    const share = (zoom: number) => {
      const cam = camera(zoom);
      const labels = pickLabels(data, layout, { camera: cam });
      const visible = [data.center, ...data.nodes].filter((node) => {
        const position = layout.positions[node.id];
        const sx = cam.width / 2 + (position.x - cam.originX) * cam.zoom;
        const sy = cam.centerY + (position.y - cam.originY) * cam.zoom;
        const sr = position.r * cam.zoom;
        return (
          sx + sr > 0 &&
          sx - sr < cam.width &&
          sy + sr > cam.bandTop &&
          sy - sr < cam.bandBottom
        );
      });
      return labels.length / visible.length;
    };
    // O espaço entre as bolas cresce com o zoom, então uma fatia maior das
    // bolas visíveis cabe um nome.
    expect(share(1.2)).toBeGreaterThan(share(0.4));
  });

  it('o nome fica colado na bola e nunca fora da faixa', () => {
    const cam = camera(0.8);
    const labels = pickLabels(data, layout, { camera: cam });
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const box = screenBox(label, cam);
      expect(box.y1).toBeGreaterThanOrEqual(0);
      expect(box.y2).toBeLessThanOrEqual(cam.bandBottom);
      expect(box.x1).toBeGreaterThanOrEqual(0);
      expect(box.x2).toBeLessThanOrEqual(cam.width);
    }
  });

  it('não cai em cima de outra bola', () => {
    const cam = camera(0.8);
    const labels = pickLabels(data, layout, { camera: cam });
    for (const label of labels) {
      if (label.selected) continue;
      const box = screenBox(label, cam);
      for (const node of data.nodes) {
        if (node.id === label.id) continue;
        const position = layout.positions[node.id];
        const sx = cam.width / 2 + (position.x - cam.originX) * cam.zoom;
        const sy = cam.centerY + (position.y - cam.originY) * cam.zoom;
        const sr = position.r * cam.zoom;
        const ball = { x1: sx - sr, y1: sy - sr, x2: sx + sr, y2: sy + sr };
        const overlaps =
          box.x1 < ball.x2 && box.x2 > ball.x1 && box.y1 < ball.y2 && box.y2 > ball.y1;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('na visão de foco, a nota entra antes das entidades', () => {
    // A nota e a prova da relacao aberta; sem nome ela vira um ponto solto no
    // meio das linhas pontilhadas.
    const entities: GraphEntity[] = [
      { id: 'e1', kind: 'person', name: 'Ana', icon: '', updatedAt: '' },
      { id: 'e2', kind: 'theme', name: 'saude', icon: '', updatedAt: '' },
    ];
    const entries: GraphEntry[] = [
      { id: 'n1', title: 'Nota grande', recordedAt: now, notebookId: 'nb' },
    ];
    const links: EntityLink[] = [
      { entryId: 'n1', entityId: 'e1', count: 3 },
      { entryId: 'n1', entityId: 'e2', count: 1 },
    ];
    const focus = buildGraph(
      { entries, entities, links, centerLabel: 'Você' },
      { focus: 'person:e1' },
    );
    const focusLayout = layoutGraph(focus, { focus: 'person:e1' });
    const labels = pickLabels(focus, focusLayout, {
      camera: camera(0.6, 800, 600),
      budget: 2,
    });
    expect(labels.map((label) => label.kind)).toEqual(['user', 'note']);
  });

  it('mantém o nome da bola escolhida mesmo sem espaço', () => {
    const chosen = data.nodes[data.nodes.length - 1];
    const labels = pickLabels(data, layout, {
      camera: camera(0.5),
      selectedId: chosen.id,
      budget: 2,
    });
    expect(labels.find((label) => label.id === chosen.id)).toMatchObject({
      selected: true,
    });
  });
});
