import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { DyariumApi, type FetchLike, type TranscriptSegment } from '@/core/api';
import { formatDuration } from '@/core/format';
import { breakSentences } from '@/core/richText';
import { activeSegmentIndex } from '@/core/transcript';
import { releaseAudioFocus } from '@/services/audioFocus';
import { getRecording, upsertRecording } from '@/services/db';
import { playPlayer } from '@/services/playback';
import { loadServerConfig } from '@/services/secure';
import { pushTranscript } from '@/services/transcriptSync';
import { emitRecording } from '@/services/uploaderLoop';
import { useLibrary } from '@/state/LibraryContext';
import { usePlaybackSource } from '@/state/PlaybackContext';
import { useTranscriptionProgress } from '@/state/useTranscriptionProgress';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const activeIndexRef = useRef(-1);

  // Editar um trecho (palavra/frase): grava local e envia ao servidor.
  const saveEdit = useCallback(
    async (index: number, value: string) => {
      if (!noteId) return;
      const current = await getRecording(noteId);
      if (!current) return;
      const list = [...(current.transcriptSegments ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], text: value.trim() };
      const updated = {
        ...current,
        transcriptSegments: list,
        transcript: list
          .map((segment) => segment.text)
          .join(' ')
          .trim(),
        updatedAt: new Date().toISOString(),
      };
      await upsertRecording(updated);
      emitRecording(updated);
      setEditingIndex(null);
      void pushTranscript(noteId);
    },
    [noteId],
  );

  const segments = hasCache && cachedSegments ? cachedSegments : fetched;
  const transcriptionPercent = useTranscriptionProgress(noteId);
  const transcribing = note?.transcriptStatus === 'pending';

  // Mesmo player unico da nota: ao abrir a transcricao o audio continua
  // exatamente de onde estava (sem criar outro player e sem reiniciar).
  const player = usePlaybackSource(note?.filePath);
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
        if (alive) setError('Não foi possível carregar a transcrição agora.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [entryId, hasCache, noteId]);

  const activeIndex = useMemo(
    () => activeSegmentIndex(segments, currentMs),
    [segments, currentMs],
  );

  useEffect(() => {
    if (activeIndex === activeIndexRef.current) return;
    activeIndexRef.current = activeIndex;
    if (activeIndex >= 0) {
      scrollRef.current?.scrollTo({ y: Math.max(0, activeIndex * 44 - 120), animated: true });
    }
  }, [activeIndex]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    playPlayer(player);
  };

  useEffect(() => () => releaseAudioFocus(player), [player]);

  // So remonta as linhas quando muda o trecho ativo, a edicao ou a lista — nao a
  // cada atualizacao de tempo (~4x/s durante o play). Evita refazer
  // `breakSentences` e recriar centenas de nos por segundo.
  const rows = useMemo(
    () =>
      segments.map((segment, index) => {
        const editing = editingIndex === index;
        return (
          <View
            key={`${segment.start_ms}-${index}`}
            style={[styles.segment, index === activeIndex && styles.segmentActive]}
          >
            <Text style={styles.timestamp}>{formatDuration(segment.start_ms)}</Text>
            {editing ? (
              <View style={styles.editWrap}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  autoFocus
                  selectionColor={colors.accent}
                  style={styles.editInput}
                />
                <View style={styles.editActions}>
                  <Pressable onPress={() => setEditingIndex(null)} accessibilityLabel="Cancelar">
                    <Text style={styles.editCancel}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void saveEdit(index, draft)}
                    accessibilityLabel="Salvar trecho"
                  >
                    <Text style={styles.editSave}>Salvar</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <Pressable
                  style={styles.segmentBody}
                  onPress={() => player.seekTo(segment.start_ms / 1000)}
                >
                  <Text
                    style={[styles.segmentText, index === activeIndex && styles.segmentTextActive]}
                  >
                    {breakSentences(segment.text)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDraft(segment.text);
                    setEditingIndex(index);
                  }}
                  accessibilityLabel="Editar trecho"
                  hitSlop={8}
                >
                  <Ionicons name="create-outline" size={16} color={colors.textTertiary} />
                </Pressable>
              </>
            )}
          </View>
        );
      }),
    [segments, editingIndex, activeIndex, draft, saveEdit, player],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Voltar" hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Transcrição</Text>
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
          <View style={styles.playerSpacer} />
          {transcribing ? (
            <Text style={styles.progress}>
              Transcrevendo{transcriptionPercent > 0 ? ` ${Math.round(transcriptionPercent)}%` : '...'}
            </Text>
          ) : null}
        </View>
      ) : null}

      {segments.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {error ??
              (note?.transcriptStatus === 'ready'
                ? 'Sem segmentos.'
                : `Transcrevendo${transcriptionPercent > 0 ? ` ${Math.round(transcriptionPercent)}%` : '...'}`)}
          </Text>
        </View>
      ) : (
        <ScrollView ref={scrollRef} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {rows}
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
  playerSpacer: { flex: 1 },
  progress: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
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
  segmentBody: { flex: 1 },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
  segmentTextActive: { color: colors.text },
  editWrap: { flex: 1, gap: spacing.sm },
  editInput: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 22,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg },
  editCancel: { color: colors.textSecondary, fontSize: fontSize.sm },
  editSave: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
});
