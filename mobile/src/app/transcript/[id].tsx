import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { back } from '@/services/appNavigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  View,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { AudioWaveform } from '@/components/AudioWaveform';
import { Press } from '@/components/Press';

import { DyariumApi, type FetchLike, type TranscriptSegment } from '@/core/api';
import { formatDuration } from '@/core/format';
import { audioRefFromPath } from '@/core/noteAudio';
import { breakSentences } from '@/core/richText';
import { activeSegmentIndex } from '@/core/transcript';
import { useRenderCount } from '@/dev/perf';
import { resolveAudioSource } from '@/services/attachments';
import { releaseAudioFocus } from '@/services/audioFocus';
import { getRecording, upsertRecording } from '@/services/db';
import { loadServerConfig } from '@/services/secure';
import { pushTranscript } from '@/services/transcriptSync';
import { emitRecording } from '@/services/uploaderLoop';
import { useLibrary } from '@/state/LibraryContext';
import { usePlayAt, usePlayback } from '@/state/PlaybackContext';
import { useTranscriptionProgress } from '@/state/useTranscriptionProgress';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const doFetch = globalThis.fetch as unknown as FetchLike;

interface SegmentRowProps {
  segment: TranscriptSegment;
  index: number;
  active: boolean;
  editing: boolean;
  draft: string;
  onSeek(index: number): void;
  onStartEdit(index: number): void;
  onChangeDraft(text: string): void;
  onCancelEdit(): void;
  onSubmitEdit(index: number): void;
}

/**
 * Uma linha da transcricao. Memoizada: a tela re-renderiza ao ritmo do player
 * (~4x/s) e so a linha ativa (ou a que esta sendo editada) deve re-renderizar.
 */
const SegmentRow = memo(function SegmentRow({
  segment,
  index,
  active,
  editing,
  draft,
  onSeek,
  onStartEdit,
  onChangeDraft,
  onCancelEdit,
  onSubmitEdit,
}: SegmentRowProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const text = useMemo(() => breakSentences(segment.text), [segment.text]);
  return (
    <View style={[styles.segment, active && styles.segmentActive]}>
      <Press
        style={styles.timestamp}
        onPress={() => onSeek(index)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Ouvir a partir de ${formatDuration(segment.start_ms)}`}
      >
        <Text style={[styles.timestampText, active && styles.timestampActive]}>
          {formatDuration(segment.start_ms)}
        </Text>
      </Press>
      {editing ? (
        <View style={styles.editWrap}>
          <TextInput
            value={draft}
            onChangeText={onChangeDraft}
            multiline
            autoFocus
            selectionColor={colors.accent}
            style={styles.editInput}
          />
          <View style={styles.editActions}>
            <Press onPress={onCancelEdit} accessibilityLabel="Cancelar">
              <Text style={styles.editCancel}>Cancelar</Text>
            </Press>
            <Press onPress={() => onSubmitEdit(index)} accessibilityLabel="Salvar trecho">
              <Text style={styles.editSave}>Salvar</Text>
            </Press>
          </View>
        </View>
      ) : (
        <>
          <Press style={styles.segmentBody} onPress={() => onSeek(index)}>
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{text}</Text>
          </Press>
          <Press
            onPress={() => onStartEdit(index)}
            accessibilityLabel="Editar trecho"
            hitSlop={8}
          >
            <Ionicons name="create-outline" size={16} color={colors.textTertiary} />
          </Press>
        </>
      )}
    </View>
  );
});

/**
 * Transcricao completa do audio, em segmentos com minutagem. O trecho ativo
 * acompanha o play e tocar num trecho pula o audio para ali (como no dashboard).
 */
export default function TranscriptScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
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
  const draftRef = useRef('');
  const listRef = useRef<FlatList<TranscriptSegment>>(null);
  const activeIndexRef = useRef(-1);
  /** O trecho pedido pela previa (`edit`) ja foi aberto uma vez. */
  const editOpenedRef = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

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

  // Toque longo numa linha da previa abre a transcricao ja editando aquele
  // trecho. O parametro chega em ms; casa pelo inicio do segmento, porque o
  // indice local pode mudar se a transcricao for recarregada.
  const editStartMs = edit ? Number(edit) : null;
  useEffect(() => {
    if (editOpenedRef.current) return;
    if (editStartMs === null || !Number.isFinite(editStartMs) || segments.length === 0) return;
    editOpenedRef.current = true;
    const index = segments.findIndex(
      (segment) => Math.abs(segment.start_ms - editStartMs) < 1,
    );
    if (index < 0) return;
    // Estado derivado de dados assincronos: os segmentos chegam depois do
    // parametro de rota, entao abrir a edicao aqui e a sincronizacao com o
    // carregamento da transcricao.
    // O trecho pedido pela rota abre em edicao quando os segmentos chegam.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingIndex(index);
    setDraft(segments[index].text);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 });
    });
  }, [editStartMs, segments]);

  // Mesmo player unico da nota: ao abrir a transcricao o audio continua
  // exatamente de onde estava (sem criar outro player e sem reiniciar).
  const player = usePlayback();
  const playAt = usePlayAt();
  const status = useAudioPlayerStatus(player);
  const currentMs = (status.currentTime || 0) * 1000;
  useRenderCount('Transcript');

  // Referencia do audio da nota: o mesmo arquivo (local ou anexo) que a nota
  // toca. Resolver aqui evita apontar o player para uma fonte diferente e
  // recomecar o audio do zero ao abrir esta tela.
  const audioRef = useMemo(() => {
    if (!note) return undefined;
    return (
      audioRefFromPath(note.filePath) ??
      (note.serverAttachmentId ? `attachment:${note.serverAttachmentId}` : undefined) ??
      (note.serverAudios?.[0]?.id ? `attachment:${note.serverAudios[0].id}` : undefined)
    );
  }, [note]);
  const uriRef = useRef<string | null>(null);
  const resolveUri = useCallback(async () => {
    if (uriRef.current) return uriRef.current;
    if (!note || !audioRef) return null;
    const uri = await resolveAudioSource(note.id, audioRef, note.attachments ?? {});
    if (uri) uriRef.current = uri;
    return uri;
  }, [audioRef, note]);

  // A midia da nota pode ganhar um anexo novo (upload): descarta o uri antigo.
  useEffect(() => {
    uriRef.current = null;
  }, [audioRef]);

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
      listRef.current?.scrollToIndex({ index: activeIndex, viewPosition: 0.3, animated: true });
    }
  }, [activeIndex]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    const at = status.currentTime || 0;
    void resolveUri().then((uri) => {
      if (uri) playAt(uri, at);
    });
  };

  useEffect(() => () => releaseAudioFocus(player), [player]);

  // Callbacks estaveis: as linhas memoizadas so re-renderizam quando o proprio
  // trecho muda (ativo/edicao), nao a cada atualizacao de tempo do player.
  const handleSeek = useCallback(
    (index: number) => {
      const seg = segments[index];
      if (!seg) return;
      void resolveUri().then((uri) => {
        if (uri) playAt(uri, seg.start_ms / 1000);
      });
    },
    [playAt, resolveUri, segments],
  );
  const handleStartEdit = useCallback(
    (index: number) => {
      const seg = segments[index];
      if (seg) setDraft(seg.text);
      setEditingIndex(index);
    },
    [segments],
  );
  const handleSubmitEdit = useCallback(
    (index: number) => void saveEdit(index, draftRef.current),
    [saveEdit],
  );
  const handleCancelEdit = useCallback(() => setEditingIndex(null), []);

  const renderItem = useCallback(
    ({ item, index }: { item: TranscriptSegment; index: number }) => (
      <SegmentRow
        segment={item}
        index={index}
        active={index === activeIndex}
        editing={index === editingIndex}
        draft={index === editingIndex ? draft : ''}
        onSeek={handleSeek}
        onStartEdit={handleStartEdit}
        onChangeDraft={setDraft}
        onCancelEdit={handleCancelEdit}
        onSubmitEdit={handleSubmitEdit}
      />
    ),
    [
      activeIndex,
      editingIndex,
      draft,
      handleSeek,
      handleStartEdit,
      handleCancelEdit,
      handleSubmitEdit,
    ],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Press onPress={() => back()} accessibilityLabel="Voltar" hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.title}>Transcrição</Text>
        <View style={styles.spacer} />
      </View>

      {audioRef ? (
        <View style={styles.player}>
          <View style={styles.playerRow}>
            <Press
              style={styles.play}
              onPress={toggle}
              accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}
            >
              <Ionicons name={status.playing ? 'pause' : 'play'} size={20} color={colors.text} />
            </Press>
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
          <AudioWaveform
            seed={note?.id ?? audioRef}
            current={status.currentTime || 0}
            duration={status.duration || (note?.durationMs ? note.durationMs / 1000 : 0)}
            segments={segments}
            onSeek={(seconds) => {
              void resolveUri().then((uri) => {
                if (uri) playAt(uri, seconds);
              });
            }}
          />
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
        <FlatList
          ref={listRef}
          data={segments}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.start_ms}-${index}`}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: true,
            });
          }}
        />
      )}
    </View>
  );
}

const baseStyles = defineStyles({
  screen: { flex: 1, backgroundColor: baseColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.md,
  },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  spacer: { width: 24 },
  player: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: baseColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerTime: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
  playerSpacer: { flex: 1 },
  progress: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  segment: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
  },
  segmentActive: { backgroundColor: baseColors.accentSoft },
  timestamp: { width: 44, paddingTop: 3 },
  timestampText: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  timestampActive: { color: baseColors.accentStrong },
  segmentBody: { flex: 1 },
  segmentText: { color: baseColors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
  segmentTextActive: { color: baseColors.text },
  editWrap: { flex: 1, gap: spacing.sm },
  editInput: {
    color: baseColors.text,
    fontSize: fontSize.md,
    lineHeight: 22,
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg },
  editCancel: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  editSave: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: baseColors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
});
