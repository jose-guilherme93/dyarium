/**
 * Onda do audio com a posicao: toque ou arraste em qualquer ponto para pular
 * para aquele trecho.
 *
 * As barras ja tocadas usam a cor de destaque e o resto fica no tom neutro,
 * como o Telegram desenha um audio. Enquanto o dedo esta na tela mostramos a
 * posicao dele; o seek real acontece ao soltar, para nao inundar o player de
 * comandos. A forma da onda vem de `waveformBars`, que e estavel por audio.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type View as ViewType,
} from 'react-native';

import { formatDuration } from '@/core/format';
import { WAVE_BARS, waveformBars } from '@/core/waveform';
import type { TranscriptSegment } from '@/core/types';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const BAR_GAP = 1;
const MIN_BAR = 2.5;

/**
 * Posicao horizontal do toque dentro da onda, em dp.
 *
 * `locationX` vem relativo ao alvo do evento, que pode ser uma barra da onda e
 * nao a onda inteira: usar o `pageX` menos a origem medida da view e o que
 * garante que o toque caia onde o dedo encostou. Sem a origem (primeiro
 * layout), o `locationX` ainda serve.
 */
export function waveTouchX(
  pageX: number | undefined,
  locationX: number | undefined,
  originX: number | null,
): number | null {
  if (originX != null && Number.isFinite(pageX)) return (pageX as number) - originX;
  if (Number.isFinite(locationX)) return locationX as number;
  return null;
}

interface AudioWaveformProps {
  /** Semente estavel da onda: a referencia do audio. */
  seed: string;
  /** Posicao atual em segundos. */
  current: number;
  /** Duracao total em segundos (0 desabilita a interacao). */
  duration: number;
  segments?: readonly TranscriptSegment[];
  bars?: number;
  height?: number;
  /** Rotulo de acessibilidade; o valor lido completa a frase. */
  label?: string;
  onSeek: (seconds: number) => void;
  /** Posicao sob o dedo (null quando soltou): o texto do tempo acompanha. */
  onScrubChange?: (seconds: number | null) => void;
}

export function AudioWaveform({
  seed,
  current,
  duration,
  segments,
  bars = WAVE_BARS,
  height = 48,
  label = 'Posição do áudio',
  onSeek,
  onScrubChange,
}: AudioWaveformProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const hitRef = useRef<ViewType>(null);
  /** Origem absoluta da onda, para converter `pageX` em posicao na barra. */
  const originX = useRef<number | null>(null);

  const levels = useMemo(
    () => waveformBars(seed, bars, Math.round(Math.max(0, duration) * 1000), segments),
    [seed, bars, duration, segments],
  );

  const total = duration > 0 ? duration : 0;
  const position = Math.min(total, Math.max(0, scrub ?? current));
  const progress = total > 0 ? position / total : 0;
  const barWidth = width > 0 ? Math.max(1, (width - BAR_GAP * (bars - 1)) / bars) : 0;
  const barHeight = Math.max(MIN_BAR, height - 6);

  const measureOrigin = useCallback(() => {
    hitRef.current?.measureInWindow((x) => {
      originX.current = Number.isFinite(x) ? x : null;
    });
  }, []);

  const update = (event: GestureResponderEvent) => {
    const { pageX, locationX } = event.nativeEvent;
    const x = waveTouchX(pageX, locationX, originX.current);
    if (x === null || width <= 0 || duration <= 0) return;
    const ratio = Math.min(1, Math.max(0, x / width));
    const value = ratio * duration;
    scrubRef.current = value;
    setScrub(value);
    onScrubChange?.(value);
  };

  const release = () => {
    const value = scrubRef.current;
    scrubRef.current = null;
    setScrub(null);
    onScrubChange?.(null);
    if (value !== null) onSeek(value);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
    measureOrigin();
  };

  /** TalkBack nao arrasta a onda: incrementar/decrementar anda 10 s. */
  const nudge = (delta: number) => {
    if (total <= 0) return;
    onSeek(Math.min(total, Math.max(0, position + delta)));
  };

  return (
    <View
      ref={hitRef}
      style={[styles.hit, { height }]}
      onLayout={handleLayout}
      onStartShouldSetResponder={() => duration > 0}
      onMoveShouldSetResponder={() => duration > 0}
      onResponderGrant={update}
      onResponderMove={update}
      onResponderRelease={release}
      onResponderTerminate={release}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        min: 0,
        max: Math.round(total),
        now: Math.round(position),
        text: formatDuration(position * 1000),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        nudge(event.nativeEvent.actionName === 'increment' ? 10 : -10);
      }}
    >
      <View style={styles.row} pointerEvents="none">
        {levels.map((level, index) => {
          const played = total > 0 && (index + 0.5) / levels.length <= progress;
          return (
            <View
              key={index}
              testID={`wave-bar-${index}`}
              style={[
                styles.bar,
                {
                  width: barWidth,
                  height: Math.max(MIN_BAR, level * barHeight),
                  backgroundColor: played ? colors.accent : colors.borderStrong,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const baseStyles = defineStyles({
  hit: { justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bar: { borderRadius: 2 },
});
