/**
 * Barra de progresso arrastavel do audio da nota.
 *
 * Toque ou arraste em qualquer ponto da barra para pular para aquele trecho.
 * Enquanto o dedo esta na tela mostramos a posicao do dedo; o seek real
 * acontece ao soltar, para nao inundar o player de comandos.
 */

import { useRef, useState } from 'react';
import { View, type GestureResponderEvent } from 'react-native';

import { baseColors } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface AudioSeekBarProps {
  /** Posicao atual em segundos. */
  current: number;
  /** Duracao total em segundos (0 desabilita a barra). */
  duration: number;
  onSeek: (seconds: number) => void;
  /** Posicao sob o dedo (null quando soltou): o texto do tempo acompanha. */
  onScrubChange?: (seconds: number | null) => void;
}

const THUMB = 12;
const HIT_HEIGHT = 32;

export function AudioSeekBar({ current, duration, onSeek, onScrubChange }: AudioSeekBarProps) {
  const styles = useThemedStyles(baseStyles);

  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);

  const update = (x: number) => {
    if (width <= 0 || duration <= 0) return;
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

  const total = duration > 0 ? duration : 0;
  const position = Math.min(total, Math.max(0, scrub ?? current));
  const progress = total > 0 ? position / total : 0;
  const thumbLeft = Math.min(
    Math.max(0, width - THUMB),
    Math.max(0, progress * width - THUMB / 2),
  );

  return (
    <View
      style={styles.hit}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event: GestureResponderEvent) => update(event.nativeEvent.locationX)}
      onResponderMove={(event: GestureResponderEvent) => update(event.nativeEvent.locationX)}
      onResponderRelease={release}
      onResponderTerminate={release}
      accessibilityRole="adjustable"
      accessibilityLabel="Posição do áudio"
      accessibilityValue={{ min: 0, max: Math.round(total), now: Math.round(position) }}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <View style={[styles.thumb, { left: thumbLeft }]} />
    </View>
  );
}

const baseStyles = defineStyles({
  hit: { height: HIT_HEIGHT, justifyContent: 'center' },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: baseColors.surfaceElevated,
    overflow: 'hidden',
  },
  fill: { height: 4, backgroundColor: baseColors.accent },
  thumb: {
    position: 'absolute',
    top: (HIT_HEIGHT - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: baseColors.accentStrong,
  },
});

export default AudioSeekBar;
