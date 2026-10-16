import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

import { colors } from '@/theme/tokens';

const DEFAULT_BARS = 48;

interface LiveWaveformProps {
  /** Gravando (anima). Fora disso, as barras ficam paradas. */
  active: boolean;
  /** Pausado: mantem as barras, mais discretas. */
  paused?: boolean;
  /** Nivel ao vivo do microfone (0..1). */
  level: number;
  bars?: number;
  height?: number;
  color?: string;
}

interface BarProps {
  levels: { value: number[] };
  index: number;
  total: number;
  width: number;
  height: number;
  color: string;
}

function Bar({ levels, index, total, width, height, color }: BarProps) {
  const animated = useAnimatedStyle(() => {
    const amp = levels.value[index] ?? 0.06;
    return { height: Math.max(3, amp * height) };
  });
  // Trilha: as barras mais novas (a direita) ficam mais vivas.
  const opacity = 0.28 + 0.6 * (index / Math.max(1, total - 1));
  return (
    <Animated.View
      style={[styles.bar, { width, borderRadius: width / 2, backgroundColor: color, opacity }, animated]}
    />
  );
}

/**
 * Waveform ao vivo a 60 fps. As barras e o nivel suavizado vivem em shared values
 * e sao atualizados na thread de UI (useFrameCallback), sem re-render do React.
 */
export function LiveWaveform({
  active,
  paused = false,
  level,
  bars = DEFAULT_BARS,
  height = 120,
  color = colors.accent,
}: LiveWaveformProps) {
  const levels = useSharedValue<number[]>(new Array(bars).fill(0.06));
  const target = useSharedValue(0);
  const smoothed = useSharedValue(0);

  useEffect(() => {
    target.value = Math.max(0.05, Math.min(1, level));
  }, [level, target]);

  const frame = useFrameCallback(() => {
    'worklet';
    smoothed.value = smoothed.value + (target.value - smoothed.value) * 0.16;
    const prev = levels.value;
    const next = new Array<number>(prev.length);
    for (let i = 0; i < prev.length - 1; i += 1) {
      next[i] = prev[i + 1];
    }
    next[prev.length - 1] = Math.max(0.05, smoothed.value * (0.5 + 0.5 * Math.random()));
    levels.value = next;
  }, false);

  useEffect(() => {
    frame.setActive(Boolean(active));
    return () => frame.setActive(false);
  }, [active, frame]);

  const width = 2.5;

  return (
    <View style={[styles.row, { height, opacity: paused ? 0.45 : 1 }]}>
      {Array.from({ length: bars }).map((_, index) => (
        <Bar
          key={index}
          levels={levels}
          index={index}
          total={bars}
          width={width}
          height={height}
          color={color}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bar: { backgroundColor: colors.accent },
});
