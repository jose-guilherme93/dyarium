/**
 * Desenho interativo do mapa (versao Skia, paridade web).
 *
 * A fisica roda na thread de UI (`useFrameCallback`) e escreve as posicoes num
 * valor compartilhado. O desenho le esse valor em poucos caminhos do Skia -- um
 * por tipo e por faixa de peso -- entao nenhum componente do React re-renderiza
 * durante o movimento: o que muda por quadro sao os caminhos, nao a arvore.
 *
 * Optimizacao de performance: arestas e nos sao caminhos construidos direto
 * com coordenadas da simulacao, sem converter string SVG nem criar uma view por
 * bola. O pan/zoom so aplicam outra matriz ao grupo.
 */
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  SharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  Canvas,
  Circle,
  Group,
  Path,
  Points,
  RoundedRect,
  SkFont,
  Skia,
  Text as SkText,
  matchFont,
} from '@shopify/react-native-skia';
import type { SkPath } from '@shopify/react-native-skia';

import type { EntityKind, GraphData, GraphNodeKind } from '@/core/graphModel';
import type { GraphLayout, VisibleBand, FittedCamera } from '@/core/graphLayout';
import { fitCamera, visibleBand } from '@/core/graphLayout';
import type { SimBody, SimLink, SimState } from '@/core/graphSim';
import { createSimState, dragNode, stepSimulation } from '@/core/graphSim';
import {
  LABEL_FONT,
  LABEL_GAP,
  LABEL_LINE_HEIGHT,
  pickLabels,
  type GraphLabel,
} from '@/core/graphLabels';
import { iconKeyFor, iconPaths } from '@/core/graphIcons';
import { neighborIds } from '@/core/graphPaths';
import { useRenderCount } from '@/dev/perf';
import { FRAME_HUD_ON, useFrameMeter, useJsFrameMeter } from '@/dev/frameMeter';
import type { GraphColors } from '@/theme/graph';

const FIT_PADDING = 4;
const FIT_MAX_ZOOM = 3.2;
/** Limites do zoom: encaixe ate 0,35x dele, teto de 4,5x. */
const MIN_ZOOM_RATIO = 0.35;
const MAX_ZOOM = 4.5;
/** Folga extra no encaixe: o conjunto assenta um pouco maior que a semente. */
const FIT_GROW = 1.22;
// Assentamento de abertura: o mapa entra 10% menor e um pouco torto e se
// acomoda em meio segundo, como a simulacao do Obsidian quando esfria. Depois
// disso nada se move e nenhum quadro e desenhado sem gesto.
const SETTLE_MS = 620;
const SETTLE_TILT = 0.014;
const SETTLE_ZOOM = 0.9;
// Quando o foco muda (clica numa relacao), a camera desliza suavemente para a
// nova posicao do desenho em vez de piscar com um pulo instantaneo.
const FOCUS_MS = 500;
const TAP_SLOP = 14;
const TAP_RADIUS = 22;
const EDGE_MARGIN = 28;
const MIN_ICON_RADIUS = 4;
const MAX_ICONS = 80;
// O nome so aparece ao aproximar, como o "text fade threshold" do Obsidian:
// no encaixe o mapa e so bolas e ligacoes; 1,15x comeca a aparecer e 1,5x ja
// esta inteiro. A opacidade e do texto (pintura), nunca de um grupo -- grupo
// com opacidade vira camada offscreen por quadro.
const LABEL_ZOOM_ON = 1.15;
/** Quanto da para arrastar o mapa fora do centro quando o desenho cabe na tela. */
const FREE_PAN = 0.3;
/**
 * Semente da fisica: o mapa nasce comprimido e se abre no primeiro segundo,
 * como o grafo do Obsidian. Sem isso as bolas ja nasciam no lugar final e a
 * fisica parecia parada.
 */
const SEED_COMPRESS = 0.62;

type GraphEdgeKind = 'cooccurrence' | 'mention' | 'relation';
const EDGE_WIDTH: Record<GraphEdgeKind, [number, number]> = {
  cooccurrence: [0.45, 1.1],
  mention: [0.4, 0.9],
  relation: [0.6, 1.8],
};
function edgeWidth(kind: GraphEdgeKind, band: number): number {
  const [thin, thick] = EDGE_WIDTH[kind];
  if (band <= 0) return thin;
  return thin + ((thick - thin) * band) / 2;
}

// Opacidade de partida por tipo de aresta, como no mapa do dashboard: a
// co-ocorrencia some no fundo, a mencao pontilhada fica legivel e a relacao
// fica no meio.
const EDGE_ALPHA: Record<GraphEdgeKind, number> = {
  cooccurrence: 0.28,
  mention: 0.5,
  relation: 0.35,
};

/**
 * Bolas de um tipo, todas num caminho so.
 *
 * O caminho e reconstruido na thread de UI a cada passo da simulacao; nada de
 * uma view (ou um <Circle>) por bola. E o mesmo principio da onda da gravacao:
 * um atributo muda por quadro em vez de N componentes.
 */
const BallLayer = memo(function BallLayer({
  indices,
  radii,
  sim,
  color,
  ring,
  opacity,
  strokeWidth,
}: {
  indices: number[];
  radii: number[];
  sim: SharedValue<SimState>;
  color: string;
  ring: string;
  opacity: number;
  strokeWidth: number;
}) {
  const builder = useMemo(() => Skia.PathBuilder.Make(), []);
  const path = useDerivedValue(() => {
    builder.reset();
    const state = sim.value;
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i];
      builder.addCircle(state.x[index], state.y[index], radii[index]);
    }
    return builder.detach();
  });
  return (
    <>
      <Path path={path} color={color} style="fill" opacity={opacity} />
      <Path path={path} color={ring} style="stroke" strokeWidth={strokeWidth} opacity={opacity} />
    </>
  );
});

/**
 * Ligações de um tipo e peso, todas num `Points` (modo linha).
 *
 * Antes cada ligação virava dois `moveTo`/`lineTo` num caminho do Skia: 850
 * chamadas JSI por quadro com 425 ligações, o que derrubava a thread de UI
 * para ~15 fps durante a fisica. `Points` leva so um array de pontos por
 * quadro, uma chamada. O tracejado da mencao virou linha fina e apagada: um
 * `DashPathEffect` obriga o Skia a recontar o caminho inteiro no CPU a cada
 * quadro, e o grafo do Obsidian nao traceja as ligacoes.
 */
const EdgeLayer = memo(function EdgeLayer({
  links,
  sim,
  color,
  opacity,
  width,
  fitZoom,
}: {
  links: SimLink[];
  sim: SharedValue<SimState>;
  color: string;
  opacity: number;
  width: number;
  fitZoom: number;
}) {
  const points = useDerivedValue(() => {
    const state = sim.value;
    const out: { x: number; y: number }[] = new Array(links.length * 2);
    for (let i = 0; i < links.length; i += 1) {
      const link = links[i];
      out[i * 2] = { x: state.x[link.a], y: state.y[link.a] };
      out[i * 2 + 1] = { x: state.x[link.b], y: state.y[link.b] };
    }
    return out;
  });
  return (
    <Points
      points={points}
      mode="lines"
      color={color}
      style="stroke"
      strokeWidth={width / (fitZoom || 1)}
      opacity={opacity}
    />
  );
});

/** Icone preso a uma bola; o centro do icone anda com a simulacao. */
const NodeIcon = memo(function NodeIcon({
  index,
  size,
  strokeWidth,
  path,
  ink,
  opacity,
  sim,
}: {
  index: number;
  size: number;
  strokeWidth: number;
  path: SkPath;
  ink: string;
  opacity: number;
  sim: SharedValue<SimState>;
}) {
  const scale = size / 24;
  const transform = useDerivedValue(() => {
    const state = sim.value;
    return [
      { translateX: state.x[index] - 12 * scale },
      { translateY: state.y[index] - 12 * scale },
      { scale },
    ];
  });
  return (
    <Path
      path={path}
      color={ink}
      style="stroke"
      strokeWidth={strokeWidth}
      strokeCap="round"
      strokeJoin="round"
      opacity={opacity}
      transform={transform}
    />
  );
});

/**
 * Rotulo em pixels de tela, com tamanho de fonte fixo.
 *
 * Desenhar o texto em unidades do grafo e deixar a camera escalar parece
 * elegante, mas o tamanho em pixels muda a cada quadro do zoom: o Skia perde o
 * cache de glifos e re-rasteriza os 48 nomes por quadro -- era isso que
 * derrubava o gesto para ~45 fps com os nomes na tela. Em pixels de tela o
 * glifo e o mesmo em todo quadro e o cache acerta sempre. Um worklet por nome
 * move o rotulo; e aritmetica, nao rasterizacao.
 */
const DrawnLabel = memo(function DrawnLabel({
  label,
  index,
  colors,
  fonts,
  band,
  fitted,
  zoom,
  panX,
  panY,
  sim,
  width,
}: {
  label: GraphLabel;
  index: number;
  colors: GraphColors;
  fonts: { regular: SkFont; bold: SkFont };
  band: VisibleBand;
  fitted: FittedCamera;
  zoom: SharedValue<number>;
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  sim: SharedValue<SimState>;
  width: number;
}) {
  const textWidth = label.text.length * LABEL_FONT * 0.56;
  const position = useDerivedValue(() => {
    const state = sim.value;
    const wx = state.x[index];
    const wy = state.y[index];
    const z = zoom.value;
    const sx = width / 2 + panX.value + (wx - fitted.originX) * z;
    const sy = band.centerY + panY.value + (wy - fitted.originY) * z;
    const sr = label.r * z;
    let tx = sx - textWidth / 2;
    let ty = sy + sr + LABEL_GAP;
    if (label.side === 'right') {
      tx = sx + sr + LABEL_GAP;
      ty = sy - LABEL_LINE_HEIGHT / 2;
    } else if (label.side === 'left') {
      tx = sx - sr - LABEL_GAP - textWidth;
      ty = sy - LABEL_LINE_HEIGHT / 2;
    } else if (label.side === 'above') {
      ty = sy - sr - LABEL_GAP - LABEL_LINE_HEIGHT;
    }
    return [{ translateX: tx + label.dx }, { translateY: ty + label.dy }];
  });

  return (
    <Group transform={position}>
      <RoundedRect
        x={0}
        y={0}
        width={textWidth + 2}
        height={LABEL_LINE_HEIGHT}
        r={2}
        color={colors.labelBackdrop}
        opacity={0.55}
      />
      <SkText
        x={0}
        y={LABEL_LINE_HEIGHT - 2}
        text={label.text}
        font={label.selected ? fonts.bold : fonts.regular}
        color={label.selected ? colors.selected : colors.label}
      />
    </Group>
  );
});

/**
 * Camada de nomes, dona do proprio estado.
 *
 * Fica como filha do Canvas: trocar a lista de nomes re-renderiza so esta
 * camada. Se o estado morasse no componente do canvas, cada aparição de nome
 * (ou cada toque de zoom) refaria a arvore inteira do Skia -- os 425 vinculos
 * e as 35 bolas -- e o gesto engasgava por ~100 ms.
 */
interface LabelLayerHandle {
  queue(zoom: number, panX: number, panY: number): void;
}

const LabelLayer = memo(
  forwardRef<
    LabelLayerHandle,
    {
      shown: GraphData;
      ids: string[];
      indexById: Map<string, number>;
      bodies: SimBody[];
      layout: GraphLayout;
      fitted: FittedCamera;
      colors: GraphColors;
      fonts: { regular: SkFont; bold: SkFont };
      band: VisibleBand;
      width: number;
      selectedId: string | null;
      zoom: SharedValue<number>;
      panX: SharedValue<number>;
      panY: SharedValue<number>;
      sim: SharedValue<SimState>;
      /** No grafo estatico o nome aparece sem gesto de zoom. */
      alwaysLabels: boolean;
      /** Na previa, so as relacoes da entidade aberta ganham nome. */
      onlyIds?: ReadonlySet<string>;
    }
  >(function LabelLayer(
    { shown, ids, indexById, bodies, layout, fitted, colors, fonts, band, width, selectedId, zoom, panX, panY, sim, alwaysLabels, onlyIds },
    ref,
  ) {
    const [labels, setLabels] = useState<GraphLabel[]>([]);
    const current = useRef<GraphLabel[]>([]);
    const camera = useRef({ zoom: fitted.zoom, panX: fitted.panX, panY: fitted.panY });
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const sync = useCallback(
      (cameraZoom: number, cameraPanX: number, cameraPanY: number) => {
        camera.current = { zoom: cameraZoom, panX: cameraPanX, panY: cameraPanY };
        const ratio = fitted.zoom > 0 ? cameraZoom / fitted.zoom : 1;
        if (!alwaysLabels && ratio < LABEL_ZOOM_ON) {
          if (current.current.length > 0) {
            current.current = [];
            setLabels([]);
          }
          return;
        }
        const state = sim.value;
        const positions: GraphLayout['positions'] = {};
        for (let i = 0; i < ids.length; i += 1) {
          positions[ids[i]] = { x: state.x[i], y: state.y[i], r: bodies[i].r };
        }
        const next = pickLabels(shown, { ...layout, positions }, {
          camera: {
            zoom: cameraZoom,
            panX: cameraPanX,
            panY: cameraPanY,
            width,
            centerY: band.centerY,
            bandTop: band.top,
            bandBottom: band.bottom,
            originX: fitted.originX,
            originY: fitted.originY,
          },
          selectedId,
          budget: 48,
          preferEntities: alwaysLabels,
          onlyIds,
          radialSides: alwaysLabels,
        });
        const previous = current.current;
        const same =
          previous.length === next.length &&
          next.every(
            (label, index) =>
              label.id === previous[index].id &&
              label.side === previous[index].side &&
              label.dx === previous[index].dx &&
              label.dy === previous[index].dy &&
              label.selected === previous[index].selected,
          );
        if (same) return;
        current.current = next;
        setLabels(next);
      },
      [shown, ids, bodies, layout, fitted, band, width, selectedId, sim, alwaysLabels, onlyIds],
    );

    const queue = useCallback(
      (cameraZoom: number, cameraPanX: number, cameraPanY: number) => {
        camera.current = { zoom: cameraZoom, panX: cameraPanX, panY: cameraPanY };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          const value = camera.current;
          sync(value.zoom, value.panX, value.panY);
        }, 60);
      },
      [sync],
    );

    useImperativeHandle(ref, () => ({ queue }), [queue]);

    useEffect(
      () => () => {
        if (timer.current) clearTimeout(timer.current);
      },
      [],
    );

    useEffect(() => {
      sync(zoom.value, panX.value, panY.value);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- o camera muda por shared value
    }, [shown, selectedId, sync]);

    return (
      <>
        {labels.map((label) => {
          const index = indexById.get(label.id) ?? -1;
          if (index < 0) return null;
          return (
            <DrawnLabel
              key={label.id}
              label={label}
              index={index}
              colors={colors}
              fonts={fonts}
              band={band}
              fitted={fitted}
              zoom={zoom}
              panX={panX}
              panY={panY}
              sim={sim}
              width={width}
            />
          );
        })}
      </>
    );
  }),
);

/**
 * Contador de quadro no canto, so em desenvolvimento. Ele tem estado proprio,
 * num componente irmao do Canvas: atualizar o numero aqui nao re-renderiza o
 * desenho (um `setState` dentro do canvas re-recorda a cena inteira).
 */
const FrameHud = memo(function FrameHud({ label }: { label: string }) {
  const [text, setText] = useState('');
  useFrameMeter(label, FRAME_HUD_ON ? setText : undefined);
  if (!FRAME_HUD_ON || !text) return null;
  return (
    <View style={styles.hud} pointerEvents="none">
      <Text style={styles.hudText}>{text}</Text>
    </View>
  );
});

export interface GraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
}

interface GraphCanvasProps {
  data: GraphData;
  layout: GraphLayout;
  colors: GraphColors;
  width: number;
  height: number;
  viewportTop?: number;
  viewportBottom?: number;
  selectedId: string | null;
  focusMode?: boolean;
  kinds: ReadonlySet<EntityKind>;
  onSelect(id: string | null): void;
  /** Quando false, o grafo é estático (sem pan/zoom/tap). */
  interactive?: boolean;
  /**
   * Mostra os nomes sem esperar zoom. A tela da entidade usa isso na previa
   * estatica, onde nao ha gesto para aproximar e o nome e a informacao.
   */
  showLabels?: boolean;
}

function clampWorklet(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

const GraphCanvasBase = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  {
    data,
    layout,
    colors,
    width,
    height,
    viewportTop = 0,
    viewportBottom = 0,
    selectedId,
    focusMode = false,
    kinds = new Set<EntityKind>(),
    onSelect,
    interactive = true,
    showLabels,
  },
  ref,
) {
  useRenderCount('GraphCanvas');
  // Numero de quadro do gesto, no aparelho: e o que fecha (ou nao) a conta de
  // fps. Em producao nao registra nada. A etiqueta identifica o aparelho no log
  // (dois clientes no mesmo Metro ficam indistinguiveis sem ela).
  const deviceTag = `${Platform.OS} ${Math.round(width)}x${Math.round(height)} @${PixelRatio.get().toFixed(2)}x`;
  // Em desenvolvimento o mesmo numero do log aparece no canto: da para ler no
  // aparelho sem adb e sem abrir o log do Metro.
  useJsFrameMeter(`mapa ${deviceTag}`);
  const band = useMemo(
    () => visibleBand(height, viewportTop, viewportBottom),
    [height, viewportTop, viewportBottom],
  );
  // A previa estatica nasce com o desenho no lugar e sem gesto: o nome tem que
  // aparecer sozinho.
  const labelsAlways = showLabels ?? !interactive;
  const visibleHeight = band.height;

  const fitted = useMemo(
    () =>
      fitCamera(
        {
          minX: layout.bounds.minX * FIT_GROW,
          minY: layout.bounds.minY * FIT_GROW,
          maxX: layout.bounds.maxX * FIT_GROW,
          maxY: layout.bounds.maxY * FIT_GROW,
        },
        width,
        visibleHeight,
        {
          padding: FIT_PADDING,
          minZoom: 0.05,
          maxZoom: FIT_MAX_ZOOM,
        },
      ),
    [layout.bounds, width, visibleHeight],
  );
  const unit = 1 / fitted.zoom;
  const margin = EDGE_MARGIN * unit;
  const zoomLimits = useMemo(
    () => ({ min: fitted.zoom * MIN_ZOOM_RATIO, max: MAX_ZOOM }),
    [fitted.zoom],
  );

  const box = useMemo(
    () => ({
      minX: layout.bounds.minX - margin,
      minY: layout.bounds.minY - margin,
      maxX: layout.bounds.maxX + margin,
      maxY: layout.bounds.maxY + margin,
    }),
    [layout.bounds, margin],
  );
  const spanX = Math.max(1, box.maxX - box.minX);
  const spanY = Math.max(1, box.maxY - box.minY);

  const zoom = useSharedValue(fitted.zoom);
  const panX = useSharedValue(fitted.panX);
  const panY = useSharedValue(fitted.panY);
  const tilt = useSharedValue(0);
  const startPanX = useSharedValue(0);
  const startPanY = useSharedValue(0);
  const pinchStart = useSharedValue({ zoom: 1, panX: 0, panY: 0, x: 0, y: 0 });

  const shown = useMemo(() => {
    const k = kinds ?? new Set<EntityKind>();
    const nodes = data.nodes.filter(
      (node) => k.has(node.kind as EntityKind) || node.id === selectedId,
    );
    if (nodes.length === data.nodes.length) return data;
    const ids = new Set<string>([data.center.id, ...nodes.map((node) => node.id)]);
    return {
      ...data,
      nodes,
      edges: data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    };
  }, [data, kinds, selectedId]);

  const selectedNeighbors = useMemo(
    () => (selectedId ? neighborIds(shown, selectedId) : new Set<string>()),
    [shown, selectedId],
  );

  // Na previa da entidade, o resto do mapa e so contexto: nome so nas relacoes
  // dela e nela mesma.
  const relationIds = useMemo(() => {
    if (!labelsAlways || !selectedId) return undefined;
    const ids = new Set<string>([selectedId]);
    for (const id of selectedNeighbors) if (id !== 'user') ids.add(id);
    return ids;
  }, [labelsAlways, selectedId, selectedNeighbors]);

  // ---- simulacao -----------------------------------------------------------

  const graph = useMemo(() => {
    const ids: string[] = [data.center.id];
    const bodies: SimBody[] = [];
    const seed: { x: number; y: number }[] = [];
    const indexById = new Map<string, number>([[data.center.id, 0]]);
    const centerPosition = layout.positions[data.center.id];
    bodies.push({ r: centerPosition?.r ?? 24, pinned: true });
    seed.push({ x: 0, y: 0 });
    for (const node of shown.nodes) {
      const position = layout.positions[node.id];
      if (!position) continue;
      indexById.set(node.id, ids.length);
      ids.push(node.id);
      bodies.push({ r: position.r, pinned: false });
      // Semente comprimida: o mapa abre menor e se abre no primeiro segundo.
      // Sem interacao (previa da entidade), o desenho ja nasce no lugar: nao
      // ha gesto para acompanhar a animacao e a fisica so gastaria quadro.
      const factor = interactive ? SEED_COMPRESS : 1;
      seed.push({ x: position.x * factor, y: position.y * factor });
    }
    const links: SimLink[] = [];
    for (const edge of shown.edges) {
      const a = indexById.get(edge.source);
      const b = indexById.get(edge.target);
      if (a === undefined || b === undefined || a === b) continue;
      links.push({ a, b });
    }
    return {
      ids,
      indexById,
      bodies,
      links,
      state: createSimState(bodies, seed, interactive ? 1 : 0),
    };
  }, [data.center, shown, layout, interactive]);

  const sim = useSharedValue<SimState>(graph.state);
  const simParams = useSharedValue({ bodies: graph.bodies, links: graph.links });
  const drag = useSharedValue({ index: -1, x: 0, y: 0 });
  const onSettled = useCallback(() => {
    if (__DEV__) console.log('[map] fisica assentou');
    labelRef.current?.queue(zoom.value, panX.value, panY.value);
  }, [zoom, panX, panY]);

  const logDrag = useCallback((index: number, dragging: boolean) => {
    if (!__DEV__) return;
    console.log(`[map] ${dragging ? 'arrastando' : 'soltou'} ${graph.ids[index] ?? index}`);
  }, [graph]);

  useEffect(() => {
    sim.value = graph.state;
    simParams.value = { bodies: graph.bodies, links: graph.links };
    drag.value = { index: -1, x: 0, y: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reinicia so quando o conjunto muda
  }, [graph]);

  // O quadro fica sempre ativo: parado, o worklet sai na primeira linha (custo
  // de um no-op), e arrastar/gesto pode esquentar a fisica sem ida e volta para
  // o JS. Desligar e religar era o que deixava o mapa duro depois de assentar.
  useFrameCallback((frame) => {
    'worklet';
    const state = sim.value;
    const dragged = drag.value;
    const dragging = dragged.index >= 0;
    if (state.alpha <= 0 && !dragging) return;
    if (dragging) {
      // O dono preso anda junto com o dedo: a vizinhanca se acomoda em volta.
      if (dragged.index === 0) {
        state.ax = dragged.x;
        state.ay = dragged.y;
      }
      dragNode(state, dragged.index, dragged.x, dragged.y);
    }
    const params = simParams.value;
    const before = state.alpha;
    // Um passo por quadro de 16,7 ms (teto de tres num quadro longo): com o
    // grafo de 120 bolas, dois passos por quadro custavam metade do orcamento
    // de 60 fps so na fisica. O alpha cai mais rapido por passo para o mapa
    // continuar assentando em ~4 s.
    const elapsed = frame.timeSincePreviousFrame ?? 16.7;
    const steps = Math.min(3, Math.max(1, Math.round(elapsed / 16.7)));
    for (let step = 0; step < steps; step += 1) {
      stepSimulation(state, params.bodies, params.links);
    }
    if (dragging) {
      dragNode(state, dragged.index, dragged.x, dragged.y);
    }
    if (before > 0 && state.alpha === 0) {
      runOnJS(onSettled)();
    }
    sim.value = { ...state, tick: state.tick + 1 };
  }, true);

  const fonts = useMemo(() => {
    const fontFamily = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });
    const regular = matchFont({ fontFamily, fontSize: LABEL_FONT, fontWeight: '500' });
    const bold = matchFont({ fontFamily, fontSize: LABEL_FONT, fontWeight: '700' });
    return { regular, bold };
  }, []);

  const firstFrame = useRef(true);
  const framed = useRef('');

  const labelRef = useRef<LabelLayerHandle>(null);
  const refreshLabels = useCallback(() => {
    labelRef.current?.queue(zoom.value, panX.value, panY.value);
  }, [zoom, panX, panY]);

  useEffect(() => {
    if (width <= 0 || visibleHeight <= 0) return;
    const frame = `${layout.key}|${width}|${visibleHeight.toFixed(0)}|${fitted.zoom.toFixed(3)}`;
    if (framed.current === frame) return;
    framed.current = frame;
    // Entra menor e torto, assenta na posicao final. Na primeira abertura
    // nada se move ate a animacao acabar; depois o mapa so desenha com gesto.
    if (firstFrame.current && !interactive) {
      firstFrame.current = false;
      zoom.value = fitted.zoom;
      tilt.value = 0;
      panX.value = fitted.panX;
      panY.value = fitted.panY;
    } else if (firstFrame.current) {
      firstFrame.current = false;
      zoom.value = fitted.zoom * SETTLE_ZOOM;
      tilt.value = SETTLE_TILT;
      panX.value = fitted.panX;
      panY.value = fitted.panY;
      zoom.value = withTiming(fitted.zoom, {
        duration: SETTLE_MS,
        easing: Easing.out(Easing.cubic),
      });
      tilt.value = withTiming(0, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) });
    } else {
      // Foco mudou: o desenho se reposicionou inteiro (espiral com a bola
      // escolhida no topo). Move a camera suavemente para a nova posicao
      // em vez de piscar a tela com um pulo instantaneo.
      panX.value = withTiming(fitted.panX, {
        duration: FOCUS_MS,
        easing: Easing.out(Easing.cubic),
      });
      panY.value = withTiming(fitted.panY, {
        duration: FOCUS_MS,
        easing: Easing.out(Easing.cubic),
      });
      zoom.value = withTiming(fitted.zoom, {
        duration: FOCUS_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
    labelRef.current?.queue(fitted.zoom, fitted.panX, fitted.panY);
  }, [
    layout.key,
    fitted,
    width,
    visibleHeight,
    zoom,
    tilt,
    panX,
    panY,
    interactive,
  ]);

  const iconByIndex = useMemo(() => {
    const out = new Map<number, { path: SkPath; size: number; ink: string }>();
    let count = 0;
    const push = (id: string, kind: GraphNodeKind, icon?: string) => {
      const index = graph.indexById.get(id);
      if (index === undefined) return;
      const body = graph.bodies[index];
      if (body.r * fitted.zoom < MIN_ICON_RADIUS) return;
      const size = Math.min(Math.max(body.r * 1.25, 8 * unit), body.r * 1.5);
      const path = Skia.Path.MakeFromSVGString(
        iconPaths(iconKeyFor(kind, icon ?? '')).join(' '),
      );
      if (!path) return;
      out.set(index, { path, size, ink: colors.ink });
    };
    push(data.center.id, 'user', data.center.icon);
    for (const node of shown.nodes) {
      if (count >= MAX_ICONS) break;
      push(node.id, node.kind, node.icon);
      count += 1;
    }
    return out;
  }, [data.center, shown, graph, fitted.zoom, unit, colors.ink]);

  const selectAt = useCallback(
    (x: number, y: number) => {
      const z = zoom.value;
      if (!(z > 0)) return;
      const state = sim.value;
      const screen = (index: number) => ({
        sx: width / 2 + panX.value + (state.x[index] - fitted.originX) * z,
        sy: band.centerY + panY.value + (state.y[index] - fitted.originY) * z,
      });
      const center = screen(0);
      if (Math.hypot(x - center.sx, y - center.sy) <= graph.bodies[0].r * z + TAP_RADIUS) {
        onSelect(data.center.id);
        return;
      }
      let best: { id: string; distance: number } | null = null;
      for (let i = 1; i < graph.ids.length; i += 1) {
        const { sx, sy } = screen(i);
        const d = Math.hypot(x - sx, y - sy);
        if (d > graph.bodies[i].r * z + TAP_RADIUS) continue;
        if (!best || d < best.distance) best = { id: graph.ids[i], distance: d };
      }
      onSelect(best?.id ?? null);
    },
    [band.centerY, data.center.id, fitted.originX, fitted.originY, graph, onSelect, panX, panY, sim, width, zoom],
  );

  const radii = useMemo(() => graph.bodies.map((body) => body.r), [graph]);

  const gestures = useMemo(() => {
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(3)
      .onStart((event) => {
        // Dedo em cima de uma bola: arrasta a bola. Dedo no fundo: move o mapa.
        const z = zoom.value;
        const state = sim.value;
        let hit = -1;
        for (let i = graph.ids.length - 1; i >= 0; i -= 1) {
          const sx = width / 2 + panX.value + (state.x[i] - fitted.originX) * z;
          const sy = band.centerY + panY.value + (state.y[i] - fitted.originY) * z;
          const radius = radii[i] * z + TAP_RADIUS;
          const dx = event.x - sx;
          const dy = event.y - sy;
          if (dx * dx + dy * dy <= radius * radius) {
            hit = i;
            break;
          }
        }
        if (hit >= 0) {
          drag.value = { index: hit, x: state.x[hit], y: state.y[hit] };
          // Acorda a fisica na hora; o worklet aplica a posicao do dedo.
          sim.value = { ...state, alpha: Math.max(state.alpha, 1) };
          runOnJS(logDrag)(hit, true);
          return;
        }
        startPanX.value = panX.value;
        startPanY.value = panY.value;
      })
      .onUpdate((event) => {
        const dragged = drag.value;
        if (dragged.index >= 0) {
          const z = zoom.value;
          const x = fitted.originX + (event.x - width / 2 - panX.value) / z;
          const y = fitted.originY + (event.y - band.centerY - panY.value) / z;
          drag.value = { index: dragged.index, x, y };
          return;
        }
        // Folga de arrasto mesmo quando o desenho cabe inteiro na tela: o
        // Obsidian deixa mover o mapa sempre, e antes o arrasto ficava travado
        // no encaixe (o limite virava zero).
        const scale = zoom.value;
        const limitX = Math.max(0, (spanX * scale - width) / 2) + width * FREE_PAN;
        const limitY = Math.max(0, (spanY * scale - visibleHeight) / 2) + visibleHeight * FREE_PAN;
        panX.value = clampWorklet(startPanX.value + event.translationX, -limitX, limitX);
        panY.value = clampWorklet(startPanY.value + event.translationY, -limitY, limitY);
      })
      .onFinalize(() => {
        const dragged = drag.value;
        if (dragged.index < 0) return;
        drag.value = { index: -1, x: 0, y: 0 };
        // Solta quente: as bolas ligadas se acomodam em volta do novo lugar.
        const state = sim.value;
        sim.value = { ...state, alpha: 1 };
        runOnJS(logDrag)(dragged.index, false);
        if (dragged.index === 0) {
          // O dono foi solto longe do centro do mundo: a camera desliza ate
          // ele em vez de deixar a bola fora da tela.
          const z = zoom.value;
          panX.value = withTiming(-(dragged.x - fitted.originX) * z, {
            duration: 420,
            easing: Easing.out(Easing.cubic),
          });
          panY.value = withTiming(-(dragged.y - fitted.originY) * z, {
            duration: 420,
            easing: Easing.out(Easing.cubic),
          });
        }
      });
    const pinch = Gesture.Pinch()
      .onStart((event) => {
        pinchStart.value = {
          zoom: zoom.value,
          panX: panX.value,
          panY: panY.value,
          x: event.focalX,
          y: event.focalY,
        };
      })
      .onUpdate((event) => {
        const start = pinchStart.value;
        const next = clampWorklet(start.zoom * event.scale, zoomLimits.min, zoomLimits.max);
        const ratio = next / start.zoom;
        const localX = start.x - width / 2;
        const localY = start.y - band.centerY;
        const scale = next;
        const limitX = Math.max(0, (spanX * scale - width) / 2) + width * FREE_PAN;
        const limitY = Math.max(0, (spanY * scale - visibleHeight) / 2) + visibleHeight * FREE_PAN;
        panX.value = clampWorklet(localX - (localX - start.panX) * ratio, -limitX, limitX);
        panY.value = clampWorklet(localY - (localY - start.panY) * ratio, -limitY, limitY);
        zoom.value = next;
      })
      .onEnd(() => {
        runOnJS(refreshLabels)();
      });
    // O tap e exclusivo com pan/pinch: enquanto o usuario arrasta ou faz
    // pinça, nenhum clique e disparado. Isso evita selecionar uma bola
    // acidentalmente ao terminar um gesto de dois dedos.
    const tap = Gesture.Tap()
      .maxDistance(TAP_SLOP)
      .maxDuration(320)
      .onEnd((event, success) => {
        if (success) runOnJS(selectAt)(event.x, event.y);
      });
    return Gesture.Exclusive(Gesture.Simultaneous(pan, pinch), tap);
  }, [panX, panY, startPanX, startPanY, pinchStart, zoom, width, visibleHeight, band.centerY, spanX, spanY, zoomLimits, selectAt, refreshLabels, drag, graph, radii, fitted, sim, logDrag]);

  const animateZoom = useCallback(
    (next: number) => {
      const target = Math.min(Math.max(next, zoomLimits.min), zoomLimits.max);
      const ratio = target / zoom.value;
      const limits = { limitX: Math.max(0, (spanX * target - width) / 2), limitY: Math.max(0, (spanY * target - visibleHeight) / 2) };
      const nextPanX = Math.min(Math.max(panX.value * ratio, -limits.limitX), limits.limitX);
      const nextPanY = Math.min(Math.max(panY.value * ratio, -limits.limitY), limits.limitY);
      // Animacao de valores compartilhados: roda inteira na thread de UI, sem
      // um unico render nem um worklet de rotulo por quadro.
      const animation = { duration: 180, easing: Easing.out(Easing.cubic) };
      zoom.value = withTiming(target, animation);
      panX.value = withTiming(nextPanX, animation);
      panY.value = withTiming(nextPanY, animation);
      labelRef.current?.queue(target, nextPanX, nextPanY);
    },
    [zoom, zoomLimits, panX, panY, width, visibleHeight, spanX, spanY],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => animateZoom(zoom.value * 2),
      zoomOut: () => animateZoom(zoom.value / 2),
      fit() {
        // Volta o dono para o centro do mundo, senao o encaixe fica torto
        // depois de arrastar a bola do dono. Sem dono fora do lugar, encaixar
        // e so camera: reaquecer a fisica aqui fazia o mapa inteiro pular de
        // novo a cada toque no alvo.
        const state = sim.value;
        if (state.ax !== 0 || state.ay !== 0) {
          sim.value = { ...state, ax: 0, ay: 0, alpha: 1 };
        }
        const animation = { duration: 220, easing: Easing.out(Easing.cubic) };
        zoom.value = withTiming(fitted.zoom, animation);
        panX.value = withTiming(fitted.panX, animation);
        panY.value = withTiming(fitted.panY, animation);
        labelRef.current?.queue(fitted.zoom, fitted.panX, fitted.panY);
      },
    }),
    [animateZoom, zoom, panX, panY, fitted, sim],
  );

  const kindColor = useMemo<Record<GraphNodeKind, string>>(
    () => ({
      user: colors.user,
      person: colors.person,
      place: colors.place,
      theme: colors.theme,
      decision: colors.decision,
      note: colors.note,
    }),
    [colors],
  );

  const dimmed = Boolean(selectedId) && !focusMode;
  // Opacidades do mapa do dashboard: a bola em foco fica cheia, a vizinhanca
  // em 72% e o resto quase some.
  const idleNodeOpacity = dimmed ? 0.25 : 0.8;
  const z = fitted.zoom;

  const activeIds = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set(selectedNeighbors);
    ids.add(selectedId);
    return ids;
  }, [selectedId, selectedNeighbors]);

  // Agrupamento por tipo e por camada (acesa/apagada). Muda com o filtro e com
  // a selecao, nunca com a simulacao.
  const ballLayers = useMemo(() => {
    const base: Record<GraphNodeKind, number[]> = {
      user: [], person: [], place: [], theme: [], decision: [], note: [],
    };
    const lit: Record<GraphNodeKind, number[]> = {
      user: [], person: [], place: [], theme: [], decision: [], note: [],
    };
    // O dono e so a maior bola do desenho: entra na mesma camada -- e com a
    // mesma cor -- da segunda maior bola, so que o dobro do tamanho. Nada de
    // disco translucido nem de branco a parte.
    let donorKind: GraphNodeKind = 'person';
    let donorRadius = -1;
    for (const node of shown.nodes) {
      const index = graph.indexById.get(node.id);
      if (index === undefined) continue;
      if (graph.bodies[index].r > donorRadius) {
        donorRadius = graph.bodies[index].r;
        donorKind = node.kind;
      }
    }
    base[donorKind].push(0);
    if (!dimmed || activeIds?.has(data.center.id)) lit[donorKind].push(0);
    for (const node of shown.nodes) {
      const index = graph.indexById.get(node.id);
      if (index === undefined) continue;
      base[node.kind].push(index);
      if (!dimmed || activeIds?.has(node.id)) lit[node.kind].push(index);
    }
    return { base, lit };
  }, [shown, graph, dimmed, activeIds, data.center.id]);

  const edgeLayers = useMemo(() => {
    const buckets = new Map<
      string,
      { kind: GraphEdgeKind; band: number; links: SimLink[] }
    >();
    for (const edge of shown.edges) {
      const a = graph.indexById.get(edge.source);
      const b = graph.indexById.get(edge.target);
      if (a === undefined || b === undefined || a === b) continue;
      const band = edge.weight > 2 ? 2 : edge.weight > 1 ? 1 : 0;
      const key = `${edge.kind}:${band}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { kind: edge.kind, band, links: [] };
        buckets.set(key, bucket);
      }
      bucket.links.push({ a, b });
    }
    return Array.from(buckets.entries()).map(([key, value]) => ({ key, ...value }));
  }, [shown, graph]);

  const selectedLinks = useMemo(() => {
    if (!selectedId) return [];
    const index = graph.indexById.get(selectedId);
    if (index === undefined) return [];
    return graph.links.filter((link) => link.a === index || link.b === index);
  }, [selectedId, graph]);

  const centerTransform = useDerivedValue(() => [
    { translateX: width / 2 + panX.value },
    { translateY: band.centerY + panY.value },
    { rotate: tilt.value },
    { scale: zoom.value },
    { translateX: -fitted.originX },
    { translateY: -fitted.originY },
  ]);
  const selectedIndex = selectedId ? graph.indexById.get(selectedId) ?? -1 : -1;
  const selectedX = useDerivedValue(() =>
    selectedIndex >= 0
      ? sim.value.x[selectedIndex]
      : 0,
  );
  const selectedY = useDerivedValue(() =>
    selectedIndex >= 0
      ? sim.value.y[selectedIndex]
      : 0,
  );
  const selectedR = useDerivedValue(() =>
    selectedIndex >= 0 ? radii[selectedIndex] + 5 / z : 0,
  );

  const canvas = (
    <View style={StyleSheet.absoluteFill} collapsable={false}>
      <Canvas style={{ width, height }}>
        <Group transform={centerTransform}>
          {/* arestas: um caminho por tipo e faixa de peso */}
          {edgeLayers.map((layer) => (
            <EdgeLayer
              key={layer.key}
              links={layer.links}
              sim={sim}
              color={colors.edge}
              opacity={dimmed ? (activeIds?.size ? 0.18 : 0.1) : EDGE_ALPHA[layer.kind]}
              width={edgeWidth(layer.kind, layer.band)}
              fitZoom={fitted.zoom}
            />
          ))}
          {selectedLinks.length > 0 ? (
            <EdgeLayer
              links={selectedLinks}
              sim={sim}
              color={colors.edgeStrong}
              opacity={0.9}
              width={2.2}
              fitZoom={fitted.zoom}
            />
          ) : null}
          {/* bolas: um caminho por tipo e opacidade */}
          {dimmed
            ? (Object.keys(ballLayers.base) as GraphNodeKind[]).map((kind) => (
                <BallLayer
                  key={`dim-${kind}`}
                  indices={ballLayers.base[kind]}
                  radii={radii}
                  sim={sim}
                      color={kindColor[kind]}
                  ring={colors.labelBackdrop}
                  opacity={0.12}
                  strokeWidth={1.1 / z}
                />
              ))
            : null}
          {(Object.keys(ballLayers.lit) as GraphNodeKind[]).map((kind) => (
            <BallLayer
              key={`lit-${kind}`}
              indices={ballLayers.lit[kind]}
              radii={radii}
              sim={sim}
              color={kindColor[kind]}
              ring={colors.labelBackdrop}
              opacity={dimmed ? 0.8 : idleNodeOpacity}
              strokeWidth={1.1 / z}
            />
          ))}
          {/* anel da bola escolhida */}
          {selectedId ? (
            <Circle
              cx={selectedX}
              cy={selectedY}
              r={selectedR}
              color={colors.selected}
              style="stroke"
              strokeWidth={1.4 / z}
              opacity={0.85}
            />
          ) : null}
          {/* icones */}
          {Array.from(iconByIndex.entries()).map(([index, icon]) => (
            <NodeIcon
              key={graph.ids[index]}
              index={index}
              size={icon.size}
              strokeWidth={1.35 / ((icon.size / 24) * z)}
              path={icon.path}
              // O dono e branco: o icone dele precisa do fundo escuro para ler.
              ink={index === 0 ? colors.labelBackdrop : icon.ink}
              opacity={
                dimmed && !(activeIds?.has(graph.ids[index]) ?? false) ? 0.12 : 0.92
              }
              sim={sim}
            />
          ))}
        </Group>
        {/* Nomes em pixels de tela, com estado proprio: trocar a lista nao
            re-renderiza as bolas nem as arestas. */}
        <LabelLayer
          ref={labelRef}
          shown={shown}
          ids={graph.ids}
          indexById={graph.indexById}
          bodies={graph.bodies}
          layout={layout}
          fitted={fitted}
          colors={colors}
          fonts={fonts}
          band={band}
          width={width}
          selectedId={selectedId}
          zoom={zoom}
          panX={panX}
          panY={panY}
          sim={sim}
          alwaysLabels={labelsAlways}
          onlyIds={relationIds}
        />
      </Canvas>
      <FrameHud label={`grafo ${deviceTag}`} />
    </View>
  );

  return interactive ? (
    <GestureDetector gesture={gestures}>{canvas}</GestureDetector>
  ) : (
    canvas
  );
});

const styles = StyleSheet.create({
  hud: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hudText: { color: '#9be89b', fontSize: 10, fontVariant: ['tabular-nums'] },
});

export const GraphCanvas = memo(GraphCanvasBase);
