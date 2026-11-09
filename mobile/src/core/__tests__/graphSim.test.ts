import {
  ALPHA_MIN,
  DRAG_ALPHA,
  createSimState,
  dragNode,
  linkRest,
  stepSimulation,
  type SimBody,
  type SimLink,
} from '../graphSim';

/** Grafo de teste: dono preso na origem e entidades em espiral. */
function graphOf(count: number) {
  const bodies: SimBody[] = [{ r: 24, pinned: true }];
  const seed = [{ x: 0, y: 0 }];
  for (let i = 0; i < count; i += 1) {
    const angle = i * 2.399963;
    const radius = 40 + Math.sqrt(i) * 11;
    bodies.push({ r: 4 + 6 * Math.sqrt((count - i) / count), pinned: false });
    seed.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  const links: SimLink[] = [];
  for (let i = 1; i <= Math.min(7, count); i += 1) links.push({ a: 0, b: i });
  for (let i = 1; i <= count; i += 1) {
    const j = 1 + ((i * 7 + 3) % count);
    if (j !== i) links.push({ a: i, b: j });
  }
  return { bodies, seed, links };
}

function settle(
  state: ReturnType<typeof createSimState>,
  bodies: SimBody[],
  links: SimLink[],
  steps: number,
) {
  for (let i = 0; i < steps; i += 1) stepSimulation(state, bodies, links);
}

function metrics(state: ReturnType<typeof createSimState>, bodies: SimBody[]) {
  let minGap = Infinity;
  let maxRadius = 0;
  let sumRadius = 0;
  for (let i = 1; i < bodies.length; i += 1) {
    const radius = Math.hypot(state.x[i], state.y[i]);
    maxRadius = Math.max(maxRadius, radius);
    sumRadius += radius;
    for (let j = i + 1; j < bodies.length; j += 1) {
      const d = Math.hypot(state.x[i] - state.x[j], state.y[i] - state.y[j]);
      minGap = Math.min(minGap, d - (bodies[i].r + bodies[j].r));
    }
  }
  return { minGap, maxRadius, meanRadius: sumRadius / (bodies.length - 1) };
}

describe('stepSimulation', () => {
  const { bodies, seed, links } = graphOf(40);

  it('e deterministico e assenta sem sobrepor bolas', () => {
    const first = createSimState(bodies, seed);
    const second = createSimState(bodies, seed);
    settle(first, bodies, links, 620);
    settle(second, bodies, links, 620);
    expect(first.x).toEqual(second.x);
    expect(first.alpha).toBe(0);
    expect(metrics(first, bodies).minGap).toBeGreaterThanOrEqual(0);
    expect(first.x.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('mantem o dono preso na origem', () => {
    const state = createSimState(bodies, seed);
    settle(state, bodies, links, 300);
    expect(state.x[0]).toBe(0);
    expect(state.y[0]).toBe(0);
  });

  it('volta a esquentar quando o zoom muda depois de frio', () => {
    const state = createSimState(bodies, seed);
    settle(state, bodies, links, 620);
    expect(state.alpha).toBe(0);
    state.alpha = 0.4;
    stepSimulation(state, bodies, links);
    expect(state.x).not.toEqual(createSimState(bodies, seed).x);
    expect(state.alpha).toBeGreaterThan(0);
  });

  it('a mola nao deixa o par ligado colar nem fugir', () => {
    const two: SimBody[] = [
      { r: 24, pinned: true },
      { r: 8, pinned: false },
    ];
    const state = createSimState(two, [{ x: 0, y: 0 }, { x: 120, y: 0 }]);
    settle(state, two, [{ a: 0, b: 1 }], 600);
    const distance = Math.hypot(state.x[1], state.y[1]);
    expect(distance).toBeGreaterThan(linkRest(24, 8) * 0.75);
    expect(distance).toBeLessThan(linkRest(24, 8) * 1.9);
  });

  it('nao dispara as bolas na abertura', () => {
    // Duas bolas quase no mesmo ponto geravam forca enorme e o mapa explodia na
    // primeira abertura. O teto de forca e de velocidade segura o movimento.
    const state = createSimState(bodies, seed);
    let maxStep = 0;
    for (let step = 0; step < 60; step += 1) {
      const beforeX = [...state.x];
      const beforeY = [...state.y];
      stepSimulation(state, bodies, links);
      for (let i = 1; i < bodies.length; i += 1) {
        maxStep = Math.max(
          maxStep,
          Math.hypot(state.x[i] - beforeX[i], state.y[i] - beforeY[i]),
        );
      }
    }
    // A colisao agora separa por posicao (ate 2,5 unidades por par), entao o
    // passo maximo sobe um pouco; o teto continua guardando contra o estouro
    // que existia antes (dezenas de unidades num quadro).
    expect(maxStep).toBeLessThanOrEqual(8);
  });

  it('assenta perto da semente, sem inflar o desenho', () => {
    const state = createSimState(bodies, seed);
    settle(state, bodies, links, 620);
    const seedMax = Math.max(...seed.map((p) => Math.hypot(p.x, p.y)));
    expect(metrics(state, bodies).maxRadius).toBeLessThan(seedMax * 1.5);
  });

  it('dorme abaixo do limiar e nao anda mais', () => {
    const state = createSimState(bodies, seed);
    state.alpha = ALPHA_MIN / 2;
    const before = { x: [...state.x], y: [...state.y] };
    stepSimulation(state, bodies, links);
    expect(state.alpha).toBe(0);
    expect(state.x).toEqual(before.x);
  });

  it('move a ancora do dono sem soltar o corpo preso', () => {
    const state = createSimState(bodies, seed, 1, { x: 120, y: -40 });
    settle(state, bodies, links, 240);
    expect(state.x[0]).toBe(120);
    expect(state.y[0]).toBe(-40);
  });

  it('arrastar acorda a simulacao e a vizinhanca acompanha', () => {
    const state = createSimState(bodies, seed);
    settle(state, bodies, links, 620);
    expect(state.alpha).toBe(0);
    const neighbors = links.filter((link) => link.a === 0 || link.b === 0);
    expect(neighbors.length).toBeGreaterThan(0);
    const before = { x: [...state.x], y: [...state.y] };

    // Puxa o dono para longe: as bolas ligadas a ele precisam se mexer.
    dragNode(state, 0, 90, 60);
    expect(state.alpha).toBeGreaterThanOrEqual(DRAG_ALPHA);
    for (let step = 0; step < 10; step += 1) stepSimulation(state, bodies, links);

    let moved = 0;
    for (const link of neighbors) {
      const index = link.a === 0 ? link.b : link.a;
      moved += Math.hypot(state.x[index] - before.x[index], state.y[index] - before.y[index]);
    }
    expect(moved).toBeGreaterThan(1);
  });

  it('abre de uma semente comprimida e assenta no mesmo tamanho', () => {
    // O mapa nasce menor e se abre no primeiro segundo, como o Obsidian. A
    // semente comprimida nao pode inflar o desenho final.
    const compressed = seed.map((p) => ({ x: p.x * 0.62, y: p.y * 0.62 }));
    const state = createSimState(bodies, compressed);
    const opened = createSimState(bodies, seed);
    settle(state, bodies, links, 620);
    settle(opened, bodies, links, 620);
    const radius = metrics(state, bodies).maxRadius;
    const reference = metrics(opened, bodies).maxRadius;
    const compressedMax = Math.max(...compressed.map((p) => Math.hypot(p.x, p.y)));
    expect(radius).toBeGreaterThan(compressedMax * 1.2);
    expect(Math.abs(radius - reference) / reference).toBeLessThan(0.25);
  });
});

