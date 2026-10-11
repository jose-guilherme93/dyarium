import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatBytes, formatDuration } from '@/core/format';
import type { Recording } from '@/core/types';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

import { STATUS_META } from './StatusChip';
import { Waveform } from './Waveform';

interface RecordingCardProps {
  recording: Recording;
  onRetry: () => void;
  onDelete: () => void;
}

export function RecordingCard({ recording, onRetry, onDelete }: RecordingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const player = useAudioPlayer(recording.filePath ?? null);
  const status = useAudioPlayerStatus(player);
  const meta = STATUS_META[recording.status];

  const duration = status.duration || (recording.durationMs ?? 0) / 1000;
  const current = status.currentTime || 0;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const uploading = recording.status === 'uploading';
  const uploadProgress =
    recording.sizeBytes && recording.sizeBytes > 0
      ? Math.min(1, recording.offset / recording.sizeBytes)
      : 0;

  const togglePlay = () => {
    if (status.playing) {
      player.pause();
    } else {
      if (duration > 0 && current >= duration - 0.1) player.seekTo(0);
      player.play();
    }
  };

  const skip = (seconds: number) => {
    const target = Math.max(0, Math.min(duration, current + seconds));
    player.seekTo(target);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          style={styles.play}
          onPress={togglePlay}
          disabled={!recording.filePath}
          accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}
        >
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={20}
            color={recording.filePath ? colors.text : colors.textTertiary}
            style={status.playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>

        <Pressable style={styles.info} onPress={() => setExpanded((v) => !v)}>
          <Text style={styles.title} numberOfLines={1}>
            {recording.title}
          </Text>
          <View style={styles.subRow}>
            <View style={[styles.dot, { backgroundColor: meta.color }]} />
            <Text style={styles.sub}>{meta.label}</Text>
            {recording.durationMs ? (
              <Text style={styles.sub}>· {formatDuration(recording.durationMs)}</Text>
            ) : null}
            {recording.sizeBytes ? (
              <Text style={styles.sub}>· {formatBytes(recording.sizeBytes)}</Text>
            ) : null}
          </View>
        </Pressable>

        {uploading ? (
          <View style={styles.trailing}>
            <View style={styles.ring}>
              <Text style={styles.ringText}>{Math.round(uploadProgress * 100)}</Text>
            </View>
          </View>
        ) : (
          <Pressable
            style={styles.trailing}
            onPress={() => setExpanded((v) => !v)}
            accessibilityLabel="Detalhes"
          >
            <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>

      {uploading ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(uploadProgress * 100)}%` }]} />
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.expanded}>
          <Waveform
            seed={recording.id}
            progress={progress}
            height={44}
            color={colors.surfaceElevated}
            progressColor={colors.record}
          />
          <View style={styles.controls}>
            <Pressable style={styles.control} onPress={() => skip(-15)}>
              <Ionicons name="play-back" size={22} color={colors.text} />
            </Pressable>
            <Pressable style={styles.control} onPress={togglePlay}>
              <Ionicons name={status.playing ? 'pause' : 'play'} size={26} color={colors.text} />
            </Pressable>
            <Pressable style={styles.control} onPress={() => skip(15)}>
              <Ionicons name="play-forward" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.spacer} />
            {recording.status === 'failed' || recording.status === 'completed' ? (
              <Pressable style={styles.control} onPress={onRetry} accessibilityLabel="Reenviar">
                <Ionicons name="refresh" size={20} color={colors.textSecondary} />
              </Pressable>
            ) : null}
            <Pressable style={styles.control} onPress={onDelete} accessibilityLabel="Apagar">
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          </View>
          {recording.status === 'failed' && recording.lastError ? (
            <Text style={styles.error} numberOfLines={2}>
              {recording.lastError}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, paddingHorizontal: spacing.md, gap: 3 },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  sub: { color: colors.textSecondary, fontSize: fontSize.xs },
  trailing: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringText: { color: colors.accent, fontSize: 10, fontWeight: '700' },
  progressTrack: { height: 3, backgroundColor: colors.surfaceElevated },
  progressFill: { height: 3, backgroundColor: colors.accent },
  expanded: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  control: { padding: spacing.sm },
  spacer: { flex: 1 },
  error: { color: colors.danger, fontSize: fontSize.xs },
});
