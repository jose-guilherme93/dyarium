import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { Press } from '@/components/Press';

import { TagChip } from '@/components/TagChip';
import { formatDuration, formatStamp, noteDateIso } from '@/core/format';
import { markdownPreview } from '@/core/richText';
import { displayTitle } from '@/core/title';
import { checkpointPercent } from '@/core/transcription';
import type { Recording } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { useTranscriptionProgress } from '@/state/useTranscriptionProgress';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { defineStyles } from '@/theme/themedStyles';

interface RecordingCardProps {
  recording: Recording;
  /** Abre a tela da nota. */
  onOpen?: (noteId: string) => void;
  /** Toque longo: abre as opcoes perto do dedo (arquivar, apagar, propriedades). */
  onLongPress?: (item: Recording, anchor: { x: number; y: number }) => void;
  /** Nome do caderno, mostrado na busca global. */
  notebookLabel?: string;
  /** Linha compacta da home, sem cartao arredondado e com divisor. */
  dense?: boolean;
}

/**
 * Card da lista. Sem botao de play nem tres pontinhos: o audio so toca dentro da
 * nota, e as opcoes abrem com um toque longo (menu bonito, igual ao da nota).
 * Memoizado e com callbacks estaveis (recebe o item/ancora) para nao re-renderizar
 * junto com a lista.
 */
export const RecordingCard = memo(function RecordingCard({
  recording,
  onOpen,
  onLongPress,
  notebookLabel,
  dense = false,
}: RecordingCardProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  useRenderCount('RecordingCard');
  const hasAudio = Boolean(recording.filePath);
  const tags = recording.tags ?? [];
  // O card mostra uma linha, mas a lista re-renderiza varios cards por ciclo:
  // converter a nota inteira a cada render custava caro na home.
  const preview = useMemo(
    () => markdownPreview(hasAudio ? recording.transcript : recording.text),
    [hasAudio, recording.transcript, recording.text],
  );
  // Transcricao em andamento: mostra um icone discreto + porcentagem no canto.
  const transcribing =
    hasAudio && recording.transcriptStatus === 'pending' && !recording.hasTranscript;
  const livePercent = useTranscriptionProgress(recording.id, transcribing);
  const percent = livePercent > 0 ? Math.round(livePercent) : checkpointPercent(recording);

  return (
    <View style={[styles.wrap, dense ? styles.wrapDense : null]}>
      <Press
        style={[styles.content, dense ? styles.contentDense : null]}
        onPress={() => onOpen?.(recording.id)}
        onLongPress={(event: GestureResponderEvent) =>
          onLongPress?.(recording, { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })
        }
        delayLongPress={350}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {displayTitle(recording)}
          </Text>
          {transcribing ? (
            <View style={styles.transcribing} accessibilityLabel={`Transcrevendo ${percent}%`}>
              <Ionicons name="sync-outline" size={11} color={colors.accentStrong} />
              <Text style={styles.transcribingText}>{percent}%</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.subRow}>
          <Ionicons
            name={hasAudio ? 'mic-outline' : 'document-text-outline'}
            size={11}
            color={colors.textTertiary}
          />
          {recording.source === 'share' ? (
            <Ionicons name="download-outline" size={12} color={colors.info} />
          ) : null}
          {recording.durationMs ? (
            <Text style={styles.sub}>{formatDuration(recording.durationMs)}</Text>
          ) : null}
          {recording.archived ? <Text style={styles.sub}>· arquivada</Text> : null}
          {notebookLabel ? (
            <Text style={styles.sub} numberOfLines={1}>
              · {notebookLabel}
            </Text>
          ) : null}
        </View>

        {tags.length > 0 ? (
          <View style={styles.tags}>
            {tags.slice(0, 2).map((tag) => (
              <TagChip key={tag.toLowerCase()} name={tag} size="sm" />
            ))}
            {tags.length > 2 ? <Text style={styles.more}>+{tags.length - 2}</Text> : null}
          </View>
        ) : null}

        <View style={styles.footer}>
          {preview ? (
            <Text style={styles.preview} numberOfLines={1}>
              {preview}
            </Text>
          ) : (
            <View style={styles.grow} />
          )}
          <Text style={styles.stamp}>{formatStamp(noteDateIso(recording))}</Text>
        </View>
      </Press>
    </View>
  );
});

const baseStyles = defineStyles({
  wrap: {
    backgroundColor: baseColors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  wrapDense: {
    backgroundColor: baseColors.bg,
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  content: { padding: spacing.md, gap: 3 },
  contentDense: { paddingHorizontal: spacing.lg, paddingVertical: 10, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  transcribing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: baseColors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  transcribingText: {
    color: baseColors.accentStrong,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sub: { color: baseColors.textSecondary, fontSize: fontSize.xs },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 2 },
  more: { color: baseColors.textTertiary, fontSize: 10, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: 2 },
  grow: { flex: 1 },
  preview: { flex: 1, color: baseColors.textTertiary, fontSize: fontSize.sm },
  stamp: { color: baseColors.textTertiary, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
});
