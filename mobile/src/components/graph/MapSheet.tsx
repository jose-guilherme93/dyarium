/**
 * Folha do mapa com tres alturas: repouso, detalhe e lista completa.
 *
 * O gesto vive so na alca superior: arrastar o conteudo continua sendo rolar a
 * lista. A folha nunca anima medidas de conteudo, so `translateY`, entao abrir
 * um detalhe com muitos trechos nao muda a altura no meio da animacao.
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
import {
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
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

  const translateY = useRef(new Animated.Value(offsetFor(initialSnap))).current;
  const snapRef = useRef(initialSnap);
  const dragStart = useRef(offsetFor(initialSnap));
  const [snap, setSnap] = useState(initialSnap);

  const animateTo = useCallback(
    (fraction: number) => {
      const next = nearestSnap(fraction);
      snapRef.current = next;
      setSnap(next);
      onSnapChange?.(next);
      Animated.timing(translateY, {
        toValue: offsetFor(next),
        duration: MOTION_SHEET,
        useNativeDriver: false,
      }).start();
    },
    [offsetFor, onSnapChange, translateY],
  );

  useImperativeHandle(ref, () => ({ snapTo: animateTo }), [animateTo]);

  // Girar a tela muda o offset sem mudar o snap escolhido.
  useEffect(() => {
    translateY.setValue(offsetFor(snapRef.current));
  }, [height, offsetFor, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Um toque continua indo para as abas e para o botao de recolher; so
        // um arrasto vertical a partir de 3pt captura a folha.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          translateY.stopAnimation((value) => {
            dragStart.current = value;
          });
        },
        onPanResponderMove: (_event, gesture) => {
          const value = Math.min(
            maxOffset,
            Math.max(0, dragStart.current + gesture.dy),
          );
          translateY.setValue(value);
        },
        onPanResponderRelease: (_event, gesture) => {
          const value = Math.min(
            maxOffset,
            Math.max(0, dragStart.current + gesture.dy),
          );
          // Projeta a velocidade para o arrasto curto e rapido escolher a
          // altura seguinte, como nas folhas nativas.
          const projected = value + gesture.vy * 70;
          const fraction = 1 - Math.min(maxOffset, Math.max(0, projected)) / height;
          animateTo(nearestSnap(fraction));
        },
        onPanResponderTerminate: () => animateTo(snapRef.current),
      }),
    [animateTo, height, maxOffset, translateY],
  );

  const [headerHeight, setHeaderHeight] = useState(0);
  const contentHeight = Math.max(0, height * snap - headerHeight);

  return (
    <Animated.View
      testID={testID}
      style={[styles.sheet, { height, transform: [{ translateY }] }]}
    >
      <View
        {...panResponder.panHandlers}
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      >
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
