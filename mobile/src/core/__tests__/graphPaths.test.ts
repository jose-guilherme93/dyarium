import { buildGraph } from '../graphBuild';
import type { EntityLink, GraphEntry, GraphEntity } from '../graphModel';
import { layoutGraph } from '../graphLayout';
import {
  EDGE_BANDS,
  edgeBands,
  edgesPath,
  findNode,
  graphPaths,
  neighborIds,
  nodesPath,
  selectedEdgesPath,
  selectedNodesPath,
} from '../graphPaths';

const now = '2026-10-20T10:00:00Z';

function buildData() {
  const entities: GraphEntity[] = [
    { id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' },
    { id: 'e2', kind: 'place', name: 'Recife', icon: '', updatedAt: '' },
    { id: 'e3', kind: 'theme', name: 'família', icon: '', updatedAt: '' },
  ];
  const entries: GraphEntry[] = [
    { id: 'n1', title: 'Nota', recordedAt: now, notebookId: 'nb' },
  ];
  const links: EntityLink[] = entities.map((entity) => ({
    entryId: 'n1',
    entityId: entity.id,
    count: 1,
  }));
  return buildGraph({ entries, entities, links, centerLabel: 'Você' });
}

describe('graphPaths', () => {
  const data = buildData();
  const layout = layoutGraph(data);

  it('desenha todas as arestas de um tipo num caminho só', () => {
    const path = edgesPath(data, layout, 'relation');
    expect(path.match(/M/g)).toHaveLength(data.nodes.length);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('L');

    expect(edgesPath(data, layout, 'mention')).toBe('');
    expect(edgesPath(data, layout, 'cooccurrence').match(/M/g)).toHaveLength(3);
  });

  it('desenha todas as bolas de um tipo num caminho só, com dois arcos', () => {
    const path = nodesPath(data, layout, 'person');
    expect(path.match(/M/g)).toHaveLength(1);
    expect(path.match(/a/g)).toHaveLength(2);
    expect(path.endsWith('Z')).toBe(true);
    expect(nodesPath(data, layout, 'decision')).toBe('');
  });

  it('separa arestas e nós por tipo', () => {
    const paths = graphPaths(data, layout);
    expect(Object.keys(paths.edges).sort()).toEqual(['cooccurrence', 'mention', 'relation']);
    expect(Object.keys(paths.nodes)).toEqual(['person', 'place', 'theme', 'decision', 'note']);
    for (const bands of Object.values(paths.edges)) {
      expect(bands).toHaveLength(EDGE_BANDS);
    }
  });

  it('a grossura da aresta segue o peso (a proximidade)', () => {
    // Duas notas em comum pesam mais que uma: a aresta cai numa faixa grossa.
    const entities: GraphEntity[] = [
      { id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' },
      { id: 'e2', kind: 'place', name: 'Recife', icon: '', updatedAt: '' },
      { id: 'e3', kind: 'theme', name: 'família', icon: '', updatedAt: '' },
    ];
    const entries: GraphEntry[] = [
      { id: 'n1', title: 'Nota 1', recordedAt: now, notebookId: 'nb' },
      { id: 'n2', title: 'Nota 2', recordedAt: now, notebookId: 'nb' },
    ];
    const links: EntityLink[] = [
      { entryId: 'n1', entityId: 'e1', count: 1 },
      { entryId: 'n2', entityId: 'e1', count: 1 },
      { entryId: 'n1', entityId: 'e2', count: 1 },
      { entryId: 'n2', entityId: 'e2', count: 1 },
      { entryId: 'n1', entityId: 'e3', count: 1 },
    ];
    const heavy = buildGraph({ entries, entities, links, centerLabel: 'Você' });
    const heavyLayout = layoutGraph(heavy);
    const bands = edgeBands(heavy, heavyLayout, 'cooccurrence');
    // A dupla que divide duas notas (Maria e Recife) fica na faixa mais grossa.
    expect(bands[EDGE_BANDS - 1].match(/M/g)).toHaveLength(1);
    // A que divide uma nota so fica na mais fina.
    expect(bands[0].match(/M/g)).toHaveLength(2);
  });

  it('acende só as conexões da bola escolhida', () => {
    const maria = data.nodes.find((node) => node.label === 'Maria')!;
    const neighbors = neighborIds(data, maria.id);
    expect(neighbors.has('user')).toBe(true);
    expect(neighbors.has('place:e2')).toBe(true);
    expect(neighbors.has(maria.id)).toBe(false);

    expect(selectedEdgesPath(data, layout, maria.id).match(/M/g)).toHaveLength(3);
    // O centro não vive em `data.nodes`: é desenhado à parte.
    expect(selectedNodesPath(data, layout, neighbors).match(/M/g)).toHaveLength(2);
  });

  it('encontra o nó pelo id prefixado', () => {
    expect(findNode(data, 'person:e1')?.label).toBe('Maria');
    expect(findNode(data, 'person:nao')).toBeNull();
    expect(findNode(data, null)).toBeNull();
  });
});
