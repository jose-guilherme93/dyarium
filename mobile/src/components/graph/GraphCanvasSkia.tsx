/**
 * Desenho interativo do mapa (versao Skia, paridade web).
 *
 * Mesma logica do GraphCanvas anterior: layout radial/force vindo do core,
 * camera por matriz (pan/zoom em pixels), labels fora do canvas. A troca de
 * react-native-svg para Skia move o render para a GPU: o pan e o zoom so
 * aplicam outra matriz ao grupo, sem redesenhar geometria por frame.
 */
import {
  forwardRef,
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
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Path,
  RoundedRect,
  Skia,
  Text as SkText,
  matchFont,
} from '@shopify/react-native-skia';

import type { EntityKind, GraphData, GraphNodeKind } from '@/core/graphModel';
import type { GraphLayout } from '@/core/graphLayout';
import { fitCamera, visibleBand } from '@/core/graphLayout';
import {
  LABEL_FONT,
  LABEL_GAP,
  LABEL_LINE_HEIGHT,
  labelWidth,
  pickLabels,
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

const MAX_ZOOM = 3.2;
const FIT_PADDING = 4;
const FIT_MAX_ZOOM = 2.4;
// Assentamento de abertura: o mapa entra 10% menor e um pouco torto e se
// acomoda em meio segundo, como a simulacao do Obsidian quando esfria. Depois
// disso nada se move e nenhum quadro e desenhado sem gesto.
const SETTLE_MS = 620;
const SETTLE_TILT = 0.014;
const SETTLE_ZOOM = 0.9;
const TAP_SLOP = 14;
const TAP_RADIUS = 22;
const EDGE_MARGIN = 28;
const MIN_ICON_RADIUS = 4;
const MAX_ICONS = 80;
const EDGE_KINDS = ['cooccurrence', 'mention', 'relation'] as const;
const EDGE_WIDTH: Record<(typeof EDGE_KINDS)[number], [number, number]> = {
  cooccurrence: [0.45, 1.1],
  mention: [0.4, 0.9],
  relation: [0.6, 1.8],
};
function edgeWidth(kind: (typeof EDGE_KINDS)[number], band: number): number {
  const [thin, thick] = EDGE_WIDTH[kind];
  if (EDGE_BANDS <= 1) return thin;
  return thin + ((thick - thin) * band) / (EDGE_BANDS - 1);
}

// Opacidade de partida por tipo de aresta, como no mapa do dashboard: a
// co-ocorrencia some no fundo, a mencao pontilhada fica legivel e a relacao
// fica no meio.
const EDGE_ALPHA: Record<(typeof EDGE_KINDS)[number], number> = {
  cooccurrence: 0.22,
  mention: 0.42,
  relation: 0.26,
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
}

function clampWorklet(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/** Rotulo ja resolvido em pixels de tela, pronto para o Skia desenhar. */
interface DrawnLabel {
  id: string;
  text: string;
  x: number;
  /** Topo da caixa do nome, em pixels de tela. */
  top: number;
  /** Linha de base do texto, em pixels de tela. */
  baseline: number;
  width: number;
  selected: boolean;
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
  // Nomes somem durante o gesto: sao desenhados em pixels de tela, entao
  // segui-los exigiria recalcular cada um a cada quadro. Um valor so esconde a
  // camada inteira e o mapa se move com apenas a matriz da camera mudando.
  const labelOpacity = useSharedValue(0);
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

  const [labels, setLabels] = useState<DrawnLabel[]>([]);
  const labelsRef = useRef<DrawnLabel[]>([]);
  const cameraRef = useRef({ zoom: fitted.zoom, panX: fitted.panX, panY: fitted.panY });

  // Fonte do sistema: o Skia desenha o texto no mesmo canvas das bolas, sem uma
  // view por nome. E o que o Obsidian faz -- texto e geometria no mesmo passe.
  const fonts = useMemo(() => {
    const fontFamily = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });
    const regular = matchFont({ fontFamily, fontSize: LABEL_FONT, fontWeight: '500' });
    const bold = matchFont({ fontFamily, fontSize: LABEL_FONT, fontWeight: '700' });
    return { regular, bold };
  }, []);

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
      const drawn: DrawnLabel[] = [];
      for (const label of next) {
        const sx =
          width / 2 + cameraPanX + (label.x - fitted.originX) * cameraZoom;
        const sy =
          band.centerY + cameraPanY + (label.y - fitted.originY) * cameraZoom;
        const sr = label.r * cameraZoom;
        // Largura pelo comprimento do texto: nada de medir fonte nativa aqui.
        const textWidth = labelWidth(label.text);
        let left = sx - textWidth / 2;
        let top = sy + sr + LABEL_GAP;
        if (label.side === 'above') {
          top = sy - sr - LABEL_GAP - LABEL_LINE_HEIGHT;
        } else if (label.side === 'right') {
          left = sx + sr + LABEL_GAP;
          top = sy - LABEL_LINE_HEIGHT / 2;
        } else if (label.side === 'left') {
          left = sx - sr - LABEL_GAP - textWidth;
          top = sy - LABEL_LINE_HEIGHT / 2;
        }
        // A linha de base fica um pouco abaixo do topo para o texto nao ficar
        // colado na borda superior da caixa.
        const baseline = top + LABEL_LINE_HEIGHT - 2;
        drawn.push({
          id: label.id,
          text: label.text,
          x: left,
          top,
          baseline,
          width: textWidth,
          selected: label.selected,
        });
      }
      const previous = labelsRef.current;
      const same =
        previous.length === drawn.length &&
        drawn.every(
          (label, index) =>
            label.id === previous[index].id &&
            label.selected === previous[index].selected &&
            Math.abs(label.x - (previous[index].x ?? 0)) < 0.5 &&
            Math.abs(label.baseline - (previous[index].baseline ?? 0)) < 0.5,
        );
      if (same) {
        labelOpacity.value = withTiming(1, { duration: 120 });
        return;
      }
      labelsRef.current = drawn;
      setLabels(drawn);
      labelOpacity.value = withTiming(1, { duration: 120 });
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
      labelOpacity,
    ],
  );

  useEffect(() => {
    const camera = cameraRef.current;
    syncLabels(camera.zoom, camera.panX, camera.panY);
  }, [shown, selectedId, syncLabels]);

  const framed = useRef('');
  useEffect(() => {
    if (width <= 0 || visibleHeight <= 0) return;
    const frame = `${layout.key}|${width}|${visibleHeight.toFixed(0)}|${fitted.zoom.toFixed(3)}`;
    if (framed.current === frame) return;
    framed.current = frame;
    // Entra menor e torto, assenta na posicao final. Uma animacao de tres
    // valores, so na abertura: parado, o mapa nao desenha nenhum quadro.
    zoom.value = fitted.zoom * SETTLE_ZOOM;
    tilt.value = SETTLE_TILT;
    panX.value = fitted.panX;
    panY.value = fitted.panY;
    labelOpacity.value = 0;
    zoom.value = withTiming(fitted.zoom, {
      duration: SETTLE_MS,
      easing: Easing.out(Easing.cubic),
    });
    tilt.value = withTiming(0, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) });
    labelOpacity.value = withDelay(SETTLE_MS, withTiming(1, { duration: 160 }));
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
    labelOpacity,
    syncLabels,
  ]);

  const paths = useMemo(() => graphPaths(shown, layout), [shown, layout]);
  const selectedEdgePath = useMemo(
    () => (selectedId ? selectedEdgesPath(shown, layout, selectedId) : ''),
    [shown, layout, selectedId],
  );
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
        labelOpacity.value = 0;
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
        labelOpacity.value = 0;
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
  }, [panX, panY, startPanX, startPanY, pinchStart, zoom, width, visibleHeight, band.centerY, spanX, spanY, fitted.zoom, selectAt, syncLabels, labelOpacity]);

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

  const kindColor = useMemo<Record<GraphNodeKind, string>>(    () => ({
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

  // Conversao das strings SVG do core em SkPath (memoizado).
  const sk = useMemo(() => {
    const edges: Record<string, (ReturnType<typeof Skia.Path.MakeFromSVGString>)[]> = {};
    for (const kind of EDGE_KINDS) {
      edges[kind] = paths.edges[kind].map((d) => (d ? Skia.Path.MakeFromSVGString(d) : null));
    }
    const nodes: Partial<Record<GraphNodeKind, ReturnType<typeof Skia.Path.MakeFromSVGString>>> = {};
    for (const kind of Object.keys(paths.nodes) as GraphNodeKind[]) {
      const d = paths.nodes[kind];
      if (d) nodes[kind] = Skia.Path.MakeFromSVGString(d) ?? undefined;
    }
    const hi: Partial<Record<GraphNodeKind, ReturnType<typeof Skia.Path.MakeFromSVGString>>> = {};
    if (highlighted) {
      for (const kind of Object.keys(highlighted) as GraphNodeKind[]) {
        const d = highlighted[kind];
        if (d) hi[kind] = Skia.Path.MakeFromSVGString(d) ?? undefined;
      }
    }
    const selectedEdge = selectedEdgePath ? Skia.Path.MakeFromSVGString(selectedEdgePath) : null;
    return { edges, nodes, highlighted: hi, selectedEdge };
  }, [paths, highlighted, selectedEdgePath]);

  const iconSkPaths = useMemo(() => {
    return iconNodes.map((node) => {
      const scale = node.size / 24;
      const d = iconPaths(iconKeyFor(node.kind, node.icon)).join(' ');
      const p = Skia.Path.MakeFromSVGString(d);
      return { node, scale, path: p };
    });
  }, [iconNodes]);

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

  return (
    <GestureDetector gesture={gestures}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        <Canvas style={{ width, height }}>
          <Group transform={cameraTransform}>
            {/* edges */}
            {EDGE_KINDS.map((kind) =>
              sk.edges[kind].map((p, bandIndex) =>
                p ? (
                  <Path
                    key={`${kind}-${bandIndex}`}
                    path={p}
                    color={colors.edge}
                    style="stroke"
                    strokeWidth={edgeWidth(kind, bandIndex) / z}
                    opacity={dimmed ? 0.05 : EDGE_ALPHA[kind]}
                   >
                     {kind === 'mention' ? <DashPathEffect intervals={[5 / z, 4 / z]} /> : null}
                   </Path>
                ) : null,
              ),
            )}
            {/* nodes: preenchimento e contorno na cor do fundo, como no web */}
            {(Object.keys(sk.nodes) as GraphNodeKind[]).map((kind) => {
              const p = sk.nodes[kind];
              if (!p) return null;
              return [
                <Path
                  key={`${kind}-fill`}
                  path={p}
                  color={kindColor[kind]}
                  style="fill"
                  opacity={idleNodeOpacity}
                />,
                <Path
                  key={`${kind}-edge`}
                  path={p}
                  color={colors.labelBackdrop}
                  style="stroke"
                  strokeWidth={1.1 / z}
                  opacity={idleNodeOpacity}
                />,
              ];
            })}
            {/* highlighted */}
            {sk.highlighted
              ? (Object.keys(sk.highlighted) as GraphNodeKind[]).map((kind) => {
                  const p = sk.highlighted[kind];
                  if (!p) return null;
                  return [
                    <Path
                      key={`hi-${kind}`}
                      path={p}
                      color={kindColor[kind]}
                      style="fill"
                      opacity={0.95}
                    />,
                    <Path
                      key={`hi-${kind}-edge`}
                      path={p}
                      color={colors.labelBackdrop}
                      style="stroke"
                      strokeWidth={1.1 / z}
                      opacity={0.95}
                    />,
                  ];
                })
              : null}
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
            {/* selected edge */}
            {sk.selectedEdge ? (
              <Path
                path={sk.selectedEdge}
                color={colors.edgeStrong}
                style="stroke"
                strokeWidth={2.2 / z}
                opacity={0.9}
              />
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
            {iconSkPaths.map(({ node, scale, path: p }) => {
              if (!p) return null;
              const isCenter = node.id === data.center.id;
              const dim =
                dimmed && !isCenter && !(activeIds?.has(node.id) ?? false);
              const opacity = isCenter ? (centerActive ? 1 : 0.2) : dim ? 0.12 : 0.92;
              return (
                <Path
                  key={node.id}
                  path={p}
                  color={isCenter ? colors.labelBackdrop : colors.ink}
                  style="stroke"
                  strokeWidth={1.35 / (scale * z)}
                  strokeCap="round"
                  strokeJoin="round"
                  opacity={opacity}
                  transform={[
                    { translateX: node.x - 12 * scale },
                    { translateY: node.y - 12 * scale },
                    { scale },
                  ]}
                />
              );
            })}
          </Group>
          {/* Nomes no mesmo canvas: texto em pixels de tela, sem uma view por
              nome. Somem durante o gesto e voltam quando a camera assenta. */}
          <Group opacity={labelOpacity}>
            {labels.map((label) => (
              <Group key={label.id}>
                <RoundedRect
                  x={label.x - 1}
                  y={label.top}
                  width={label.width + 2}
                  height={LABEL_LINE_HEIGHT}
                  r={2}
                  color={colors.labelBackdrop}
                  opacity={0.55}
                />
                <SkText
                  x={label.x}
                  y={label.baseline}
                  text={label.text}
                  font={label.selected ? fonts.bold : fonts.regular}
                  color={label.selected ? colors.selected : colors.label}
                />
              </Group>
            ))}
          </Group>
        </Canvas>

      </View>
    </GestureDetector>
  );
});

export const GraphCanvas = GraphCanvasBase;
