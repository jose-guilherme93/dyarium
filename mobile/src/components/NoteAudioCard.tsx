/**
 * Card de audio do corpo da nota.
 *
 * O audio e nativo e fica entre os trechos, com a transcricao logo abaixo. Quem
 * toca e o player unico do app, passado pela tela da nota: o card nao cria um
 * player proprio (dois players tocavam o mesmo audio e cada um tinha o seu
 * botao de play).
 */

import { Ionicons } from '@expo/vector-icons';
import type { AudioPlayer } from 'expo-audio';
import {
  ActivityIndicator,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';

import { AudioTransport } from '@/components/AudioTransport';
import { AudioWaveform } from '@/components/AudioWaveform';
import { Press } from '@/components/Press';
import { SyncedTranscript } from '@/components/SyncedTranscript';
import { formatDuration } from '@/core/format';
import type { NoteAudioNode } from '@/core/noteDocument';
import type { TranscriptSegment } from '@/core/types';
import { baseColors, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export interface NoteAudioCardProps {
  node: NoteAudioNode;
  /** Transcricao do audio, quando houver. */
  transcript?: string;
  /** Segmentos com minutagem: ligam a previa sincronizada e a edicao. */
  segments?: TranscriptSegment[];
  /** Este e o audio que esta no player agora. */
  active?: boolean;
  /** Player unico do app (so quando `active`). */
  player?: AudioPlayer | null;
  /** Trecho inicial quando a reproducao comecou pela transcricao. */
  startMs?: number | null;
  /** Progresso (0..100) da transcricao, enquanto ela roda. */
  transcribingPercent?: number;
  /** Transcricao pedida e ainda sem andamento (ex.: feita no servidor). */
  transcribingWait?: boolean;
  /** Ha modelo local e a nota ainda nao tem transcricao? */
  canTranscribe?: boolean;
  onTranscribe?: () => void;
  onStopTranscribe?: () => void;
  /** Toca este audio do inicio. */
  onPlay?: () => void;
  /** Toca este audio a partir de um trecho (audio parado). */
  onPlayFrom?: (startMs: number) => void;
  onOpenTranscript?: () => void;
  onEditTranscript?: (startMs: number) => void;
  onRemove?: () => void;
}

/** Audio do documento: player entre os trechos de texto. */
export function NoteAudioCard({
  node,
  transcript,
  segments,
  active = false,
  player,
  startMs,
  transcribingPercent,
  transcribingWait = false,
  canTranscribe,
  onTranscribe,
  onStopTranscribe,
  onPlay,
  onPlayFrom,
  onOpenTranscript,
  onEditTranscript,
  onRemove,
}: NoteAudioCardProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const transcribing = transcribingPercent !== undefined || transcribingWait;
  const hasSegments = Boolean(segments && segments.length > 0);

  return (
    <View style={styles.audioCard}>
      <View style={styles.audioRow}>
        {active ? null : (
          <Press style={styles.audioPlay} onPress={onPlay} accessibilityLabel="Tocar áudio">
            <Ionicons
              name="play"
              size={18}
              color={colors.text}
              style={{ marginLeft: 2 }}
            />
          </Press>
        )}
        <View style={styles.audioInfo}>
          <Text style={styles.audioTitle}>Áudio</Text>
          {active ? null : (
            <Text style={styles.audioDuration}>
              {node.durationMs > 0 ? formatDuration(node.durationMs) : 'Duração desconhecida'}
            </Text>
          )}
        </View>
        {transcribing ? (
          <Press onPress={onStopTranscribe} accessibilityLabel="Parar transcrição" hitSlop={8}>
            <Ionicons name="stop-circle-outline" size={18} color={colors.textSecondary} />
          </Press>
        ) : canTranscribe && onTranscribe ? (
          <Press onPress={onTranscribe} accessibilityLabel="Transcrever áudio" hitSlop={8}>
            <Ionicons name="text-outline" size={17} color={colors.textSecondary} />
          </Press>
        ) : (
          <Ionicons name="mic-outline" size={17} color={colors.textTertiary} />
        )}
        <Press onPress={onRemove} accessibilityLabel="Remover áudio" hitSlop={8}>
          <Ionicons name="trash-outline" size={17} color={colors.textTertiary} />
        </Press>
      </View>

      {active && player ? (
        <AudioTransport
          player={player}
          seed={node.ref}
          durationMs={node.durationMs}
          startMs={startMs}
          segments={segments}
          transcript={transcript}
          onOpenTranscript={onOpenTranscript}
          onEditTranscript={onEditTranscript}
        />
      ) : (
        // Parado, a onda continua ali: tocar nela ja toca o audio dali, sem
        // precisar abrir a transcricao so para escolher um ponto.
        <AudioWaveform
          seed={node.ref}
          current={0}
          duration={node.durationMs / 1000}
          segments={segments}
          label="Ouvir a partir de"
          onSeek={(seconds) => onPlayFrom?.(Math.round(seconds * 1000))}
        />
      )}

      {active && player ? null : hasSegments ? (
        <SyncedTranscript
          segments={segments ?? []}
          onSeek={onPlayFrom}
          onOpen={onOpenTranscript}
          onEdit={onEditTranscript}
        />
      ) : transcript ? (
        onOpenTranscript ? (
          // O texto e o proprio atalho para a transcricao completa (onde cada
          // frase e a minutagem podem ser editadas), como era antes.
          <Press onPress={onOpenTranscript} accessibilityLabel="Abrir transcrição completa">
            <Text style={styles.audioTranscript} numberOfLines={3} testID="audio-transcript">
              {transcript}
            </Text>
          </Press>
        ) : (
          <Text style={styles.audioTranscript} numberOfLines={3} testID="audio-transcript">
            {transcript}
          </Text>
        )
      ) : null}

      {transcribing ? (
        <View style={styles.transcribing} testID="audio-transcribing">
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.audioHint}>
            Transcrevendo
            {transcribingPercent && transcribingPercent > 0
              ? ` ${Math.round(transcribingPercent)}%`
              : '...'}
          </Text>
        </View>
      ) : null}
      {transcribing && transcribingPercent !== undefined ? (
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, transcribingPercent))}%` }]}
          />
        </View>
      ) : null}
    </View>
  );
}

const baseStyles = defineStyles({
  audioCard: {
    // Reserva o espaco da previa da transcricao: sem isso, a nota inteira
    // pulava quando o texto chegava ou o player abria.
    minHeight: 128,
    backgroundColor: baseColors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  transcribing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: baseColors.surfaceElevated,
    overflow: 'hidden',
  },
  progressFill: { height: 2, backgroundColor: baseColors.accent },
  audioPlay: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: baseColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioInfo: { flex: 1, gap: 2 },
  audioTitle: { color: baseColors.text, fontSize: 15, fontWeight: '600' },
  audioDuration: { color: baseColors.textSecondary, fontSize: 12 },
  audioHint: { color: baseColors.textSecondary, fontSize: 12 },
  audioTranscript: { color: baseColors.textSecondary, fontSize: 13, lineHeight: 19 },
});
