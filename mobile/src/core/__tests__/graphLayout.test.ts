import { buildGraph } from '../graphBuild';
import type { EntityLink, GraphEntry, GraphEntity } from '../graphModel';
import {
  fitCamera,
  layoutGraph,
  layoutKey,
  panLimits,
  stableHash,
  visibleBand,
  zoomAround,
} from '../graphLayout';

const now = '2026-10-20T10:00:00Z';

function graphOf(count: number, kind: GraphEntity['kind'] = 'person') {
  const entities: GraphEntity[] = Array.from({ length: count }, (_, index) => ({
    id: `e${index}`,
    kind,
    name: `Pessoa ${index}`,
    icon: '',
    updatedAt: '',
  }));
  const entries: GraphEntry[] = [{ id: 'n1', title: 'Nota', recordedAt: now, notebookId: 'nb' }];
  const links: EntityLink[] = entities.map((entity) => ({
    entryId: 'n1',
    entityId: entity.id,
    count: 1,
  }));
  return buildGraph({ entries, entities, links, centerLabel: 'Você' });
}

describe('layoutGraph', () => {
  it('é determinístico e estável para o mesmo conjunto', () => {
    const data = graphOf(12);
    const first = layoutGraph(data);
    const second = layoutGraph(data);
    expect(first.positions).toEqual(second.positions);
    expect(first.key).toBe(second.key);
    expect(layoutKey(data)).toBe(second.key);
  });

  it('coloca o centro na origem e afasta as entidades', () => {
    const data = graphOf(20);
    const layout = layoutGraph(data);
    expect(layout.positions.user).toMatchObject({ x: 0, y: 0 });
    for (const node of data.nodes) {
      const position = layout.positions[node.id];
      // A colisao e a mola pelas ligacoes empurram as bolas para fora do dono.
      expect(Math.hypot(position.x, position.y)).toBeGreaterThan(36);
    }
  });

  it('espalha as bolas em vez de alinhar num anel perfeito', () => {
    const data = graphOf(40);
    const layout = layoutGraph(data);
    const radii = data.nodes.map((node) =>
      Math.hypot(layout.positions[node.id].x, layout.positions[node.id].y),
    );
    // A relaxacao de forcas cria uma nuvem: raios variados, sem todos no mesmo
    // valor como num anel.
    const distinct = new Set(radii.map((value) => Math.round(value / 10)));
    expect(distinct.size).toBeGreaterThan(5);
  });

  it('afasta as bolas conforme o conjunto cresce', () => {
    const data = graphOf(80);
    const layout = layoutGraph(data);
    const radii = data.nodes.map((node) =>
      Math.hypot(layout.positions[node.id].x, layout.positions[node.id].y),
    );
    expect(Math.max(...radii)).toBeGreaterThan(200);
  });

  it('mantém a entidade do foco perto do centro e as notas em volta', () => {
    const entities: GraphEntity[] = [
      { id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' },
    ];
    const entries: GraphEntry[] = Array.from({ length: 6 }, (_, index) => ({
      id: `n${index}`,
      title: `Nota ${index}`,
      recordedAt: now,
      notebookId: 'nb',
    }));
    const links: EntityLink[] = entries.map((entry) => ({
      entryId: entry.id,
      entityId: 'e1',
      count: 1,
    }));
    const data = buildGraph(
      {
        entries,
        entities,
        links,
        centerLabel: 'Você',
      },
      { focus: 'person:e1' },
    );
    const layout = layoutGraph(data, { focus: 'person:e1' });
    const focusDistance = Math.hypot(
      layout.positions['person:e1'].x,
      layout.positions['person:e1'].y,
    );
    expect(focusDistance).toBeLessThan(200);
    for (const entry of entries) {
      const position = layout.positions[`note:${entry.id}`];
      expect(Math.hypot(position.x, position.y)).toBeGreaterThan(focusDistance);
    }
  });

  it('encaixa o desenho na tela dentro do zoom permitido', () => {
    const data = graphOf(40);
    const layout = layoutGraph(data);
    const camera = fitCamera(layout.bounds, 390, 500);
    expect(camera.zoom).toBeGreaterThan(0);
    expect(camera.zoom).toBeLessThanOrEqual(1.6);
    // O desenho inteiro cabe na tela: a largura escalada nao passa da tela.
    const spanX = layout.bounds.maxX - layout.bounds.minX;
    const spanY = layout.bounds.maxY - layout.bounds.minY;
    expect(spanX * camera.zoom).toBeLessThanOrEqual(390);
    expect(spanY * camera.zoom).toBeLessThanOrEqual(500);
    // O encaixe nasce sem deslocamento, centrado na faixa.
    expect(camera.panX).toBe(0);
    expect(camera.panY).toBe(0);
    expect(camera.originX).toBeCloseTo((layout.bounds.minX + layout.bounds.maxX) / 2, 6);
  });

  it('hash estável não depende da ordem', () => {
    expect(stableHash('person:abc')).toBe(stableHash('person:abc'));
    expect(stableHash('person:abc')).not.toBe(stableHash('person:abd'));
  });
});

describe('visibleBand', () => {
  it('centra o mapa na faixa acima da folha, não na tela inteira', () => {
    const band = visibleBand(844, 159, 439);
    expect(band.centerY).toBe(299);
    expect(band.height).toBe(280);
  });

  it('usa a tela inteira quando não há folha', () => {
    expect(visibleBand(844, 0, 0)).toMatchObject({ top: 0, bottom: 844, centerY: 422 });
  });
});

describe('panLimits', () => {
  it('não deixa o desenho sair da área disponível', () => {
    const bounds = { minX: -500, minY: -400, maxX: 500, maxY: 400 };
    // No encaixe o desenho cabe: não há o que arrastar.
    const fitted = panLimits(bounds, 0.3, 390, 844);
    expect(fitted.limitX).toBe(0);
    expect(fitted.limitY).toBe(0);
    // Ampliado: arrasta só até a borda do desenho, nunca além dela.
    const zoomed = panLimits(bounds, 1, 390, 844);
    expect(zoomed.limitX).toBeCloseTo((1000 - 390) / 2, 6);
    expect(zoomed.limitY).toBe(0);
  });
});

describe('zoomAround', () => {
  it('mantém parado o ponto entre os dedos', () => {
    const width = 390;
    const centerY = 300;
    const start = { zoom: 0.5, panX: 40, panY: -30 };
    const focalX = 250;
    const focalY = 200;
    // Ponto do mundo sob o foco antes do zoom.
    const worldX = (focalX - width / 2 - start.panX) / start.zoom;
    const worldY = (focalY - centerY - start.panY) / start.zoom;
    const next = zoomAround(start, 1, focalX, focalY, width, centerY);
    // Depois do zoom, o mesmo ponto do mundo continua sob o foco.
    expect(width / 2 + next.panX + worldX * next.zoom).toBeCloseTo(focalX, 6);
    expect(centerY + next.panY + worldY * next.zoom).toBeCloseTo(focalY, 6);
  });
});
