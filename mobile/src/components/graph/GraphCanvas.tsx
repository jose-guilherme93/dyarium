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
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import type { GraphData, GraphNodeKind } from '@/core/graphModel';
import type { GraphLayout } from '@/core/graphLayout';
import { clamp, fitCamera, panLimits, visibleBand } from '@/core/graphLayout';
import { pickLabels, type GraphLabel } from '@/core/graphLabels';
import { iconKeyFor, iconPaths } from '@/core/graphIcons';
import { graphPaths, neighborIds, selectedEdgesPath } from '@/core/graphPaths';
import type { GraphColors } from '@/theme/graph';

/** Zoom minimo absoluto; o minimo real e sempre o encaixe do conjunto. */
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3.2;
/** Encaixe: o desenho inteiro cabe, com uma margem curta para os rotulos. */
const FIT_PADDING = 12;
const FIT_MAX_ZOOM = 1.4;
const TAP_SLOP = 14;
/** Margem da animacao dos botoes de zoom. */
const BUTTON_MS = 220;
/** Folga em volta do desenho, em pt de tela, para o nome nao ser cortado. */
const EDGE_MARGIN = 28;
/** Bola menor que isso no encaixe nao mostra icone (vira poeira). */
const MIN_ICON_RADIUS = 4;
/** Raio minimo da bola, em pt de tela, para ganhar nome. */
const MIN_LABEL_BALL = 4;
/** Tempo do nome entrando. */
const LABEL_FADE_MS = 150;
/** Teto de icones desenhados. */
const MAX_ICONS = 80;

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
  onSelect(id: string | null): void;
}

function clampWorklet(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

const AnimatedText = Animated.createAnimatedComponent(SvgText);

/**
 * Um nome do mapa. Entra com um fade curto quando o conjunto muda; a posicao
 * fica em unidades do grafo, entao o zoom nao mexe nele.
 */
const MapLabel = memo(function MapLabel({
  label,
  color,
  selectedColor,
}: {
  label: GraphLabel;
  color: string;
  selectedColor: string;
}) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: LABEL_FADE_MS });
  }, [opacity]);
  const animated = useAnimatedProps(() => ({ opacity: opacity.value }));
  return (
    <AnimatedText
      animatedProps={animated}
      x={label.x}
      y={label.y}
      fill={label.selected ? selectedColor : color}
      fontSize={label.fontSize}
      fontWeight={label.selected ? '700' : '500'}
      textAnchor="middle"
    >
      {label.text}
    </AnimatedText>
  );
});

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
    onSelect,
  },
  ref,
) {
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

  // Nomes: quais aparecem depende de quanto espaco existe **agora**. A
  // escolha roda no fim do gesto, uma vez, e so troca os textos quando o
  // conjunto muda de verdade.
  const [labels, setLabels] = useState<GraphLabel[]>([]);
  const labelsRef = useRef<GraphLabel[]>([]);

  const syncLabels = useCallback(() => {
    const z = zoom.value;
    const pan = panX.value;
    const offsetY = panY.value;
    const view = {
      minX: fitted.originX - (width / 2 + pan) / z,
      maxX: fitted.originX + (width / 2 - pan) / z,
      minY: fitted.originY + (band.top - band.centerY - offsetY) / z,
      maxY: fitted.originY + (band.bottom - band.centerY - offsetY) / z,
    };
    const next = pickLabels(data, layout, {
      // O texto e desenhado em unidades do grafo: acompanha o zoom.
      scale: unit,
      // Quanto mais perto, menor a bola que ainda ganha nome.
      minBall: MIN_LABEL_BALL / z,
      view,
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
    data,
    layout,
    unit,
    width,
    band.top,
    band.bottom,
    band.centerY,
    fitted.originX,
    fitted.originY,
    zoom,
    panX,
    panY,
    selectedId,
  ]);

  // Encaixe a cada mudanca de conjunto (filtro, foco, tamanho ou folha).
  useEffect(() => {
    if (width <= 0 || visibleHeight <= 0) return;
    if (__DEV__) {
      console.log(
        `[map] camera ${spanX.toFixed(0)}x${spanY.toFixed(0)} zoom ${fitted.zoom.toFixed(3)} band ${width}x${visibleHeight.toFixed(0)}`,
      );
    }
    zoom.value = fitted.zoom;
    panX.value = fitted.panX;
    panY.value = fitted.panY;
    syncLabels();
  }, [layout.key, fitted, width, visibleHeight, spanX, spanY, zoom, panX, panY, syncLabels]);

  // A bola escolhida ganha o nome na hora, sem esperar gesto.
  useEffect(() => {
    syncLabels();
  }, [selectedId, syncLabels]);

  const selectedNeighbors = useMemo(
    () => (selectedId ? neighborIds(data, selectedId) : new Set<string>()),
    [data, selectedId],
  );

  // O desenho inteiro, uma vez por conjunto: nada aqui depende da camera.
  const paths = useMemo(() => graphPaths(data, layout), [data, layout]);
  const selectedEdgePath = useMemo(
    () => (selectedId ? selectedEdgesPath(data, layout, selectedId) : ''),
    [data, layout, selectedId],
  );
  // A bola escolhida e as vizinhas ficam vivas; o resto vira sombra.
  const activeIds = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set(selectedNeighbors);
    ids.add(selectedId);
    return ids;
  }, [selectedId, selectedNeighbors]);
  const highlighted = useMemo(
    () => (activeIds ? graphPaths(data, layout, activeIds).nodes : null),
    [data, layout, activeIds],
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
    for (const node of data.nodes) {
      if (out.length >= MAX_ICONS) break;
      push(node.id, node.kind, node.icon);
    }
    return out;
  }, [data, layout, fitted.zoom, unit]);

  const selectAt = useCallback(
    (x: number, y: number) => {
      const z = zoom.value;
      const gx = fitted.originX + (x - width / 2 - panX.value) / z;
      const gy = fitted.originY + (y - band.centerY - panY.value) / z;
      const center = layout.positions[data.center.id];
      if (center) {
        const d = Math.hypot(gx - center.x, gy - center.y);
        if (d <= center.r + 12 / z) {
          onSelect(data.center.id);
          return;
        }
      }
      let best: { id: string; distance: number } | null = null;
      let shadow = false;
      for (const node of data.nodes) {
        const position = layout.positions[node.id];
        if (!position) continue;
        const d = Math.hypot(gx - position.x, gy - position.y);
        if (d > position.r + 12 / z) continue;
        if (!best || d < best.distance) best = { id: node.id, distance: d };
        // Com uma bola aberta, as apagadas sao so sombra: nao recebem toque.
        if (activeIds && !activeIds.has(node.id)) shadow = true;
      }
      if (best && activeIds && !activeIds.has(best.id)) return;
      if (shadow && !best) return;
      onSelect(best?.id ?? null);
    },
    [
      data,
      layout,
      activeIds,
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
        runOnJS(syncLabels)();
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
        runOnJS(syncLabels)();
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
      zoom.value = withTiming(target, { duration: BUTTON_MS }, () => {
        runOnJS(syncLabels)();
      });
      panX.value = withTiming(clamp(panX.value * ratio, -limits.limitX, limits.limitX), {
        duration: BUTTON_MS,
      });
      panY.value = withTiming(clamp(panY.value * ratio, -limits.limitY, limits.limitY), {
        duration: BUTTON_MS,
      });
    },
    [zoom, panX, panY, layout.bounds, width, visibleHeight, fitted.zoom, syncLabels],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => animateZoom(zoom.value * 1.6),
      zoomOut: () => animateZoom(zoom.value / 1.6),
      fit() {
        zoom.value = withTiming(fitted.zoom, { duration: BUTTON_MS + 40 }, () => {
          runOnJS(syncLabels)();
        });
        panX.value = withTiming(0, { duration: BUTTON_MS + 40 });
        panY.value = withTiming(0, { duration: BUTTON_MS + 40 });
      },
    }),
    [animateZoom, zoom, panX, panY, fitted.zoom, syncLabels],
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
  const idleNodeOpacity = selectedId ? 0.16 : 0.82;
  // Espessuras em unidades do grafo: o encaixe e a referencia, o zoom amplia.
  const z = fitted.zoom;

  // O desenho e o mesmo enquanto o conjunto nao muda: um gesto nao remonta
  // bolas, icones nem linhas. So os nomes podem mudar entre um gesto e outro.
  const scene = useMemo(
    () => (
      <>
        <Path
          d={paths.edges.cooccurrence}
          stroke={colors.edge}
          strokeWidth={0.6 / z}
          fill="none"
          opacity={selectedId ? 0.05 : 0.09}
        />
        <Path
          d={paths.edges.cooccurrenceStrong}
          stroke={colors.edgeStrong}
          strokeWidth={1.05 / z}
          fill="none"
          opacity={selectedId ? 0.1 : 0.2}
        />
        <Path
          d={paths.edges.relation}
          stroke={colors.edgeStrong}
          strokeWidth={0.9 / z}
          fill="none"
          opacity={selectedId ? 0.1 : 0.16}
        />
        <Path
          d={paths.edges.mention}
          stroke={colors.edge}
          strokeWidth={1.1 / z}
          strokeDasharray={`${5 / z} ${4 / z}`}
          fill="none"
          opacity={selectedId ? 0.16 : 0.28}
        />

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
            stroke={colors.selected}
            strokeWidth={1.8 / z}
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
            Boolean(selectedId) &&
            node.id !== data.center.id &&
            !(activeIds?.has(node.id) ?? false);
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

            {labels.map((label) => (
              <MapLabel
                key={label.id}
                label={label}
                color={colors.label}
                selectedColor={colors.selected}
              />
            ))}
          </Svg>
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

export const GraphCanvas = memo(GraphCanvasBase);
