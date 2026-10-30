import { buildGraph, analyzedCount } from '../graphBuild';
import type { EntityLink, GraphEntry, GraphEntity } from '../graphModel';

function entry(id: string, recordedAt: string, extra: Partial<GraphEntry> = {}): GraphEntry {
  return {
    id,
    title: `Nota ${id}`,
    recordedAt,
    notebookId: 'nb',
    ...extra,
  };
}

function entity(id: string, kind: GraphEntity['kind'], name: string): GraphEntity {
  return { id, kind, name, icon: '', updatedAt: '' };
}

const entities = [
  entity('e-maria', 'person', 'Maria'),
  entity('e-recife', 'place', 'Recife'),
  entity('e-familia', 'theme', 'família'),
  entity('e-decisao', 'decision', 'Vou me mudar'),
];

function link(entryId: string, entityId: string, count = 1, sentiment?: number): EntityLink {
  return { entryId, entityId, count, sentiment };
}

describe('buildGraph', () => {
  const entries = [
    entry('n1', '2026-10-20T10:00:00Z'),
    entry('n2', '2026-10-21T10:00:00Z'),
    entry('n3', '2026-10-22T10:00:00Z'),
  ];
  const links = [
    link('n1', 'e-maria', 3, 0.4),
    link('n1', 'e-recife', 1),
    link('n2', 'e-maria', 2, 0.2),
    link('n2', 'e-familia'),
    link('n3', 'e-decisao'),
  ];

  it('soma menções, conta notas e liga o centro a cada entidade', () => {
    const data = buildGraph({ entries, entities, links, centerLabel: 'João' });
    const maria = data.nodes.find((node) => node.label === 'Maria')!;
    expect(maria.mentions).toBe(5);
    expect(maria.notes).toBe(2);
    expect(maria.sentiment).toBeCloseTo(0.3);
    expect(data.center).toMatchObject({ id: 'user', label: 'João' });

    const relation = data.edges.find((edge) => edge.target === maria.id)!;
    expect(relation.kind).toBe('relation');
    expect(relation.weight).toBe(2);
    expect(data.edges).toHaveLength(data.nodes.length + 2);
  });

  it('liga duas entidades que dividem a mesma nota', () => {
    const data = buildGraph({ entries, entities, links, centerLabel: 'Você' });
    const maria = data.nodes.find((node) => node.label === 'Maria')!;
    const recife = data.nodes.find((node) => node.label === 'Recife')!;
    const co = data.edges.find(
      (edge) =>
        edge.kind === 'cooccurrence' &&
        [edge.source, edge.target].sort().join('|') === [maria.id, recife.id].sort().join('|'),
    )!;
    expect(co.weight).toBe(1);
    // Maria e família dividem a segunda nota: as duas co-ocorrências existem.
    expect(data.edges.filter((edge) => edge.kind === 'cooccurrence')).toHaveLength(2);
  });

  it('respeita os tipos visíveis', () => {
    const data = buildGraph(
      { entries, entities, links, centerLabel: 'Você' },
      { kinds: new Set(['place']) },
    );
    expect(data.nodes.map((node) => node.label)).toEqual(['Recife']);
    expect(data.edges.every((edge) => edge.kind === 'relation')).toBe(true);
  });

  it('corta o desenho nas mais mencionadas sem perder o total', () => {
    const manyEntities = Array.from({ length: 6 }, (_, index) =>
      entity(`e${index}`, 'theme', `Tema ${index}`),
    );
    const manyLinks = manyEntities.map((item, index) =>
      link('n1', item.id, index + 1),
    );
    const data = buildGraph(
      { entries, entities: manyEntities, links: manyLinks, centerLabel: 'Você' },
      { nodeLimit: 2 },
    );
    expect(data.nodes).toHaveLength(2);
    expect(data.totalNodes).toBe(6);
    expect(data.nodes.map((node) => node.label)).toEqual(['Tema 5', 'Tema 4']);
    expect(data.edges.every((edge) => data.nodes.some((node) => node.id === edge.target))).toBe(
      true,
    );
  });

  it('abre o foco com as notas como evidência', () => {
    const data = buildGraph(
      { entries, entities, links, centerLabel: 'Você' },
      { focus: 'person:e-maria' },
    );
    const notes = data.nodes.filter((node) => node.kind === 'note');
    expect(notes.map((node) => node.id).sort()).toEqual(['note:n1', 'note:n2']);
    expect(data.edges.filter((edge) => edge.kind === 'relation')).toHaveLength(1);
    expect(data.edges.filter((edge) => edge.kind === 'mention').length).toBeGreaterThan(0);
    expect(data.edges.find((edge) => edge.kind === 'relation')!.target).toBe('person:e-maria');
  });

  it('devolve o mapa vazio quando a entidade do foco não existe', () => {
    const data = buildGraph(
      { entries, entities, links, centerLabel: 'Você' },
      { focus: 'person:nao' },
    );
    expect(data.nodes).toHaveLength(0);
  });

  it('conta quantas notas foram analisadas', () => {
    const analyzed = analyzedCount([
      entry('a', '2026-01-01T00:00:00Z', { analysis: { sentiment: 0 } as never }),
      entry('b', '2026-01-02T00:00:00Z'),
    ]);
    expect(analyzed).toEqual({ analyzed: 1, total: 2 });
  });
});
