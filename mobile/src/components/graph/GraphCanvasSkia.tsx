/**
 * Desenho interativo do mapa (versao Skia, paridade web).
 *
 * Mesma logica do GraphCanvas anterior: layout radial/force vindo do core,
 * camera por matriz (pan/zoom em pixels), labels fora do canvas.
 *
 * Optimizacao de performance: arestas e nos sao desenhados diretamente com
 * coordenadas de layout, sem converter strings SVG para Skia Path no thread
 * JS. Isso evita centenas de conversoes Path e componentes nativos a cada
 * mudanca de foco. O desenho flui na GPU: pan/zoom so aplicam outra matriz
 * ao grupo.
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
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  SharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Path,
  RoundedRect,
  SkFont,
  Skia,
  Text as SkText,
  matchFont,
} from '@shopify/react-native-skia';

import type { EntityKind, GraphData, GraphNodeKind } from '@/core/graphModel';
import type { GraphLayout, VisibleBand, FittedCamera } from '@/core/graphLayout';
import { fitCamera, visibleBand } from '@/core/graphLayout';
import {
  LABEL_FONT,
  LABEL_GAP,
  LABEL_LINE_HEIGHT,
  labelWidth,
  pickLabels,
  type GraphLabel,
} from '@/core/graphLabels';
import { iconKeyFor, iconPaths } from '@/core/graphIcons';
import { neighborIds, selectedEdgesPath } from '@/core/graphPaths';
import { useRenderCount } from '@/dev/perf';
import type { GraphColors } from '@/theme/graph';

const MAX_ZOOM = 4.5;
const FIT_PADDING = 4;
const FIT_MAX_ZOOM = 3.2;
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
const EDGE_KINDS = ['cooccurrence', 'mention', 'relation'] as const;
type GraphEdgeKind = typeof EDGE_KINDS[number];
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
  },
  ref,
) {
  useRenderCount('GraphCanvas');
  const band = useMemo(
    () => visibleBand(height, viewportTop, viewportBottom),
    [height, viewportTop, viewportBottom],
  );
  const visibleHeight = band.height;

  const fitted = useMemo(
    () =>
      fitCamera(layout.bounds, width, visibleHeight, {
        padding: FIT_PADDING,
        minZoom: 0.05,
        maxZoom: FIT_MAX_ZOOM,
      }),
    [layout.bounds, width, visibleHeight],
  );
  const unit = 1 / fitted.zoom;
  const margin = EDGE_MARGIN * unit;

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

  const [labels, setLabels] = useState<GraphLabel[]>([]);
  const labelsRef = useRef<GraphLabel[]>([]);
  const cameraRef = useRef({ zoom: fitted.zoom, panX: fitted.panX, panY: fitted.panY });

  // Fonte do sistema: o Skia desenha o texto no mesmo canvas das bolas, sem uma
  // view por nome. E o que o Obsidian faz -- texto e geometria no mesmo passe.
  const fonts = useMemo(() => {
    const fontFamily = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });
    const regular = matchFont({ fontFamily, fontSize: LABEL_FONT, fontWeight: '500' });
    const bold = matchFont({ fontFamily, fontSize: LABEL_FONT, fontWeight: '700' });
    return { regular, bold };
  }, []);

  const firstFrame = useRef(true);
  const framed = useRef('');

  const syncLabels = useCallback(
    (cameraZoom: number, cameraPanX: number, cameraPanY: number) => {
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
            label.id === previous[index].id &&
            label.selected === previous[index].selected,
        );
      if (same) return;
      labelsRef.current = next;
      setLabels(next);
    },
    [
      shown,
      layout,
      width,
      band.top,
      band.bottom,
      band.centerY,
      fitted.originX,
      fitted.originY,
      selectedId,
    ],
  );

  // Rotulo animado: acompanha a bola em tempo real pelo worklet, sem esperar
  // o gesto terminar. O Obsidian faz o mesmo -- texto e geometria no mesmo
  // passe da camera.
  const DrawnLabel = memo(function DrawnLabel({
    label,
    colors,
    fonts,
    band,
    fitted,
    zoom,
    panX,
    panY,
  }: {
    label: GraphLabel;
    colors: GraphColors;
    fonts: { regular: SkFont; bold: SkFont };
    band: VisibleBand;
    fitted: FittedCamera;
    zoom: SharedValue<number>;
    panX: SharedValue<number>;
    panY: SharedValue<number>;
  }) {
    // Acompanha a bola em tempo real pelo worklet, exatamente como o Obsidian.
    // Os rotulos se movem junto com as bolas durante o arrasto e o zoom,
    // sem nenhum re-render do React: tudo na thread de UI.
    const left = useDerivedValue(() => {
      const z = zoom.value;
      const sx = width / 2 + panX.value + (label.x - fitted.originX) * z;
      const sr = label.r * z;
      const textWidth = labelWidth(label.text);
      let l = sx - textWidth / 2;
      if (label.side === 'right') {
        l = sx + sr + LABEL_GAP;
      } else if (label.side === 'left') {
        l = sx - sr - LABEL_GAP - textWidth;
      }
      return l;
    });
    const top = useDerivedValue(() => {
      const z = zoom.value;
      const sy = band.centerY + panY.value + (label.y - fitted.originY) * z;
      const sr = label.r * z;
      let t = sy + sr + LABEL_GAP;
      if (label.side === 'above') {
        t = sy - sr - LABEL_GAP - LABEL_LINE_HEIGHT;
      } else if (label.side === 'right' || label.side === 'left') {
        t = sy - LABEL_LINE_HEIGHT / 2;
      }
      return t;
    });
    const baseline = useDerivedValue(() => top.value + LABEL_LINE_HEIGHT - 2);

    return (
      <Group>
        <RoundedRect
          x={left}
          y={top}
          width={labelWidth(label.text) + 2}
          height={LABEL_LINE_HEIGHT}
          r={2}
          color={colors.labelBackdrop}
          opacity={0.55}
        />
        <SkText
          x={left}
          y={baseline}
          text={label.text}
          font={label.selected ? fonts.bold : fonts.regular}
          color={label.selected ? colors.selected : colors.label}
        />
      </Group>
    );
  });

  useEffect(() => {
    const camera = cameraRef.current;
    syncLabels(camera.zoom, camera.panX, camera.panY);
  }, [shown, selectedId, syncLabels]);

  useEffect(() => {
    if (width <= 0 || visibleHeight <= 0) return;
    const frame = `${layout.key}|${width}|${visibleHeight.toFixed(0)}|${fitted.zoom.toFixed(3)}`;
    if (framed.current === frame) return;
    framed.current = frame;
    // Entra menor e torto, assenta na posicao final. Na primeira abertura
    // nada se move ate a animacao acabar; depois o mapa so desenha com gesto.
    if (firstFrame.current) {
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
    syncLabels(fitted.zoom, fitted.panX, fitted.panY);
  }, [
    layout.key,
    fitted,
    width,
    visibleHeight,
    zoom,
    tilt,
    panX,
    panY,
    syncLabels,
  ]);

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
        Math.max(position.r * 1.25, 8 * unit),
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
        const localX = start.x - width / 2;
        const localY = start.y - band.centerY;
        const limitX = Math.max(0, (spanX * next - width) / 2);
        const limitY = Math.max(0, (spanY * next - visibleHeight) / 2);
        panX.value = clampWorklet(localX - (localX - start.panX) * ratio, -limitX, limitX);
        panY.value = clampWorklet(localY - (localY - start.panY) * ratio, -limitY, limitY);
        zoom.value = next;
      })
      .onEnd(() => {
        runOnJS(syncLabels)(zoom.value, panX.value, panY.value);
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
  }, [panX, panY, startPanX, startPanY, pinchStart, zoom, width, visibleHeight, band.centerY, spanX, spanY, fitted.zoom, selectAt, syncLabels]);

  const animateZoom = useCallback(
    (next: number) => {
      const target = Math.min(next, MAX_ZOOM);
      const ratio = target / zoom.value;
      const limits = { limitX: Math.max(0, (spanX * target - width) / 2), limitY: Math.max(0, (spanY * target - visibleHeight) / 2) };
      const nextPanX = Math.min(Math.max(panX.value * ratio, -limits.limitX), limits.limitX);
      const nextPanY = Math.min(Math.max(panY.value * ratio, -limits.limitY), limits.limitY);
      zoom.value = target;
      panX.value = nextPanX;
      panY.value = nextPanY;
      syncLabels(target, nextPanX, nextPanY);
    },
    [zoom, panX, panY, width, visibleHeight, spanX, spanY, syncLabels],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => animateZoom(zoom.value * 2),
      zoomOut: () => animateZoom(zoom.value / 2),
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
  const centerActive = selectedId === data.center.id;
  // Opacidades do mapa do dashboard: a bola em foco fica cheia, a vizinhanca
  // em 72% e o resto quase some.
  const idleNodeOpacity = dimmed ? 0.25 : 0.8;
  const z = fitted.zoom;

  // Arestas da bola selecionada (conexoes diretas).
  const selectedEdgePathStr = useMemo(
    () => (selectedId ? selectedEdgesPath(shown, layout, selectedId) : ''),
    [shown, layout, selectedId],
  );
  const activeIds = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set(selectedNeighbors);
    ids.add(selectedId);
    return ids;
  }, [selectedId, selectedNeighbors]);

  // Camera: pan/zoom vem de shared values; o Skia le o array derivado, nunca os
  // objetos das shared values direto (isso estoura "expected a number").
  // Diferente do SVG, o Skia nao tem "origem no centro da view": o mesmo mapeamento
  // que os labels usam (centro da tela + pan + (p - origem) * zoom) vai explicito.
  const cameraTransform = useDerivedValue(() => [
    { translateX: width / 2 + panX.value },
    { translateY: band.centerY + panY.value },
    { rotate: tilt.value },
    { scale: zoom.value },
    { translateX: -fitted.originX },
    { translateY: -fitted.originY },
  ]);

  // Arestas como linhas diretas, sem converter strings SVG para Path no thread JS.
  // Cada aresta e um <Line> com coordenadas brutas do layout.
  const edgesByKind = useMemo(() => {
    const out: Record<GraphEdgeKind, { x1: number; y1: number; x2: number; y2: number; weight: number }[]> = {
      cooccurrence: [],
      mention: [],
      relation: [],
    };
    for (const edge of shown.edges) {
      const from = layout.positions[edge.source];
      const to = layout.positions[edge.target];
      if (!from || !to) continue;
      out[edge.kind].push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, weight: edge.weight });
    }
    return out;
  }, [shown, layout]);

  const canvas = (
    <View style={StyleSheet.absoluteFill} collapsable={false}>
      <Canvas style={{ width, height }}>
        <Group transform={cameraTransform}>
            {/* edges: linhas diretas, sem Path de SVG */}
            {EDGE_KINDS.map((kind: GraphEdgeKind) => {
              const alpha = dimmed ? (activeIds?.size ? 0.18 : 0.1) : EDGE_ALPHA[kind];
              return edgesByKind[kind].map((e, i) => {
                const band = e.weight > 1 ? (e.weight > 2 ? 2 : 1) : 0;
                return (
                  <Path
                    key={`e-${kind}-${i}`}
                    path={`M${e.x1} ${e.y1} L${e.x2} ${e.y2}`}
                    color={colors.edge}
                    strokeWidth={edgeWidth(kind, band) / z}
                    opacity={alpha}
                  >
                    {kind === 'mention' ? (
                      <DashPathEffect intervals={[5 / z, 4 / z]} />
                    ) : null}
                  </Path>
                );
              });
            })}
            {/* selected edge: conexoes da bola escolhida, mais fortes como no Obsidian */}
            {selectedEdgePathStr ? (
              <Path
                path={Skia.Path.MakeFromSVGString(selectedEdgePathStr)!}
                color={colors.edgeStrong}
                style="stroke"
                strokeWidth={2.2 / z}
                opacity={0.9}
              />
            ) : null}
            {/* nodes: circulos diretos, sem Path de SVG */}
            {shown.nodes.map((node) => {
              const position = layout.positions[node.id];
              if (!position) return null;
              const isCenter = node.id === data.center.id;
              const isSelected = node.id === selectedId;
              const isNeighbor = activeIds?.has(node.id) ?? false;
              const isHighlighted = isSelected || isNeighbor || isCenter;
              const opacity = isCenter
                ? centerActive ? 1 : 0.2
                : dimmed && !isHighlighted
                  ? 0.12
                  : idleNodeOpacity;
              return (
                <Group key={node.id}>
                  <Circle
                    cx={position.x}
                    cy={position.y}
                    r={position.r}
                    color={kindColor[node.kind]}
                    style="fill"
                    opacity={opacity}
                  />
                  <Circle
                    cx={position.x}
                    cy={position.y}
                    r={position.r}
                    color={colors.labelBackdrop}
                    style="stroke"
                    strokeWidth={1.1 / z}
                    opacity={opacity}
                  />
                </Group>
              );
            })}
            {/* center: disco do dono, contorno e anel, como no dashboard */}
            {center ? (
              <>
                <Circle
                  cx={center.x}
                  cy={center.y}
                  r={center.r + 7 / z}
                  color={colors.edgeStrong}
                  style="stroke"
                  strokeWidth={1 / z}
                  opacity={centerActive ? 0.55 : 0.35}
                />
                <Circle
                  cx={center.x}
                  cy={center.y}
                  r={center.r}
                  color={colors.user}
                  style="fill"
                  opacity={centerActive ? 0.55 : 0.28}
                />
                <Circle
                  cx={center.x}
                  cy={center.y}
                  r={center.r}
                  color={colors.labelBackdrop}
                  style="stroke"
                  strokeWidth={2.2 / z}
                />
              </>
            ) : null}
            {/* selected ring */}
            {selectedPosition ? (
              <Circle
                cx={selectedPosition.x}
                cy={selectedPosition.y}
                r={selectedPosition.r + 5 / z}
                color={colors.selected}
                style="stroke"
                strokeWidth={1.4 / z}
                opacity={0.85}
              />
            ) : null}
            {/* icons */}
            {iconNodes.map(({ id, kind, icon, x, y, size }) => {
              const d = iconPaths(iconKeyFor(kind, icon ?? '')).join(' ');
              const p = Skia.Path.MakeFromSVGString(d);
              if (!p) return null;
              const scale = size / 24;
              const isCenter = id === data.center.id;
              const dim =
                dimmed && !isCenter && !(activeIds?.has(id) ?? false);
              const opacity = isCenter ? (centerActive ? 1 : 0.2) : dim ? 0.12 : 0.92;
              return (
                <Path
                  key={id}
                  path={p}
                  color={isCenter ? colors.labelBackdrop : colors.ink}
                  style="stroke"
                  strokeWidth={1.35 / (scale * z)}
                  strokeCap="round"
                  strokeJoin="round"
                  opacity={opacity}
                  transform={[
                    { translateX: x - 12 * scale },
                    { translateY: y - 12 * scale },
                    { scale },
                  ]}
                />
              );
            })}
          </Group>
          {/* Nomes no mesmo canvas: texto em pixels de tela, calculado no
              worklet e acompanhando as bolas em tempo real durante o gesto. */}
          {labels.map((label) => (
            <DrawnLabel
              key={label.id}
              label={label}
              colors={colors}
              fonts={fonts}
              band={band}
              fitted={fitted}
              zoom={zoom}
              panX={panX}
              panY={panY}
            />
          ))}
        </Canvas>
      </View>
  );

  return interactive ? (
    <GestureDetector gesture={gestures}>{canvas}</GestureDetector>
  ) : (
    canvas
  );
});

export const GraphCanvas = GraphCanvasBase;
