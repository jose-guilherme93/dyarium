import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DyariumApi, type FetchLike, type TranscriptSegment } from '@/core/api';
import { formatDuration } from '@/core/format';
import { getRecording, upsertRecording } from '@/services/db';
import { loadServerConfig } from '@/services/secure';
import { useLibrary } from '@/state/LibraryContext';
import { colors, fontSize, spacing } from '@/theme/tokens';

const doFetch = globalThis.fetch as unknown as FetchLike;

/**
 * Transcricao completa do audio, em segmentos com minutagem. O trecho ativo
 * acompanha o play e tocar num trecho pula o audio para ali (como no dashboard).
 */
export default function TranscriptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { recordings } = useLibrary();
  const note = recordings.find((r) => r.id === id);
  const noteId = note?.id;
  const entryId = note?.entryId;
  const cachedSegments = note?.transcriptSegments;
  const hasCache = Boolean(cachedSegments && cachedSegments.length > 0);

  const [fetched, setFetched] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const activeIndexRef = useRef(-1);

  const segments = hasCache && cachedSegments ? cachedSegments : fetched;

  const player = useAudioPlayer(note?.filePath ? { uri: note.filePath } : undefined);
  const status = useAudioPlayerStatus(player);
  const currentMs = (status.currentTime || 0) * 1000;

  useEffect(() => {
    // Segmentos em cache local: nao refaz o fetch ao abrir.
    if (!entryId || hasCache) return undefined;
    let alive = true;
    (async () => {
      const config = await loadServerConfig();
      if (!config) return;
      try {
        const api = new DyariumApi(config, doFetch);
        const transcript = await api.getTranscript(entryId);
        if (!alive) return;
        setFetched(transcript.segments ?? []);
        // Persiste o cache local para as proximas aberturas.
        if (transcript.segments && transcript.segments.length > 0 && noteId) {
          const current = await getRecording(noteId);
          if (current) {
            await upsertRecording({
              ...current,
              transcriptSegments: transcript.segments,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch {
        if (alive) setError('Nao foi possivel carregar a transcricao agora.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [entryId, hasCache, noteId]);

  const activeIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i].start_ms <= currentMs) index = i;
      else break;
    }
    return index;
  }, [segments, currentMs]);

  useEffect(() => {
    if (activeIndex === activeIndexRef.current) return;
    activeIndexRef.current = activeIndex;
    if (activeIndex >= 0) {
      scrollRef.current?.scrollTo({ y: Math.max(0, activeIndex * 44 - 120), animated: true });
    }
  }, [activeIndex]);

  const toggle = () => {
    if (status.playing) player.pause();
    else player.play();
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Voltar" hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Transcricao</Text>
        <View style={styles.spacer} />
      </View>

      {note?.filePath ? (
        <View style={styles.player}>
          <Pressable style={styles.play} onPress={toggle} accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}>
            <Ionicons name={status.playing ? 'pause' : 'play'} size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.playerTime}>
            {formatDuration(currentMs)} / {formatDuration((status.duration || 0) * 1000)}
          </Text>
        </View>
      ) : null}

      {segments.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {error ?? (note?.transcriptStatus === 'ready' ? 'Sem segmentos.' : 'Transcrevendo...')}
          </Text>
        </View>
      ) : (
        <ScrollView ref={scrollRef} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {segments.map((segment, index) => (
            <Pressable
              key={`${segment.start_ms}-${index}`}
              onPress={() => player.seekTo(segment.start_ms / 1000)}
              style={[styles.segment, index === activeIndex && styles.segmentActive]}
            >
              <Text style={styles.timestamp}>{formatDuration(segment.start_ms)}</Text>
              <Text style={[styles.segmentText, index === activeIndex && styles.segmentTextActive]}>
                {segment.text}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  spacer: { width: 24 },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerTime: { color: colors.textSecondary, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  segment: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
  },
  segmentActive: { backgroundColor: colors.accentSoft },
  timestamp: { color: colors.textTertiary, fontSize: fontSize.xs, width: 44, paddingTop: 3, fontVariant: ['tabular-nums'] },
  segmentText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
  segmentTextActive: { color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
});
