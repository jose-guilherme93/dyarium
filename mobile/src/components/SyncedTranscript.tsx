/**
 * Previa da transcricao que acompanha o audio.
 *
 * A janela mostra cinco linhas e sobe suave conforme a fala avanca. O texto de
 * cada trecho nao e cortado (quebra linha se precisar) e a posicao usa a altura
 * real medida de cada linha.
 *
 * Toque numa linha toca o audio dali; toque longo abre a edicao daquele trecho
 * na transcricao completa. Se a pessoa arrastar a janela com o dedo, o
 * acompanhamento pausa e volta sozinho tres segundos depois.
 *
 * A previa pode viver sem player (audio parado): ela mostra o comeco da
 * transcricao e qualquer linha continua levando o audio para o trecho.
 */

import { type AudioPlayer } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { Press } from '@/components/Press';
import { formatDuration } from '@/core/format';
import { activeSegmentIndex } from '@/core/transcript';
import type { TranscriptSegment } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

/** Altura de uma linha e quantas ficam visiveis na previa. */
const LINE = 22;
/** Respiro vertical de cada linha (entra na altura real da janela). */
const LINE_PAD = 1;
const VISIBLE = 5;
const VIEWPORT = (LINE + LINE_PAD * 2) * VISIBLE;
/** Quantas linhas ficam montadas em volta do trecho atual. */
const WINDOW = 80;
/** Tempo com o dedo parado antes de voltar a seguir o audio. */
const RESUME_MS = 3000;

interface SyncedTranscriptProps {
  /** Player do audio (ausente quando o audio esta parado). */
  player?: AudioPlayer | null;
  segments: TranscriptSegment[];
  /** Abre a tela de transcricao completa. */
  onOpen?: () => void;
  /** Toca o audio a partir do trecho (ms). */
  onSeek?: (startMs: number) => void;
  /** Abre a edicao do trecho (ms). */
  onEdit?: (startMs: number) => void;
}

export function SyncedTranscript({
  player,
  segments,
  onOpen,
  onSeek,
  onEdit,
}: SyncedTranscriptProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  useRenderCount('SyncedTranscript');
  // So re-renderiza quando o trecho ativo muda: assina o player e compara o
  // indice, em vez de acompanhar cada tick (que roda varias vezes por segundo).
  const [active, setActive] = useState(() =>
    player
      ? Math.max(0, activeSegmentIndex(segments, (player.currentTime || 0) * 1000))
      : 0,
  );
  useEffect(() => {
    if (!player) return undefined;
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      const index = activeSegmentIndex(segments, (status.currentTime || 0) * 1000);
      const next = index < 0 ? 0 : index;
      setActive((prev) => (prev === next ? prev : next));
    });
    return () => subscription.remove();
  }, [player, segments]);

  const [following, setFollowing] = useState(true);
  // Com o dedo na janela, a ancora congela no trecho em que o usuario parou.
  // So muda no gesto; enquanto segue, a ancora nem e usada.
  const [anchor, setAnchor] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<number, { y: number; height: number }>>({});
  const [layoutTick, setLayoutTick] = useState(0);
  const positioned = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focus = following ? active : anchor;

  const handleLayout = useCallback((index: number, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    offsets.current[index] = { y, height };
    setLayoutTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (!following) return;
    const info = offsets.current[focus];
    if (!info) return;
    const target = Math.max(0, info.y - VIEWPORT / 2 + info.height / 2);
    scrollRef.current?.scrollTo({ y: target, animated: positioned.current });
    positioned.current = true;
  }, [focus, following, layoutTick]);

  const pauseFollow = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    setAnchor(active);
    setFollowing(false);
  }, [active]);

  const scheduleResume = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      setFollowing(true);
    }, RESUME_MS);
  }, []);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  // Monta uma janela em volta da ancora: uma nota com horas de transcricao nao
  // cria milhares de `Text` para mostrar cinco linhas.
  const start = Math.max(0, Math.min(focus - WINDOW / 2, segments.length - WINDOW));
  const end = Math.min(segments.length, start + WINDOW);

  const lines = useMemo(
    () =>
      segments.slice(start, end).map((segment, offset) => {
        const index = start + offset;
        return (
          <Press
            key={`${segment.start_ms}-${index}`}
            onLayout={(event) => handleLayout(index, event)}
            onPress={() => onSeek?.(segment.start_ms)}
            onLongPress={onEdit ? () => onEdit(segment.start_ms) : undefined}
            delayLongPress={350}
            accessibilityLabel={`Ouvir a partir de ${formatDuration(segment.start_ms)}`}
          >
            <Text style={[styles.line, index === active && styles.lineActive]}>
              {segment.text}
            </Text>
          </Press>
        );
      }),
    [segments, start, end, active, handleLayout, onSeek, onEdit, styles],
  );

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.label}>Transcrição</Text>
        {onOpen ? (
          <Press onPress={onOpen} accessibilityLabel="Abrir transcrição completa" hitSlop={8}>
            <Text style={styles.open}>Ver tudo</Text>
          </Press>
        ) : null}
      </View>
      <View style={styles.viewport}>
        <ScrollView
          ref={scrollRef}
          testID="transcript-window"
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          scrollEventThrottle={32}
          onScrollBeginDrag={pauseFollow}
          onScrollEndDrag={scheduleResume}
          onMomentumScrollEnd={scheduleResume}
        >
          {lines}
        </ScrollView>
        <LinearGradient
          colors={[colors.surface, 'rgba(0,0,0,0)']}
          style={styles.fadeTop}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(0,0,0,0)', colors.surface]}
          style={styles.fadeBottom}
          pointerEvents="none"
        />
      </View>
    </View>
  );
}

const baseStyles = defineStyles({
  section: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  open: { color: baseColors.accentStrong, fontSize: fontSize.xs, fontWeight: '600' },
  label: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  viewport: { height: VIEWPORT, overflow: 'hidden' },
  line: {
    fontSize: fontSize.md,
    lineHeight: LINE,
    paddingVertical: LINE_PAD,
    color: baseColors.textSecondary,
  },
  lineActive: { color: baseColors.text },
  fadeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 14 },
  fadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 14 },
});
