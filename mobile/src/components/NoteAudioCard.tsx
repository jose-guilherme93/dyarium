/**
 * Card de audio do corpo da nota.
 *
 * O audio e nativo: o player fica entre os trechos, com duracao, transcricao
 * e o botao de remover.
 */

import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AudioSeekBar } from '@/components/AudioSeekBar';
import { formatDuration } from '@/core/format';
import type { NoteAudioNode } from '@/core/noteDocument';
import { releaseAudioFocus } from '@/services/audioFocus';
import { playPlayer } from '@/services/playback';
import { colors, radius, spacing } from '@/theme/tokens';

export interface NoteAudioCardProps {
  node: NoteAudioNode;
  /** Resolve a URI do audio a partir da referencia salva. */
  resolve?: (ref: string) => Promise<string | null> | string | null;
  /** Transcricao do audio, quando houver. */
  transcript?: string;
  /** Remove o audio do corpo da nota. */
  onRemove: () => void;
}

/** Audio do documento: player entre os trechos de texto. */
export function NoteAudioCard({ node, resolve, transcript, onRemove }: NoteAudioCardProps) {
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (uri) {
      setOpen(true);
      return;
    }
    if (!resolve) {
      setFailed(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const resolved = await resolve(node.ref);
      if (!resolved) {
        setFailed(true);
        return;
      }
      setUri(resolved);
      setOpen(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [node.ref, open, resolve, uri]);

  return (
    <View style={styles.audioCard}>
      <View style={styles.audioRow}>
        <Pressable
          style={styles.audioPlay}
          onPress={() => void toggle()}
          accessibilityLabel={open ? 'Pausar áudio' : 'Tocar áudio'}
          disabled={busy}
        >
          <Ionicons
            name={open ? 'pause' : 'play'}
            size={18}
            color={colors.text}
            style={open ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
        <View style={styles.audioInfo}>
          <Text style={styles.audioTitle}>Áudio</Text>
          <Text style={styles.audioDuration}>
            {node.durationMs > 0 ? formatDuration(node.durationMs) : 'Duração desconhecida'}
          </Text>
        </View>
        <Ionicons name="mic-outline" size={17} color={colors.textTertiary} />
        <Pressable
          onPress={onRemove}
          accessibilityLabel="Remover áudio"
          hitSlop={8}
        >
          <Ionicons name="trash-outline" size={17} color={colors.textTertiary} />
        </Pressable>
      </View>

      {open && uri ? <ActiveAudio uri={uri} durationMs={node.durationMs} /> : null}
      {busy ? <Text style={styles.audioHint}>Carregando áudio...</Text> : null}
      {failed ? <Text style={styles.audioHint}>Áudio indisponível neste aparelho.</Text> : null}
      {transcript ? (
        <Text style={styles.audioTranscript} numberOfLines={3}>
          {transcript}
        </Text>
      ) : null}
    </View>
  );
}

/** Player nativo do audio ativo. Monta so quando o usuario toca em tocar. */
function ActiveAudio({ uri, durationMs }: { uri: string; durationMs: number }) {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const appliedSeek = useRef<number | null>(null);
  const duration = status.duration > 0 ? status.duration : Math.max(0, durationMs) / 1000;
  const current = status.currentTime || 0;

  useEffect(() => {
    playPlayer(player);
    return () => releaseAudioFocus(player);
  }, [player]);

  useEffect(() => {
    if (pendingSeek === null || status.duration <= 0 || appliedSeek.current === pendingSeek) {
      return;
    }
    appliedSeek.current = pendingSeek;
    void player.seekTo(pendingSeek).catch(() => undefined);
  }, [pendingSeek, player, status.duration]);

  const seek = (seconds: number) => {
    if (status.duration > 0) {
      void player.seekTo(seconds).catch(() => undefined);
    } else {
      setPendingSeek(seconds);
    }
  };

  return (
    <View style={styles.audioPlayer}>
      <View style={styles.audioPlayerRow}>
        <Pressable
          onPress={() => (status.playing ? player.pause() : playPlayer(player))}
          accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}
          hitSlop={8}
        >
          <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.audioTime}>
          {formatDuration(current * 1000)} / {formatDuration(duration * 1000)}
        </Text>
      </View>
      <AudioSeekBar current={current} duration={duration} onSeek={seek} />
    </View>
  );
}

const styles = StyleSheet.create({
  audioCard: {
    // O card reserva o espaco da previa da transcricao (ate tres linhas) mesmo
    // antes de ela chegar. Sem isso, o texto de baixo pulava quando o audio
    // terminava de carregar.
    minHeight: 128,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  audioPlay: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioInfo: { flex: 1, gap: 2 },
  audioTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  audioDuration: { color: colors.textSecondary, fontSize: 12 },
  audioHint: { color: colors.textSecondary, fontSize: 12 },
  audioTranscript: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  audioPlayer: { gap: spacing.xs },
  audioPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  audioTime: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
});
