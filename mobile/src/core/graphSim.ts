/**
 * Simulacao de forcas do mapa, a mesma ideia do grafo do Obsidian.
 *
 * Repulsao entre todos os pares, mola nas ligacoes, colisao e ancora fraca no
 * centro, com a temperatura (`alpha`) caindo a cada passo. E o que faz as bolas
 * se mexerem ao abrir o mapa e se acomodarem em vez de aparecerem paradas numa
 * posicao pre-calculada.
 *
 * O zoom nao muda o tamanho de nada: ele entra so no comprimento de repouso das
 * ligacoes. Afastando, as molas ficam mais compridas (o mapa abre espaco);
 * aproximando, mais curtas. Quem cuida do tamanho das bolas e a camera.
 *
 * O passo e deterministico e sem dependencia nativa: da para testar em Jest.
 */

export interface SimBody {
  /** Raio da bola, em unidades do grafo. */
  r: number;
  /** O dono fica preso na origem. */
  pinned: boolean;
}

export interface SimLink {
  a: number;
  b: number;
}

export interface SimState {
  x: number[];
  y: number[];
  vx: number[];
  vy: number[];
  /** Acumuladores de forca do passo; nao sao desenhados. */
  fx: number[];
  fy: number[];
  /** Posicao do corpo preso (o dono). Arrastar o dono move a ancora. */
  ax: number;
  ay: number;
  /** Temperatura da simulacao: 1 quente, 0 assentada. */
  alpha: number;
  /** Muda a cada passo, para o Skia saber que o desenho mudou. */
  tick: number;
}

const REPEL = 240;
const SPRING = 0.22;
const ANCHOR = 0.08;
const DAMPING = 0.72;
const ALPHA_DECAY = 0.98;
/** Abaixo disso a simulacao dorme e o mapa para de pedir quadro. */
export const ALPHA_MIN = 0.008;
/**
 * Temperatura minima enquanto um no esta na mao do usuario: a vizinhanca
 * continua se acomodando em volta do dedo, sem o mapa inteiro explodir.
 */
export const DRAG_ALPHA = 0.35;
/**
 * Temperatura ao entrar uma bola nova num mapa ja assentado: assenta so ela,
 * sem reaquecer o desenho inteiro.
 */
export const NEW_NODE_ALPHA = 0.12;
const MAX_SPEED = 4;
const CUTOFF = 260;
const CUTOFF2 = CUTOFF * CUTOFF;
/** Distancia minima entre superficies, para nao encostar. */
const COLLISION_GAP = 4;

/** Comprimento de repouso de uma ligacao. */
export function linkRest(ra: number, rb: number): number {
  'worklet';
  return (ra + rb) * 1.4 + 18;
}

/** Estado inicial: posicoes vindas do layout, tudo parado e quente. */
export function createSimState(
  bodies: SimBody[],
  seed: { x: number; y: number }[],
  alpha = 1,
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): SimState {
  const n = bodies.length;
  return {
    x: seed.map((p) => p.x),
    y: seed.map((p) => p.y),
    vx: new Array<number>(n).fill(0),
    vy: new Array<number>(n).fill(0),
    fx: new Array<number>(n).fill(0),
    fy: new Array<number>(n).fill(0),
    ax: anchor.x,
    ay: anchor.y,
    alpha,
    tick: 0,
  };
}

/**
 * Estado novo reaproveitando o que ja estava na tela.
 *
 * Quando o conjunto muda (filtro, foco, elos derivados depois da abertura), o
 * mapa nao pode voltar para a semente: as bolas conhecidas mantem posicao e
 * velocidade. So as bolas que entraram agora sao semeadas. A temperatura fica
 * como estava quando nada entrou -- atualizar um recorte nao reinicia a fisica.
 */
export function mergeSimState(
  prev: SimState | null,
  prevIds: string[] | null,
  ids: string[],
  fresh: SimState,
): SimState {
  if (!prev || !prevIds) return fresh;
  const previousIndex = new Map<string, number>();
  for (let i = 0; i < prevIds.length; i += 1) previousIndex.set(prevIds[i], i);
  const n = ids.length;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  const vx = new Array<number>(n);
  const vy = new Array<number>(n);
  let added = 0;
  for (let i = 0; i < n; i += 1) {
    const old = previousIndex.get(ids[i]);
    if (old === undefined) {
      x[i] = fresh.x[i];
      y[i] = fresh.y[i];
      vx[i] = fresh.vx[i];
      vy[i] = fresh.vy[i];
      added += 1;
      continue;
    }
    x[i] = prev.x[old];
    y[i] = prev.y[old];
    vx[i] = prev.vx[old];
    vy[i] = prev.vy[old];
  }
  return {
    ...fresh,
    x,
    y,
    vx,
    vy,
    // Bola nova merece um assentamento curto; reacender tudo fazia o mapa
    // inteiro se mexer de novo a cada atualizacao.
    alpha: added > 0 ? Math.max(prev.alpha, NEW_NODE_ALPHA) : prev.alpha,
  };
}

/**
 * Poe o no sob o dedo. A fisica roda em volta dele e a vizinhanca acompanha;
 * a temperatura sobe ao menos ate DRAG_ALPHA para o mapa nao ficar duro.
 */
export function dragNode(state: SimState, index: number, x: number, y: number): void {
  'worklet';
  if (index < 0 || index >= state.x.length) return;
  state.x[index] = x;
  state.y[index] = y;
  state.vx[index] = 0;
  state.vy[index] = 0;
  if (state.alpha < DRAG_ALPHA) state.alpha = DRAG_ALPHA;
}

/** Um passo da simulacao, em unidades do grafo. */
export function stepSimulation(
  state: SimState,
  bodies: SimBody[],
  links: SimLink[],
): void {
  'worklet';
  const n = bodies.length;
  const alpha = state.alpha;
  if (alpha <= ALPHA_MIN) {
    state.alpha = 0;
    return;
  }

  for (let i = 0; i < n; i += 1) {
    state.fx[i] = 0;
    state.fy[i] = 0;
  }

  // Repulsao entre todos os pares dentro do corte.
  for (let i = 0; i < n; i += 1) {
    const ri = bodies[i].r;
    for (let j = i + 1; j < n; j += 1) {
      let dx = state.x[i] - state.x[j];
      let dy = state.y[i] - state.y[j];
      let d2 = dx * dx + dy * dy;
      if (d2 > CUTOFF2) continue;
      if (d2 < 1) {
        // Dois corpos exatamente no mesmo ponto: separa com um desvio estavel.
        dx = ((i % 7) - 3) * 0.7 + 0.31;
        dy = ((j % 5) - 2) * 0.7 + 0.17;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      // Teto de forca por par: sem ele, duas bolas quase no mesmo ponto
      // disparam uma na outra e a abertura vira um estouro.
      const force = Math.min(5, (REPEL * (ri + bodies[j].r)) / d2);
      const ux = dx / d;
      const uy = dy / d;
      state.fx[i] += ux * force;
      state.fy[i] += uy * force;
      state.fx[j] -= ux * force;
      state.fy[j] -= uy * force;

      const min = ri + bodies[j].r + COLLISION_GAP;
      if (d < min) {
        // Correcao posicional: as bolas se separam de fato. So empurrar a
        // velocidade deixava varias encostadas quando a fisica esfriava --
        // e o desenho mostrava bolas se tocando.
        const shift = Math.min(2.5, (min - d) * 0.5);
        if (!bodies[i].pinned) {
          state.x[i] += ux * shift;
          state.y[i] += uy * shift;
        }
        if (!bodies[j].pinned) {
          state.x[j] -= ux * shift;
          state.y[j] -= uy * shift;
        }
        const push = Math.min(3, (min - d) * 0.6);
        state.fx[i] += ux * push;
        state.fy[i] += uy * push;
        state.fx[j] -= ux * push;
        state.fy[j] -= uy * push;
      }
    }
  }

  // Mola das ligacoes.
  for (let k = 0; k < links.length; k += 1) {
    const link = links[k];
    const a = bodies[link.a];
    const b = bodies[link.b];
    const dx = state.x[link.b] - state.x[link.a];
    const dy = state.y[link.b] - state.y[link.a];
    const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const rest = linkRest(a.r, b.r);
    const force = (d - rest) * SPRING;
    const ux = dx / d;
    const uy = dy / d;
    state.fx[link.a] += ux * force;
    state.fy[link.a] += uy * force;
    state.fx[link.b] -= ux * force;
    state.fy[link.b] -= uy * force;
  }

  // Ancora no centro e integracao.
  for (let i = 0; i < n; i += 1) {
    if (bodies[i].pinned) {
      state.x[i] = state.ax;
      state.y[i] = state.ay;
      state.vx[i] = 0;
      state.vy[i] = 0;
      continue;
    }
    let ax = state.fx[i] - state.x[i] * ANCHOR;
    let ay = state.fy[i] - state.y[i] * ANCHOR;
    let vx = (state.vx[i] + ax * alpha) * DAMPING;
    let vy = (state.vy[i] + ay * alpha) * DAMPING;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > MAX_SPEED) {
      vx = (vx / speed) * MAX_SPEED;
      vy = (vy / speed) * MAX_SPEED;
    }
    state.vx[i] = vx;
    state.vy[i] = vy;
    state.x[i] += vx;
    state.y[i] += vy;
  }

  state.alpha = alpha * ALPHA_DECAY;
  state.tick += 1;
}
