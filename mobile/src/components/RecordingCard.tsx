import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { formatDuration, formatStamp } from '@/core/format';
import { markdownToPlain } from '@/core/richText';
import { displayTitle } from '@/core/title';
import type { Recording } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

interface RecordingCardProps {
  recording: Recording;
  /** Abre a tela da nota. */
  onOpen?: (noteId: string) => void;
  /** Toque longo: abre as opcoes perto do dedo (arquivar, apagar, propriedades). */
  onLongPress?: (item: Recording, anchor: { x: number; y: number }) => void;
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
}: RecordingCardProps) {
  useRenderCount('RecordingCard');
  const hasAudio = Boolean(recording.filePath);
  const rawPreview = hasAudio ? recording.transcript : recording.text;
  const preview = rawPreview ? markdownToPlain(rawPreview) : '';

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.content}
        onPress={() => onOpen?.(recording.id)}
        onLongPress={(event: GestureResponderEvent) =>
          onLongPress?.(recording, { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })
        }
        delayLongPress={350}
      >
        <Text style={styles.title} numberOfLines={1}>
          {displayTitle(recording)}
        </Text>

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
        </View>

        <View style={styles.footer}>
          {preview ? (
            <Text style={styles.preview} numberOfLines={1}>
              {preview}
            </Text>
          ) : (
            <View style={styles.grow} />
          )}
          <Text style={styles.stamp}>{formatStamp(recording.createdAt)}</Text>
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  content: { padding: spacing.md, gap: 3 },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sub: { color: colors.textSecondary, fontSize: fontSize.xs },
  footer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: 2 },
  grow: { flex: 1 },
  preview: { flex: 1, color: colors.textTertiary, fontSize: fontSize.sm },
  stamp: { color: colors.textTertiary, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
});
