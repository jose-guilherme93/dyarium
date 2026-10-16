import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/core/format';
import { needsNoteSync, type Recording } from '@/core/types';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

import { STATUS_META } from './StatusChip';
import { Waveform } from './Waveform';

interface RecordingCardProps {
  recording: Recording;
  onRetry: () => void;
  onDelete: () => void;
  /** Abre a tela da nota. Quando ausente, o card expande em linha (so audio). */
  onOpen?: () => void;
  /** Arquivar (opcional; aparece no menu de tres pontinhos). */
  onArchive?: () => void;
}

function StatusIndicator({
  recording,
  onRetry,
}: {
  recording: Recording;
  onRetry: () => void;
}) {
  if (recording.status === 'completed') {
    // Nota enviada mas com edicao local na fila: ainda falta subir o corpo.
    if (needsNoteSync(recording)) {
      return <Ionicons name="cloud-upload-outline" size={20} color={colors.accent} />;
    }
    return null;
  }
  if (recording.status === 'uploading') {
    const progress =
      recording.sizeBytes && recording.sizeBytes > 0
        ? Math.min(1, recording.offset / recording.sizeBytes)
        : 0;
    return (
      <View style={styles.ring}>
        <Text style={styles.ringText}>{Math.round(progress * 100)}</Text>
      </View>
    );
  }
  if (recording.status === 'failed') {
    return (
      <Pressable onPress={onRetry} accessibilityLabel="Reenviar" hitSlop={8}>
        <Ionicons name="refresh" size={20} color={colors.warning} />
      </Pressable>
    );
  }
  if (recording.status === 'queued' || recording.status === 'recorded') {
    return <Ionicons name="cloud-upload-outline" size={20} color={colors.accent} />;
  }
  return null;
}

export function RecordingCard({
  recording,
  onRetry,
  onDelete,
  onOpen,
  onArchive,
}: RecordingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasAudio = Boolean(recording.filePath);
  const meta = STATUS_META[recording.status];

  // O player e criado sob demanda (so quando o usuario toca), para nao criar um
  // AudioPlayer por item da lista (isso quebra o expo-audio no Android).
  const playerRef = useRef<AudioPlayer | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);
  const [playState, setPlayState] = useState({ playing: false, currentTime: 0, duration: 0 });

  useEffect(
    () => () => {
      subRef.current?.remove();
      playerRef.current?.remove();
      playerRef.current = null;
    },
    [],
  );

  const ensurePlayer = (): AudioPlayer | null => {
    if (playerRef.current || !recording.filePath) return playerRef.current;
    const player = createAudioPlayer(recording.filePath);
    subRef.current = player.addListener('playbackStatusUpdate', (status) => {
      setPlayState({
        playing: status.playing,
        currentTime: status.currentTime,
        duration: status.duration,
      });
    });
    playerRef.current = player;
    return player;
  };

  const duration = playState.duration || (recording.durationMs ?? 0) / 1000;
  const current = playState.currentTime;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  const togglePlay = () => {
    const player = ensurePlayer();
    if (!player) return;
    if (playState.playing) {
      player.pause();
    } else {
      if (duration > 0 && current >= duration - 0.1) player.seekTo(0);
      player.play();
    }
  };

  const skip = (seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    const target = Math.max(0, Math.min(duration, current + seconds));
    player.seekTo(target);
  };

  const openMenu = () => {
    const buttons: Parameters<typeof Alert.alert>[2] = [];
    if (onArchive) {
      buttons.push({
        text: recording.archived ? 'Desarquivar' : 'Arquivar',
        onPress: onArchive,
      });
    }
    buttons.push({ text: 'Apagar', style: 'destructive', onPress: onDelete });
    buttons.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert(recording.title, undefined, buttons);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {hasAudio ? (
          <Pressable
            style={styles.leading}
            onPress={togglePlay}
            accessibilityLabel={playState.playing ? 'Pausar' : 'Tocar'}
          >
            <Ionicons
              name={playState.playing ? 'pause' : 'play'}
              size={20}
              color={colors.text}
              style={playState.playing ? undefined : { marginLeft: 2 }}
            />
          </Pressable>
        ) : (
          <View style={styles.leading}>
            <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
          </View>
        )}

        <Pressable
          style={styles.info}
          onPress={onOpen ?? (hasAudio ? () => setExpanded((v) => !v) : undefined)}
        >
          <Text style={styles.title} numberOfLines={1}>
            {recording.title}
          </Text>
          <View style={styles.subRow}>
            {recording.source === 'share' ? (
              <Ionicons name="download-outline" size={12} color={colors.info} />
            ) : null}
            {recording.status !== 'completed' ? (
              <>
                <View style={[styles.dot, { backgroundColor: meta.color }]} />
                <Text style={styles.sub}>{meta.label}</Text>
              </>
            ) : needsNoteSync(recording) ? (
              <>
                <View style={[styles.dot, { backgroundColor: colors.accent }]} />
                <Text style={styles.sub}>Alteracoes pendentes</Text>
              </>
            ) : null}
            {recording.durationMs ? (
              <Text style={styles.sub}>· {formatDuration(recording.durationMs)}</Text>
            ) : null}
            {recording.archived ? <Text style={styles.sub}>· arquivada</Text> : null}
          </View>
          {!hasAudio && recording.text ? (
            <Text style={styles.preview} numberOfLines={1}>
              {recording.text}
            </Text>
          ) : recording.transcriptStatus === 'ready' && recording.transcript ? (
            <Text style={styles.preview} numberOfLines={1}>
              {recording.transcript}
            </Text>
          ) : null}
        </Pressable>

        <View style={styles.trailing}>
          <StatusIndicator recording={recording} onRetry={onRetry} />
          <Pressable style={styles.more} onPress={openMenu} accessibilityLabel="Mais opcoes">
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {recording.status === 'uploading' && recording.sizeBytes ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(
                  Math.min(1, recording.offset / recording.sizeBytes) * 100,
                )}%`,
              },
            ]}
          />
        </View>
      ) : null}

      {expanded && hasAudio ? (
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
              <Ionicons name={playState.playing ? 'pause' : 'play'} size={26} color={colors.text} />
            </Pressable>
            <Pressable style={styles.control} onPress={() => skip(15)}>
              <Ionicons name="play-forward" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.spacer} />
            {recording.transcriptStatus === 'pending' ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : null}
          </View>
          {recording.transcriptStatus === 'ready' && recording.transcript ? (
            <View style={styles.transcriptBox}>
              <Text style={styles.transcriptLabel}>Transcricao</Text>
              <Text style={styles.transcriptText}>{recording.transcript}</Text>
            </View>
          ) : null}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  leading: {
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
  preview: { color: colors.textTertiary, fontSize: fontSize.sm, marginTop: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  more: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
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
  transcriptBox: { gap: 6 },
  transcriptLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  transcriptText: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
});
