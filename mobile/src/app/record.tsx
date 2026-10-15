import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Waveform } from '@/components/Waveform';
import { formatDuration } from '@/core/format';
import type { Recording } from '@/core/types';
import { deleteRecordingRow } from '@/services/db';
import { deleteSessionFiles, moveAudio, sessionDirUri } from '@/services/files';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording } from '@/state/RecordingContext';
import { colors, fontSize, spacing } from '@/theme/tokens';

/**
 * Tela de gravacao em tela cheia, com a waveform animada pelo microfone.
 * Ao parar: se veio da nota (`noteId`), o audio e anexado a ela; se veio da
 * home, vira uma nota nova. Em ambos os casos, volta para a nota.
 */
export default function RecordScreen() {
  const { noteId } = useLocalSearchParams<{ noteId?: string }>();
  const { attachAudio, enqueue, refresh } = useLibrary();
  const { active, elapsedMs, level, error, busy, start, stop } = useRecording();
  const [finishing, setFinishing] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start]);

  const finish = useCallback(async () => {
    const finished = await stop({ enqueue: false });
    if (!finished) {
      router.back();
      return;
    }
    if (noteId) {
      const movedPath = await moveAudio(finished.id, noteId);
      const attached: Recording = {
        ...finished,
        dir: sessionDirUri(noteId),
        filePath: movedPath ?? finished.filePath,
      };
      await attachAudio(noteId, attached);
      await deleteRecordingRow(finished.id);
      await refresh();
      router.replace({ pathname: '/note/[id]', params: { id: noteId } });
      return;
    }
    await enqueue(finished);
    router.replace({ pathname: '/note/[id]', params: { id: finished.id } });
  }, [stop, noteId, attachAudio, enqueue, refresh]);

  const handleStop = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      await finish();
    } finally {
      setFinishing(false);
    }
  }, [finishing, finish]);

  const handleDiscard = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const finished = await stop({ enqueue: false });
      if (finished) {
        deleteSessionFiles(finished.id);
        await deleteRecordingRow(finished.id);
        await refresh();
      }
    } finally {
      setFinishing(false);
      router.back();
    }
  }, [finishing, stop, refresh]);

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => void handleDiscard()} accessibilityLabel="Cancelar" hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.label}>{noteId ? 'Gravando na nota' : 'Nova gravacao'}</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.center}>
        <Text style={styles.timer}>{formatDuration(elapsedMs)}</Text>
        <Waveform active={Boolean(active)} level={level} height={120} color={colors.accent} />
        <Text style={styles.hint}>
          {active ? 'Gravando com a tela bloqueada' : busy ? 'Preparando...' : '...'}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.bottom}>
        <Pressable
          style={[styles.stop, finishing && styles.stopDisabled]}
          onPress={() => void handleStop()}
          disabled={finishing || !active}
          accessibilityLabel="Parar gravacao"
        >
          <Ionicons name="stop" size={30} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.bottomHint}>Toque para parar</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.lg,
  },
  label: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  spacer: { width: 26 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  timer: {
    color: colors.text,
    fontSize: fontSize.display,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  bottom: { alignItems: 'center', gap: spacing.md, paddingBottom: spacing.xxxl },
  stop: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopDisabled: { opacity: 0.5 },
  bottomHint: { color: colors.textTertiary, fontSize: fontSize.xs },
});
