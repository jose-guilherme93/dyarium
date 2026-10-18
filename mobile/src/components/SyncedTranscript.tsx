import { type AudioPlayer } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { activeSegmentIndex } from '@/core/transcript';
import type { TranscriptSegment } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { motionDuration } from '@/theme/motion';
import { colors, fontSize, spacing } from '@/theme/tokens';

type PlayerHandle = AudioPlayer;

/** Altura de uma linha e quantas ficam visiveis na previa. */
const LINE = 22;
const VISIBLE = 5;
const VIEWPORT = LINE * VISIBLE;
/** Ponto (y) onde o centro da fala atual fica: no meio da janela. */
const CENTER = VIEWPORT / 2;

interface SyncedTranscriptProps {
  player: PlayerHandle;
  segments: TranscriptSegment[];
  onPress?: () => void;
}

/**
 * Previa da transcricao que acompanha o audio: a fala atual fica no meio e o
 * texto sobe suavemente conforme o play avanca. Nenhum trecho e cortado (quebra
 * linha se precisar); a posicao usa a altura real medida de cada trecho. Toque
 * abre a transcricao completa.
 */
export function SyncedTranscript({ player, segments, onPress }: SyncedTranscriptProps) {
  useRenderCount('SyncedTranscript');
  // So re-renderiza quando o trecho ativo muda: assina o player e compara o
  // indice, em vez de acompanhar cada tick (que roda varias vezes por segundo).
  const [active, setActive] = useState(0);
  useEffect(() => {
    const apply = (currentMs: number) => {
      const index = activeSegmentIndex(segments, currentMs);
      const next = index < 0 ? 0 : index;
      setActive((prev) => (prev === next ? prev : next));
    };
    apply((player.currentTime || 0) * 1000);
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      apply((status.currentTime || 0) * 1000);
    });
    return () => subscription.remove();
  }, [player, segments]);

  const translateY = useSharedValue(0);
  // Posicao/altura reais de cada trecho, medidas pelo layout (texto quebra linha).
  const offsets = useRef<Record<number, { y: number; height: number }>>({});
  // Cada medida incrementa o tick; o efeito abaixo recentraliza sem depender de
  // um segundo render manual (e sem chamar setState dentro de efeito).
  const [layoutTick, setLayoutTick] = useState(0);
  // Na primeira posicao a janela pula direto (sem deslizar ao abrir a nota).
  const positioned = useRef(false);

  const handleLayout = useCallback((index: number, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    offsets.current[index] = { y, height };
    setLayoutTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    const info = offsets.current[active];
    if (!info) return;
    const target = CENTER - (info.y + info.height / 2);
    translateY.value = positioned.current
      ? withTiming(target, { duration: motionDuration(450), easing: Easing.inOut(Easing.ease) })
      : target;
    positioned.current = true;
  }, [active, layoutTick, translateY]);

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // So remonta as linhas quando o trecho ativo muda (nao a cada atualizacao de
  // tempo, que roda ~4x/s durante o play). Renderiza uma janela em volta do
  // trecho ativo: uma nota com horas de transcricao nao monta milhares de
  // `Text` so para mostrar cinco linhas.
  const start = Math.max(0, active - 2);
  const end = Math.min(segments.length, start + VISIBLE + 3);

  const lines = useMemo(
    () =>
      segments.slice(start, end).map((segment, offset) => {
        const index = start + offset;
        return (
          <Text
            key={`${segment.start_ms}-${index}`}
            onLayout={(event) => handleLayout(index, event)}
            style={[styles.line, index === active && styles.lineActive]}
          >
            {segment.text}
          </Text>
        );
      }),
    [segments, start, end, active, handleLayout],
  );

  return (
    <Pressable
      style={styles.section}
      onPress={onPress}
      accessibilityLabel="Abrir transcrição completa"
    >
      <Text style={styles.label}>Transcrição</Text>
      <View style={styles.viewport}>
        <Animated.View style={[styles.track, trackStyle]}>{lines}</Animated.View>
        <LinearGradient
          colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
          style={styles.fadeTop}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,1)']}
          style={styles.fadeBottom}
          pointerEvents="none"
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  label: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  viewport: { height: VIEWPORT, overflow: 'hidden' },
  track: { position: 'absolute', left: 0, right: 0, top: 0 },
  line: {
    fontSize: fontSize.md,
    lineHeight: LINE,
    paddingVertical: spacing.xs,
    color: colors.textSecondary,
  },
  lineActive: { color: colors.text },
  fadeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 14 },
  fadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 14 },
});
