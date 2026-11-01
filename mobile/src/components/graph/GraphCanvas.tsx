/**
 * Desenho interativo do mapa.
 *
 * O mapa e UM desenho: bolas, icones, linhas e nomes em unidades do grafo. A
 * camera (pan e zoom) so aplica outra matriz ao container nativo, entao o
 * React nao redesenha nada durante nem depois do gesto -- ampliar e reduzir e
 * zoom em pixels, nao recalculo de posicao.
 *
 * O gesto roda em worklet, na thread de UI, e o toque so vence quando nao
 * houve arrasto nem pinca: passar o dedo nunca abre uma bola.
 *
 * O mapa ocupa a faixa visivel acima da folha: o centro do encaixe e o meio
 * dessa faixa, nao o meio da tela inteira.
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
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import type { EntityKind, GraphData, GraphNodeKind } from '@/core/graphModel';
import type { GraphLayout } from '@/core/graphLayout';
import { clamp, fitCamera, panLimits, visibleBand } from '@/core/graphLayout';
import {
  LABEL_FONT,
  LABEL_GAP,
  LABEL_LINE_HEIGHT,
  labelWidth,
  pickLabels,
  type GraphLabel,
  type LabelSide,
} from '@/core/graphLabels';
import { iconKeyFor, iconPaths } from '@/core/graphIcons';
import {
  EDGE_BANDS,
  graphPaths,
  neighborIds,
  selectedEdgesPath,
} from '@/core/graphPaths';
import { useRenderCount } from '@/dev/perf';
import type { GraphColors } from '@/theme/graph';

/** Zoom minimo absoluto; o minimo real e sempre o encaixe do conjunto. */
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3.2;
/** Encaixe: o desenho inteiro cabe, com uma margem curta para os rotulos. */
const FIT_PADDING = 12;
const FIT_MAX_ZOOM = 1.4;
const TAP_SLOP = 14;
/** Folga do toque em volta da bola, em pt de tela: 44 pt e o alvo minimo. */
const TAP_RADIUS = 22;
/** Folga em volta do desenho, em pt de tela, para o nome nao ser cortado. */
const EDGE_MARGIN = 28;
/** Bola menor que isso no encaixe nao mostra icone (vira poeira). */
const MIN_ICON_RADIUS = 4;
/** Teto de icones desenhados. */
const MAX_ICONS = 80;
/** Ordem de desenho das arestas: da mais fraca para a mais forte. */
const EDGE_KINDS = ['cooccurrence', 'mention', 'relation'] as const;
/** Grossura da faixa mais fina e da mais grossa, em unidades do grafo. */
const EDGE_WIDTH: Record<(typeof EDGE_KINDS)[number], [number, number]> = {
  cooccurrence: [0.45, 1.1],
  mention: [0.4, 0.9],
  relation: [0.6, 1.8],
};

/** Grossura da faixa: a proximidade entre as duas bolas. */
function edgeWidth(kind: (typeof EDGE_KINDS)[number], band: number): number {
  const [thin, thick] = EDGE_WIDTH[kind];
  if (EDGE_BANDS <= 1) return thin;
  return thin + ((thick - thin) * band) / (EDGE_BANDS - 1);
}

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
  /** Topo da faixa visivel (abaixo do cabecalho). */
  viewportTop?: number;
  /** Topo da folha: o mapa encaixa entre `viewportTop` e este valor. */
  viewportBottom?: number;
  selectedId: string | null;
  /**
   * A visao ja e o foco de uma entidade: tudo o que esta nela e relacao dela,
   * entao nada fica apagado. A bola escolhida continua com o anel.
   */
  focusMode?: boolean;
  /** Tipos visiveis. Esconder um tipo nao mexe no layout: so nao o desenha. */
  kinds: ReadonlySet<EntityKind>;
  onSelect(id: string | null): void;
}

function clampWorklet(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/**
 * Largura fixa de cada vaga de nome. Cobre o rotulo mais longo que o mapa
 * mostra (26 caracteres), entao o texto nunca quebra nem e cortado.
 */
const LABEL_BOX = Math.ceil(labelWidth('x'.repeat(26))) + 4;

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: LABEL_BOX,
    height: LABEL_LINE_HEIGHT,
    justifyContent: 'center',
  },
  labelText: {
    fontSize: LABEL_FONT,
    lineHeight: LABEL_LINE_HEIGHT,
    fontWeight: '500',
    paddingHorizontal: 2,
    borderRadius: 3,
  },
  labelSelected: { fontWeight: '700' },
  labelCenter: { textAlign: 'center', alignSelf: 'center' },
  labelLeft: { textAlign: 'right', alignSelf: 'flex-end' },
  labelRight: { textAlign: 'left', alignSelf: 'flex-start' },
});

/**
 * Um nome do mapa. O texto tem tamanho de tela; a posicao vem da bola, em
 * unidades do grafo, calculada na thread de UI a cada quadro. Assim o nome
 * acompanha a bola no gesto sem crescer junto com o zoom.
 *
 * E uma view comum, nao um no de SVG: o `react-native-svg` joga fora o bitmap
 * da cena inteira a cada prop que muda, e um nome por quadro custava um
 * redesenho de tela cheia por nome. Aqui o gesto so troca a matriz da view.
 *
 * As props sao primitivas de proposito: quando o conjunto muda, so os nomes
 * que realmente mudaram sao renderizados de novo.
 */
const MapLabel = memo(function MapLabel({
  text,
  x,
  y,
  r,
  side,
  selected,
  zoom,
  panX,
  panY,
  originX,
  originY,
  centerY,
  width,
  color,
  selectedColor,
  backdrop,
}: {
  text: string | null;
  x: number;
  y: number;
  r: number;
  side: LabelSide;
  selected: boolean;
  zoom: { value: number };
  panX: { value: number };
  panY: { value: number };
  originX: number;
  originY: number;
  centerY: number;
  width: number;
  color: string;
  selectedColor: string;
  backdrop: string;
}) {
  const animated = useAnimatedStyle(() => {
    if (!text) {
      // Vaga sem nome: parada fora da tela, sem custo por quadro.
      return {
        opacity: 0,
        transform: [{ translateX: -LABEL_BOX }, { translateY: -LABEL_BOX }],
      };
    }
    const z = zoom.value;
    const sx = width / 2 + panX.value + (x - originX) * z;
    const sy = centerY + panY.value + (y - originY) * z;
    const sr = r * z;
    // A caixa e a mesma de `labelBox` em graphLabels: centro (ou borda) na
    // ancora do nome, com a altura de uma linha.
    let dx = sx - LABEL_BOX / 2;
    let dy = sy + sr + LABEL_GAP;
    if (side === 'above') {
      dy = sy - sr - LABEL_GAP - LABEL_LINE_HEIGHT;
    } else if (side === 'right') {
      dx = sx + sr + LABEL_GAP;
      dy = sy - LABEL_LINE_HEIGHT / 2;
    } else if (side === 'left') {
      dx = sx - sr - LABEL_GAP - LABEL_BOX;
      dy = sy - LABEL_LINE_HEIGHT / 2;
    }
    return {
      opacity: 1,
      transform: [{ translateX: dx }, { translateY: dy }],
    };
  });
  return (
    <Animated.View style={[styles.label, animated]}>
      <Text
        style={[
          styles.labelText,
          side === 'right'
            ? styles.labelRight
            : side === 'left'
              ? styles.labelLeft
              : styles.labelCenter,
          { color: selected ? selectedColor : color, backgroundColor: backdrop },
          selected ? styles.labelSelected : null,
        ]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {text ?? ''}
      </Text>
    </Animated.View>
  );
});

/** Vagas fixas de nome: entram e saem por props, nunca por montagem. */
const LABEL_SLOTS = 24;

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
    kinds,
    onSelect,
  },
  ref,
) {
  useRenderCount('GraphCanvas');
  // Faixa util: do topo do conteudo ate a borda da folha.
  const band = useMemo(
    () => visibleBand(height, viewportTop, viewportBottom),
    [height, viewportTop, viewportBottom],
  );
  const visibleHeight = band.height;

  const fitted = useMemo(
    () =>
      fitCamera(layout.bounds, width, visibleHeight, {
        padding: FIT_PADDING,
        minZoom: MIN_ZOOM,
        maxZoom: FIT_MAX_ZOOM,
      }),
    [layout.bounds, width, visibleHeight],
  );
  // Um ponto de tela em unidades do grafo, no encaixe.
  const unit = 1 / fitted.zoom;
  const margin = EDGE_MARGIN * unit;

  // Caixa do desenho: as bolas mais a folga dos nomes. Tudo e desenhado nesse
  // espaco, e o zoom so amplia.
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

  // Camera atual, so na thread de UI. Nenhum estado do React muda por gesto.
  const zoom = useSharedValue(fitted.zoom);
  const panX = useSharedValue(fitted.panX);
  const panY = useSharedValue(fitted.panY);
  const startPanX = useSharedValue(0);
  const startPanY = useSharedValue(0);
  const pinchStart = useSharedValue({ zoom: 1, panX: 0, panY: 0, x: 0, y: 0 });

  const cameraStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: panX.value },
      { translateY: panY.value },
      { scale: zoom.value },
    ],
  }));

  // Filtro por tipo sem tocar no layout: as bolas escondidas continuam nas
  // posicoes em que estavam, entao desligar "lugar" nao refaz a fisica nem o
  // encaixe -- some o desenho delas e mais nada.
  const shown = useMemo(() => {
    const nodes = data.nodes.filter(
      (node) => kinds.has(node.kind as EntityKind) || node.id === selectedId,
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

  // Nomes: quais aparecem depende de quanto espaco existe **agora**. A
  // escolha roda no fim do gesto, uma vez, e so troca os textos quando o
  // conjunto muda de verdade.
  const [labels, setLabels] = useState<GraphLabel[]>([]);
  const labelsRef = useRef<GraphLabel[]>([]);

  // A camera que a escolha dos nomes ve. Vem por parametro de proposito: logo
  // depois de escrever num shared value, ler `.value` no JS ainda devolve o
  // valor anterior (a escrita so chega na thread de UI depois), e os nomes
  // ficariam com a camera velha.
  // Ultima camera entregue a escolha de nomes: o filtro por tipo muda o
  // conjunto, nao a camera, e precisa repintar os nomes com a mesma.
  const cameraRef = useRef({ zoom: fitted.zoom, panX: fitted.panX, panY: fitted.panY });

  const syncLabels = useCallback((cameraZoom: number, cameraPanX: number, cameraPanY: number) => {
    cameraRef.current = { zoom: cameraZoom, panX: cameraPanX, panY: cameraPanY };
    const next = pickLabels(shown, layout, {
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
    });
    const previous = labelsRef.current;
    const same =
      previous.length === next.length &&
      next.every(
        (label, index) =>
          label.id === previous[index].id && label.selected === previous[index].selected,
      );
    if (same) return;
    labelsRef.current = next;
    setLabels(next);
  }, [
    shown,
    layout,
    width,
    band.top,
    band.bottom,
    band.centerY,
    fitted.originX,
    fitted.originY,
    selectedId,
  ]);

  // Esconder um tipo troca o conjunto de nomes sem mexer na camera: repinta com
  // a ultima camera conhecida. A escolha nao depende de ler shared value no JS.
  useEffect(() => {
    const camera = cameraRef.current;
    syncLabels(camera.zoom, camera.panX, camera.panY);
  }, [shown, selectedId, syncLabels]);

  // Encaixe quando o conjunto muda (filtro, foco, tamanho ou folha). Uma troca
  // de bola nao passa por aqui: quem anima a camera nesse caso e o efeito
  // abaixo, senao o encaixe pulava por cima da animacao.
  const framed = useRef('');
  useEffect(() => {
    if (width <= 0 || visibleHeight <= 0) return;
    const frame = `${layout.key}|${width}|${visibleHeight.toFixed(0)}|${fitted.zoom.toFixed(3)}`;
    if (framed.current === frame) return;
    framed.current = frame;
    if (__DEV__) {
      console.log(
        `[map] camera ${spanX.toFixed(0)}x${spanY.toFixed(0)} zoom ${fitted.zoom.toFixed(3)} band ${width}x${visibleHeight.toFixed(0)}`,
      );
    }
    zoom.value = fitted.zoom;
    panX.value = fitted.panX;
    panY.value = fitted.panY;
    syncLabels(fitted.zoom, fitted.panX, fitted.panY);
  }, [layout.key, fitted, width, visibleHeight, spanX, spanY, zoom, panX, panY, syncLabels]);

  // O desenho inteiro, uma vez por conjunto: nada aqui depende da camera.
  const paths = useMemo(() => graphPaths(shown, layout), [shown, layout]);
  const selectedEdgePath = useMemo(
    () => (selectedId ? selectedEdgesPath(shown, layout, selectedId) : ''),
    [shown, layout, selectedId],
  );
  // A bola escolhida e as vizinhas ficam vivas; o resto vira sombra.
  const activeIds = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set(selectedNeighbors);
    ids.add(selectedId);
    return ids;
  }, [selectedId, selectedNeighbors]);
  const highlighted = useMemo(
    () => (activeIds ? graphPaths(shown, layout, activeIds).nodes : null),
    [shown, layout, activeIds],
  );

  // Icones proporcionais a bola, em unidades do grafo: o zoom nao muda nada.
  const iconNodes = useMemo(() => {
    const out: {
      id: string;
      kind: GraphNodeKind;
      icon?: string;
      x: number;
      y: number;
      size: number;
    }[] = [];
    const push = (id: string, kind: GraphNodeKind, icon?: string) => {
      const position = layout.positions[id];
      if (!position) return;
      if (position.r * fitted.zoom < MIN_ICON_RADIUS) return;
      const size = Math.min(
        clamp(position.r * 1.25, 8 * unit, 18 * unit),
        position.r * 1.5,
      );
      out.push({ id, kind, icon, x: position.x, y: position.y, size });
    };
    push(data.center.id, 'user', data.center.icon);
    for (const node of shown.nodes) {
      if (out.length >= MAX_ICONS) break;
      push(node.id, node.kind, node.icon);
    }
    return out;
  }, [data.center, shown, layout, fitted.zoom, unit]);

  const selectAt = useCallback(
    (x: number, y: number) => {
      const z = zoom.value;
      const gx = fitted.originX + (x - width / 2 - panX.value) / z;
      const gy = fitted.originY + (y - band.centerY - panY.value) / z;
      const center = layout.positions[data.center.id];
      if (center) {
        const d = Math.hypot(gx - center.x, gy - center.y);
        if (d <= center.r + TAP_RADIUS / z) {
          onSelect(data.center.id);
          return;
        }
      }
      let best: { id: string; distance: number } | null = null;
      for (const node of shown.nodes) {
        const position = layout.positions[node.id];
        if (!position) continue;
        const d = Math.hypot(gx - position.x, gy - position.y);
        if (d > position.r + TAP_RADIUS / z) continue;
        if (!best || d < best.distance) best = { id: node.id, distance: d };
      }
      onSelect(best?.id ?? null);
    },
    [
      data.center,
      shown,
      layout,
      width,
      band.centerY,
      fitted.originX,
      fitted.originY,
      panX,
      panY,
      zoom,
      onSelect,
    ],
  );

  const gestures = useMemo(() => {
    const minZoom = fitted.zoom;

    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(3)
      .onStart(() => {
        startPanX.value = panX.value;
        startPanY.value = panY.value;
      })
      .onUpdate((event) => {
        const limitX = Math.max(0, (spanX * zoom.value - width) / 2);
        const limitY = Math.max(0, (spanY * zoom.value - visibleHeight) / 2);
        panX.value = clampWorklet(startPanX.value + event.translationX, -limitX, limitX);
        panY.value = clampWorklet(startPanY.value + event.translationY, -limitY, limitY);
      })
      .onEnd(() => {
        runOnJS(syncLabels)(zoom.value, panX.value, panY.value);
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
        const next = clampWorklet(start.zoom * event.scale, minZoom, MAX_ZOOM);
        const ratio = next / start.zoom;
        // Mantem parado o ponto que esta entre os dedos.
        const localX = start.x - width / 2;
        const localY = start.y - band.centerY;
        const limitX = Math.max(0, (spanX * next - width) / 2);
        const limitY = Math.max(0, (spanY * next - visibleHeight) / 2);
        panX.value = clampWorklet(
          localX - (localX - start.panX) * ratio,
          -limitX,
          limitX,
        );
        panY.value = clampWorklet(
          localY - (localY - start.panY) * ratio,
          -limitY,
          limitY,
        );
        zoom.value = next;
      })
      .onEnd(() => {
        runOnJS(syncLabels)(zoom.value, panX.value, panY.value);
      });

    // Toque so vence quando nenhum arrasto/pinca aconteceu: Exclusive garante
    // que passar o dedo ou usar dois dedos nunca abre uma bola.
    const tap = Gesture.Tap()
      .maxDistance(TAP_SLOP)
      .maxDuration(320)
      .onEnd((event, success) => {
        if (success) runOnJS(selectAt)(event.x, event.y);
      });

    return Gesture.Simultaneous(pinch, Gesture.Exclusive(pan, tap));
  }, [
    panX,
    panY,
    startPanX,
    startPanY,
    pinchStart,
    zoom,
    width,
    visibleHeight,
    band.centerY,
    spanX,
    spanY,
    fitted.zoom,
    selectAt,
    syncLabels,
  ]);

  /** Zoom pelos botoes, parado no centro da faixa. */
  const animateZoom = useCallback(
    (next: number) => {
      const target = clamp(next, fitted.zoom, MAX_ZOOM);
      const ratio = target / zoom.value;
      const limits = panLimits(layout.bounds, target, width, visibleHeight);
      const nextPanX = clamp(panX.value * ratio, -limits.limitX, limits.limitX);
      const nextPanY = clamp(panY.value * ratio, -limits.limitY, limits.limitY);
      zoom.value = target;
      panX.value = nextPanX;
      panY.value = nextPanY;
      syncLabels(target, nextPanX, nextPanY);
    },
    [zoom, panX, panY, layout.bounds, width, visibleHeight, fitted.zoom, syncLabels],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => animateZoom(zoom.value * 1.6),
      zoomOut: () => animateZoom(zoom.value / 1.6),
      fit() {
        zoom.value = fitted.zoom;
        panX.value = fitted.panX;
        panY.value = fitted.panY;
        syncLabels(fitted.zoom, fitted.panX, fitted.panY);
      },
    }),
    [animateZoom, zoom, panX, panY, fitted, syncLabels],
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

  const center = layout.positions[data.center.id];
  const selectedPosition = selectedId ? layout.positions[selectedId] : undefined;
  const dimmed = Boolean(selectedId) && !focusMode;
  const idleNodeOpacity = dimmed ? 0.16 : 0.82;
  // Espessuras em unidades do grafo: o encaixe e a referencia, o zoom amplia.
  const z = fitted.zoom;

  // O desenho e o mesmo enquanto o conjunto nao muda: um gesto nao remonta
  // bolas, icones nem linhas. So os nomes podem mudar entre um gesto e outro.
  const scene = useMemo(
    () => (
      <>
        {/* A cor nao diz nada: a grossura mostra a proximidade. Uma linha por
            faixa de peso, sempre na cor do texto do tema. */}
        {EDGE_KINDS.map((kind) =>
          paths.edges[kind].map((d, band) =>
            d ? (
              <Path
                key={`${kind}-${band}`}
                d={d}
                stroke={colors.edge}
                strokeWidth={edgeWidth(kind, band) / z}
                strokeDasharray={kind === 'mention' ? `${5 / z} ${4 / z}` : undefined}
                fill="none"
                opacity={
                  kind === 'mention'
                    ? dimmed
                      ? 0.18
                      : 0.3
                    : dimmed
                      ? 0.1
                      : 0.22
                }
              />
            ) : null,
          ),
        )}

        {(Object.keys(paths.nodes) as GraphNodeKind[]).map((kind) => (
          <Path
            key={kind}
            d={paths.nodes[kind]}
            fill={kindColor[kind]}
            opacity={idleNodeOpacity}
          />
        ))}

        {highlighted
          ? (Object.keys(highlighted) as GraphNodeKind[]).map((kind) => (
              <Path
                key={`hi-${kind}`}
                d={highlighted[kind]}
                fill={kindColor[kind]}
                opacity={0.95}
              />
            ))
          : null}

        {center ? (
          <>
            <Circle
              cx={center.x}
              cy={center.y}
              r={center.r + 6 / z}
              fill="none"
              stroke={colors.edgeStrong}
              strokeWidth={1 / z}
              opacity={0.5}
            />
            <Circle
              cx={center.x}
              cy={center.y}
              r={center.r + 12 / z}
              fill="none"
              stroke={colors.edge}
              strokeWidth={1 / z}
              opacity={0.4}
            />
            <Circle
              cx={center.x}
              cy={center.y}
              r={center.r}
              fill={colors.user}
              opacity={selectedId && selectedId !== data.center.id ? 0.5 : 1}
            />
          </>
        ) : null}

        {selectedEdgePath ? (
          <Path
            d={selectedEdgePath}
            stroke={colors.edge}
            strokeWidth={2.2 / z}
            fill="none"
            opacity={0.9}
          />
        ) : null}

        {selectedPosition ? (
          <Circle
            cx={selectedPosition.x}
            cy={selectedPosition.y}
            r={selectedPosition.r + 4 / z}
            fill="none"
            stroke={colors.selected}
            strokeWidth={1.5 / z}
            opacity={0.9}
          />
        ) : null}

        {iconNodes.map((node) => {
          const scale = node.size / 24;
          const dim =
            dimmed && node.id !== data.center.id && !(activeIds?.has(node.id) ?? false);
          return (
            <Path
              key={node.id}
              d={iconPaths(iconKeyFor(node.kind, node.icon)).join(' ')}
              fill="none"
              stroke={colors.ink}
              strokeWidth={1.35 / (scale * z)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={dim ? 0.16 : 1}
              transform={`translate(${node.x - 12 * scale} ${node.y - 12 * scale}) scale(${scale})`}
            />
          );
        })}
      </>
    ),
    [
      paths,
      colors,
      kindColor,
      highlighted,
      center,
      selectedPosition,
      selectedEdgePath,
      iconNodes,
      activeIds,
      selectedId,
      data.center.id,
      idleNodeOpacity,
      dimmed,
      z,
    ],
  );

  return (
    <GestureDetector gesture={gestures}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: (width - spanX) / 2,
              top: band.centerY - spanY / 2,
              width: spanX,
              height: spanY,
            },
            cameraStyle,
          ]}
        >
          <Svg
            width={spanX}
            height={spanY}
            viewBox={`${box.minX} ${box.minY} ${spanX} ${spanY}`}
            pointerEvents="none"
          >
            {scene}
          </Svg>
        </Animated.View>

        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: LABEL_SLOTS }, (_, index) => {
            const label = labels[index];
            return (
              <MapLabel
                key={index}
                text={label?.text ?? null}
                x={label?.x ?? 0}
                y={label?.y ?? 0}
                r={label?.r ?? 0}
                side={label?.side ?? 'below'}
                selected={label?.selected ?? false}
                zoom={zoom}
                panX={panX}
                panY={panY}
                originX={fitted.originX}
                originY={fitted.originY}
                centerY={band.centerY}
                width={width}
                color={colors.label}
                selectedColor={colors.selected}
                backdrop={colors.labelBackdrop}
              />
            );
          })}
        </View>
      </View>
    </GestureDetector>
  );
});

export const GraphCanvas = memo(GraphCanvasBase);
