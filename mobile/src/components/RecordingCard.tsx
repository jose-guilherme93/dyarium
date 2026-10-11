import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatBytes, formatDuration } from '@/core/format';
import type { Recording } from '@/core/types';
import { colors, fontSize, spacing } from '@/theme/tokens';

import { Card } from './Card';
import { StatusChip } from './StatusChip';

interface RecordingCardProps {
  recording: Recording;
  onRetry: () => void;
  onDelete: () => void;
}

export function RecordingCard({ recording, onRetry, onDelete }: RecordingCardProps) {
  const [showPlayer, setShowPlayer] = useState(false);
  const progress =
    recording.sizeBytes && recording.sizeBytes > 0
      ? Math.min(1, recording.offset / recording.sizeBytes)
      : 0;
  const canPlay = Boolean(recording.filePath);
  const canRetry = recording.status === 'failed' || recording.status === 'completed';

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{recording.title}</Text>
          <View style={styles.metaRow}>
            <StatusChip status={recording.status} />
            {recording.durationMs ? (
              <Text style={styles.meta}>{formatDuration(recording.durationMs)}</Text>
            ) : null}
            {recording.sizeBytes ? (
              <Text style={styles.meta}>{formatBytes(recording.sizeBytes)}</Text>
            ) : null}
          </View>
        </View>
        {recording.status === 'completed' ? (
          <Ionicons name="cloud-done" size={22} color={colors.success} />
        ) : null}
      </View>

      {recording.status === 'uploading' ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}

      {recording.status === 'failed' && recording.lastError ? (
        <Text style={styles.error} numberOfLines={2}>
          {recording.lastError}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {canPlay ? (
          <Pressable
            style={styles.action}
            onPress={() => setShowPlayer((value) => !value)}
            accessibilityLabel="Ouvir gravacao"
          >
            <Ionicons
              name={showPlayer ? 'chevron-up' : 'play-circle'}
              size={26}
              color={colors.accent}
            />
          </Pressable>
        ) : null}
        {canRetry ? (
          <Pressable style={styles.action} onPress={onRetry} accessibilityLabel="Reenviar">
            <Ionicons name="refresh" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        <View style={styles.spacer} />
        <Pressable style={styles.action} onPress={onDelete} accessibilityLabel="Apagar">
          <Ionicons name="trash-outline" size={22} color={colors.textTertiary} />
        </Pressable>
      </View>

      {showPlayer && recording.filePath ? <CardPlayer uri={recording.filePath} /> : null}
    </Card>
  );
}

function CardPlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const duration = status.duration || 0;
  const current = status.currentTime || 0;
  const pct = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <View style={styles.player}>
      <Pressable
        onPress={() => {
          if (status.playing) player.pause();
          else player.play();
        }}
        accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}
      >
        <Ionicons name={status.playing ? 'pause' : 'play'} size={26} color={colors.accent} />
      </Pressable>
      <View style={styles.playerTrack}>
        <View style={[styles.playerFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      <Text style={styles.meta}>{formatDuration(current * 1000)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1, gap: spacing.sm },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  meta: { color: colors.textTertiary, fontSize: fontSize.xs },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  error: { color: colors.danger, fontSize: fontSize.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  action: { padding: spacing.xs },
  spacer: { flex: 1 },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  playerTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
  },
  playerFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
});
