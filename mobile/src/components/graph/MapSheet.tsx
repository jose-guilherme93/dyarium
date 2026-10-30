/**
 * Folha do mapa com tres alturas: repouso, detalhe e lista completa.
 *
 * O gesto vive so na alca superior: arrastar o conteudo continua sendo rolar a
 * lista. A folha nunca anima medidas de conteudo, so `translateY`, entao abrir
 * um detalhe com muitos trechos nao muda a altura no meio da animacao.
 *
 * O arrasto roda na thread de UI: o dedo move a folha sem esperar o JavaScript,
 * e a altura final so avisa o React quando o gesto termina.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MOTION_SHEET } from '@/theme/motion';
import { baseColors, radius, spacing } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

/** Alturas em fracao da tela: repouso, detalhe e lista completa. */
export const SNAP_REST = 0.5;
export const SNAP_DETAIL = 0.72;
export const SNAP_FULL = 1;
export const SHEET_SNAPS = [SNAP_REST, SNAP_DETAIL, SNAP_FULL];

/** Empurrao da velocidade: arrasto curto e rapido escolhe a altura seguinte. */
const FLING_MS = 70;
/** A velocidade do gesto vem em pt por segundo; o empurrao e em pt por ms. */
const FLING_UNIT = 1000;

export interface MapSheetHandle {
  snapTo(fraction: number): void;
}

interface MapSheetProps {
  header: ReactNode;
  /** Recebe a altura atual para habilitar a rolagem a partir do detalhe. */
  children: (snap: number) => ReactNode;
  onSnapChange?(snap: number): void;
  initialSnap?: number;
  testID?: string;
}

function nearestSnap(value: number): number {
  let best = SHEET_SNAPS[0];
  for (const snap of SHEET_SNAPS) {
    if (Math.abs(snap - value) < Math.abs(best - value)) best = snap;
  }
  return best;
}

function nearestSnapWorklet(value: number): number {
  'worklet';
  let best = SHEET_SNAPS[0];
  for (const snap of SHEET_SNAPS) {
    if (Math.abs(snap - value) < Math.abs(best - value)) best = snap;
  }
  return best;
}

export const MapSheet = forwardRef<MapSheetHandle, MapSheetProps>(function MapSheet(
  { header, children, onSnapChange, initialSnap = SNAP_REST, testID },
  ref,
) {
  const styles = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const maxOffset = Math.max(0, height * (1 - SNAP_REST));
  const offsetFor = useCallback(
    (fraction: number) => Math.max(0, height * (1 - fraction)),
    [height],
  );

  // Altura atual e altura de repouso do gesto, so na thread de UI.
  const offset = useSharedValue(offsetFor(initialSnap));
  const resting = useSharedValue(offsetFor(initialSnap));
  const dragStart = useSharedValue(0);

  const snapRef = useRef(initialSnap);
  const [snap, setSnap] = useState(initialSnap);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  /** Fim de gesto: escolhe a altura mais proxima e avisa o React uma vez. */
  const settle = useCallback(
    (fraction: number) => {
      snapRef.current = fraction;
      setSnap(fraction);
      onSnapChange?.(fraction);
    },
    [onSnapChange],
  );

  const animateTo = useCallback(
    (fraction: number) => {
      const next = nearestSnap(fraction);
      const target = offsetFor(next);
      resting.value = target;
      offset.value = withTiming(target, { duration: MOTION_SHEET });
      settle(next);
    },
    [offsetFor, settle, offset, resting],
  );

  useImperativeHandle(ref, () => ({ snapTo: animateTo }), [animateTo]);

  // Girar a tela muda o offset sem mudar o snap escolhido.
  useEffect(() => {
    const target = offsetFor(snapRef.current);
    resting.value = target;
    offset.value = target;
  }, [height, offsetFor, offset, resting]);

  // O arrasto so comeca depois de 3pt na vertical: um toque continua indo para
  // as abas e para o botao de recolher.
  const drag = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-3, 3])
        .onStart(() => {
          dragStart.value = offset.value;
        })
        .onUpdate((event) => {
          const next = dragStart.value + event.translationY;
          offset.value = Math.min(maxOffset, Math.max(0, next));
        })
        .onEnd((event, success) => {
          if (!success) {
            offset.value = withTiming(resting.value, { duration: MOTION_SHEET });
            return;
          }
          // Projeta a velocidade para o arrasto curto e rapido escolher a
          // altura seguinte, como nas folhas nativas.
          const dragged = dragStart.value + event.translationY;
          const projected = dragged + (event.velocityY / FLING_UNIT) * FLING_MS;
          const fraction = nearestSnapWorklet(
            1 - Math.min(maxOffset, Math.max(0, projected)) / height,
          );
          const target = Math.max(0, height * (1 - fraction));
          resting.value = target;
          offset.value = withTiming(target, { duration: MOTION_SHEET });
          runOnJS(settle)(fraction);
        }),
    [dragStart, offset, resting, maxOffset, height, settle],
  );

  const [headerHeight, setHeaderHeight] = useState(0);
  const contentHeight = Math.max(0, height * snap - headerHeight);

  return (
    <Animated.View
      testID={testID}
      style={[styles.sheet, { height }, sheetStyle]}
    >
      <GestureDetector gesture={drag}>
        <View onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
          <View
            style={[
              styles.grabArea,
              { paddingTop: snap >= 0.99 ? Math.max(0, insets.top - 10) : 6 },
            ]}
          >
            <View style={styles.grabber} />
          </View>
          <View style={styles.headerWrap}>
            <View style={styles.header}>{header}</View>
          </View>
        </View>
      </GestureDetector>
      <View style={{ height: contentHeight, overflow: 'hidden' }}>{children(snap)}</View>
    </Animated.View>
  );
});

const baseStyles = defineStyles({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: baseColors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
    overflow: 'hidden',
  },
  grabArea: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: baseColors.borderStrong,
  },
  headerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  header: { flex: 1 },
});
