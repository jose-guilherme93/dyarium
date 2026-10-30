import { buildGraph } from '../graphBuild';
import type { EntityLink, GraphEntry, GraphEntity } from '../graphModel';
import { layoutGraph } from '../graphLayout';
import { labelBudget, pickLabels, type Camera } from '../graphLabels';

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

function camera(zoom: number): Camera {
  return { zoom, panX: 0, panY: 0, width: 1600, height: 1600 };
}

describe('pickLabels', () => {
  const data = buildData(30);
  const layout = layoutGraph(data);

  it('revela mais nomes conforme o zoom aumenta', () => {
    const far = pickLabels(data, layout, camera(0.3), null);
    const near = pickLabels(data, layout, camera(1.6), null);
    expect(far.length).toBeGreaterThan(0);
    expect(near.length).toBeGreaterThan(far.length);
    expect(near.length).toBeLessThanOrEqual(labelBudget(1.6));
  });

  it('começa pelo dono e nunca repete um nome', () => {
    const labels = pickLabels(data, layout, camera(0.6), null);
    const texts = labels.map((label) => label.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[0]).toBe('Você');
    expect(texts).toContain('Entidade 0');
  });

  it('mantém o rótulo escolhido mesmo fora da ordem', () => {
    const chosen = data.nodes[data.nodes.length - 1];
    const labels = pickLabels(
      data,
      layout,
      { zoom: 0.5, panX: 0, panY: 0, width: 4000, height: 4000 },
      chosen.id,
      2,
    );
    const picked = labels.find((label) => label.id === chosen.id);
    expect(picked).toMatchObject({ selected: true });
  });

  it('não desenha rótulo fora da tela', () => {
    const labels = pickLabels(
      data,
      layout,
      { zoom: 0.2, panX: 100_000, panY: 100_000, width: 390, height: 500 },
      null,
    );
    expect(labels).toHaveLength(0);
  });

  it('desenha o rótulo abaixo da bola, como no mapa do dashboard', () => {
    const labels = pickLabels(data, layout, camera(1), null);
    const owner = labels.find((label) => label.id === data.center.id);
    expect(owner).toBeTruthy();
    expect(owner!.y).toBeGreaterThan(layout.positions[data.center.id].y);
  });

  it('corta o rótulo que cairia atrás da folha', () => {
    const labels = pickLabels(
      data,
      layout,
      { zoom: 1, panX: 0, panY: 0, width: 200, height: 60 },
      null,
    );
    // O centro fica sempre na origem e, com a faixa baixa, seu rótulo cai
    // abaixo da borda visível.
    expect(labels.find((label) => label.id === data.center.id)).toBeUndefined();
  });

  it('cresce o orçamento por faixa de zoom', () => {
    expect(labelBudget(0.3)).toBeLessThan(labelBudget(1));
    expect(labelBudget(1)).toBeLessThan(labelBudget(3));
  });
});
