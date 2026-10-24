/**
 * Waveform da gravacao.
 *
 * Simples de proposito: 40 barras comuns cuja altura vem do nivel do microfone.
 * O medidor entrega uma amostra a cada 250 ms, entao cada amostra empurra a
 * onda uma barra para a esquerda — sem animacao por frame, sem Reanimated e sem
 * trabalho na thread de UI enquanto o audio e capturado.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { baseColors } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const DEFAULT_BARS = 40;
const MIN_LEVEL = 0.06;
const BAR_WIDTH = 3.5;

interface LiveWaveformProps {
  /** Gravando (a onda anda). Fora disso, as barras ficam no minimo. */
  active: boolean;
  /** Pausado: mantem as barras, mais discretas. */
  paused?: boolean;
  /** Nivel ao vivo do microfone (0..1). */
  level: number;
  bars?: number;
  height?: number;
  color?: string;
}

export function LiveWaveform({
  active,
  paused = false,
  level,
  bars = DEFAULT_BARS,
  height = 120,
  color,
}: LiveWaveformProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const barColor = color ?? colors.accent;

  const [levels, setLevels] = useState<number[]>(() =>
    new Array(bars).fill(MIN_LEVEL),
  );

  useEffect(() => {
    // Pausado: a onda congela como esta, para o usuario ver onde parou.
    if (paused) return;
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLevels((current) =>
        current.every((value) => value === MIN_LEVEL)
          ? current
          : new Array(bars).fill(MIN_LEVEL),
      );
      return;
    }
    const next = Math.max(MIN_LEVEL, Math.min(1, level));
    // O nivel chega do medidor a 4 Hz e a onda e um buffer deslizante de
    // amostras; derivar isso durante o render exigiria comparar estado a cada
    // quadro. Um estado por amostra e o caminho mais simples aqui.
    setLevels((current) => {
      const size = current.length;
      if (size !== bars) return new Array(bars).fill(MIN_LEVEL);
      return [...current.slice(1), next];
    });
  }, [active, paused, bars, level]);

  return (
    <View style={[styles.row, { height, opacity: paused ? 0.45 : 1 }]}>
      {levels.map((value, index) => (
        <View
          key={index}
          testID={`wave-bar-${index}`}
          style={[
            styles.bar,
            {
              width: BAR_WIDTH,
              height: Math.max(3, value * height),
              borderRadius: BAR_WIDTH / 2,
              backgroundColor: barColor,
              opacity: 0.28 + (0.6 * index) / Math.max(1, bars - 1),
            },
          ]}
        />
      ))}
    </View>
  );
}

const baseStyles = defineStyles({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bar: { backgroundColor: baseColors.accent },
});
