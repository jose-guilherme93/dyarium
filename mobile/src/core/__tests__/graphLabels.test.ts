import { buildGraph } from '../graphBuild';
import type { EntityLink, GraphEntry, GraphEntity } from '../graphModel';
import { layoutGraph } from '../graphLayout';
import { pickLabels } from '../graphLabels';

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

describe('pickLabels', () => {
  const data = buildData(30);
  const layout = layoutGraph(data);

  it('começa pelo dono e nunca repete um nome', () => {
    const labels = pickLabels(data, layout, { scale: 1 });
    const texts = labels.map((label) => label.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[0]).toBe('Você');
    expect(texts.length).toBeGreaterThan(3);
  });

  it('desenha o rótulo abaixo da bola, como no mapa do dashboard', () => {
    const labels = pickLabels(data, layout, { scale: 1 });
    const owner = labels.find((label) => label.id === data.center.id);
    expect(owner).toBeTruthy();
    expect(owner!.y).toBeGreaterThan(layout.positions[data.center.id].y);
  });

  it('não cai em cima de outra bola', () => {
    const labels = pickLabels(data, layout, { scale: 0.6 });
    const font = labels[0].fontSize;
    for (const label of labels) {
      const half = (label.text.length * font * 0.56) / 2;
      const box = {
        x1: label.x - half,
        y1: label.y - font,
        x2: label.x + half,
        y2: label.y + font * 0.3,
      };
      if (label.forced) continue;
      for (const node of data.nodes) {
        const position = layout.positions[node.id];
        if (node.id === label.id || position.r < font * 0.25) continue;
        const ball = {
          x1: position.x - position.r,
          y1: position.y - position.r,
          x2: position.x + position.r,
          y2: position.y + position.r,
        };
        const overlaps =
          box.x1 < ball.x2 && box.x2 > ball.x1 && box.y1 < ball.y2 && box.y2 > ball.y1;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('mantém o nome da bola escolhida mesmo fora da ordem', () => {
    const chosen = data.nodes[data.nodes.length - 1];
    const labels = pickLabels(data, layout, { scale: 1, selectedId: chosen.id, budget: 2 });
    const picked = labels.find((label) => label.id === chosen.id);
    expect(picked).toMatchObject({ selected: true, forced: true });
  });

  it('foge da folha: com a faixa curta, o nome vai para cima da bola', () => {
    const owner = layout.positions[data.center.id];
    const labels = pickLabels(data, layout, {
      scale: 1,
      // Faixa que termina no centro da bola: abaixo dele é a folha.
      view: { minX: -1000, minY: -1000, maxX: 1000, maxY: owner.y },
    });
    const label = labels.find((item) => item.id === data.center.id);
    expect(label).toBeTruthy();
    expect(label!.y).toBeLessThan(owner.y);
    // Nada é desenhado abaixo do corte.
    for (const item of labels) expect(item.y).toBeLessThanOrEqual(owner.y);
  });

  it('o nome acompanha a escala do encaixe e a escolha é determinística', () => {
    const near = pickLabels(data, layout, { scale: 1 });
    expect(near[0].fontSize).toBeCloseTo(10, 6);
    expect(pickLabels(data, layout, { scale: 1 }).map((label) => label.id)).toEqual(
      near.map((label) => label.id),
    );
    // Encaixe mais afastado: o texto ocupa o dobro de unidades do grafo, então
    // cabem menos nomes no mesmo desenho. Nada disso depende da câmera.
    const far = pickLabels(data, layout, { scale: 2 });
    expect(far[0].fontSize).toBeCloseTo(20, 6);
    expect(far.length).toBeLessThanOrEqual(near.length);
  });
});
