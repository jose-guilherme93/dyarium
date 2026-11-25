/**
 * Orcamento de tempo do trabalho por quadro do mapa.
 *
 * O gesto so trava se o app gastar tempo demais *por quadro* na thread de UI.
 * Este teste mede exatamente esse trabalho -- dois passos da fisica e a escolha
 * de nomes -- com o teto de 120 nos que a tela permite, e falha se ele passar
 * de uma fracao do orcamento de 16,7 ms. Nao mede rasterizacao (isso e o
 * aparelho, com `[frame]` no log); mede o que este repositorio controla.
 */

import { createSimState, dragNode, stepSimulation, type SimBody, type SimLink } from '../graphSim';
import { layoutGraph } from '../graphLayout';
import { pickLabels } from '../graphLabels';
import type { GraphData, GraphEdge, GraphNode } from '../graphModel';

const NODES = 120;
const EDGES_PER_NODE = 6;

function makeData(nodeCount = NODES): GraphData {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    nodes.push({
      id: `ent:${i}`,
      kind: i % 3 === 0 ? 'person' : i % 3 === 1 ? 'place' : 'theme',
      label: `Entidade ${i}`,
      mentions: 1 + ((i * 7) % 20),
      notes: 1,
    });
  }
  const center: GraphNode = {
    id: 'user',
    kind: 'user',
    label: 'Você',
    mentions: 0,
    notes: 0,
  };
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    for (let k = 1; k <= EDGES_PER_NODE; k += 1) {
      const j = (i * 31 + k * 17 + 1) % nodeCount;
      if (j === i) continue;
      edges.push({
        source: `ent:${i}`,
        target: `ent:${j}`,
        kind: k % 3 === 0 ? 'relation' : k % 3 === 1 ? 'cooccurrence' : 'mention',
        weight: (k % 3) + 1,
      });
    }
    edges.push({ source: 'user', target: `ent:${i}`, kind: 'relation', weight: 2 });
  }
  return { center, nodes, edges, totalNodes: nodes.length, totalEdges: edges.length };
}

function measure(runs: number, fn: () => void): number {
  // Uma passada de aquecimento: o JIT entra na conta, nao no numero final.
  fn();
  const started = performance.now();
  for (let i = 0; i < runs; i += 1) fn();
  return (performance.now() - started) / runs;
}

describe('orcamento por quadro do mapa', () => {
  const data = makeData();
  const layout = layoutGraph(data);
  const bodies: SimBody[] = [{ r: 24, pinned: true }];
  const seed = [{ x: 0, y: 0 }];
  const indexById = new Map<string, number>([['user', 0]]);
  for (const node of data.nodes) {
    const position = layout.positions[node.id];
    indexById.set(node.id, bodies.length);
    bodies.push({ r: position.r, pinned: false });
    seed.push({ x: position.x * 0.62, y: position.y * 0.62 });
  }
  const links: SimLink[] = [];
  for (const edge of data.edges) {
    const a = indexById.get(edge.source);
    const b = indexById.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    links.push({ a, b });
  }

  it('dois passos da fisica cabem folgados num quadro de 60 fps', () => {
    const state = createSimState(bodies, seed);
    const ms = measure(120, () => {
      stepSimulation(state, bodies, links);
      stepSimulation(state, bodies, links);
      // O mesmo que o worklet faz depois de cada passo.
      state.tick += 1;
    });
    console.log(
      `[perf] fisica 2 passos: ${ms.toFixed(2)}ms/frame (${bodies.length} nos, ${links.length} vinculos)`,
    );
    expect(ms).toBeLessThan(8);
  });

  it('um mapa do tamanho do aparelho gasta bem menos', () => {
    // A biblioteca de teste tem 35 entidades; o teto de 120 e a pior hipotese.
    const small = makeData(35);
    const smallLayout = layoutGraph(small);
    const smallBodies: SimBody[] = [{ r: 24, pinned: true }];
    const smallSeed = [{ x: 0, y: 0 }];
    const smallIndex = new Map<string, number>([['user', 0]]);
    for (const node of small.nodes) {
      const position = smallLayout.positions[node.id];
      smallIndex.set(node.id, smallBodies.length);
      smallBodies.push({ r: position.r, pinned: false });
      smallSeed.push({ x: position.x * 0.62, y: position.y * 0.62 });
    }
    const smallLinks: SimLink[] = [];
    for (const edge of small.edges) {
      const a = smallIndex.get(edge.source);
      const b = smallIndex.get(edge.target);
      if (a === undefined || b === undefined || a === b) continue;
      smallLinks.push({ a, b });
    }
    const state = createSimState(smallBodies, smallSeed);
    const ms = measure(120, () => {
      stepSimulation(state, smallBodies, smallLinks);
      stepSimulation(state, smallBodies, smallLinks);
    });
    console.log(
      `[perf] fisica 2 passos (35 nos, ${smallLinks.length} vinculos): ${ms.toFixed(2)}ms/frame`,
    );
    expect(ms).toBeLessThan(3);
  });

  it('arrastar um no custa menos que um passo da fisica', () => {
    const state = createSimState(bodies, seed);
    const ms = measure(200, () => {
      dragNode(state, 10, state.x[10] + 0.5, state.y[10] + 0.5);
    });
    console.log(`[perf] arrasto: ${ms.toFixed(3)}ms/frame`);
    expect(ms).toBeLessThan(0.5);
  });

  it('escolher os nomes cabe no orcamento do gesto', () => {
    const state = createSimState(bodies, seed);
    for (let i = 0; i < 120; i += 1) stepSimulation(state, bodies, links);
    const positions = { ...layout };
    const ms = measure(60, () => {
      pickLabels(data, positions, {
        camera: {
          zoom: 2.4,
          panX: 0,
          panY: 0,
          width: 720,
          centerY: 640,
          bandTop: 40,
          bandBottom: 1280,
          originX: 0,
          originY: 0,
        },
        budget: 48,
      });
    });
    console.log(`[perf] nomes: ${ms.toFixed(2)}ms/gesto`);
    expect(ms).toBeLessThan(4);
  });
});
