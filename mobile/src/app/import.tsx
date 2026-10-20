import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { NotebookPicker } from '@/components/NotebookPicker';
import { Screen } from '@/components/Screen';
import { formatBytes, formatDuration } from '@/core/format';
import {
  draftToRecording,
  formatBrDateTime,
  parseBrDateTime,
  resolveRecordedAt,
  type ImportDraft,
} from '@/core/import';
import { DEFAULT_NOTEBOOK_ID } from '@/core/notebooks';
import type { Recording } from '@/core/types';
import { deleteSessionFiles } from '@/services/files';
import { prepareSharedAudios } from '@/services/share';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

interface ReviewItem {
  draft: ImportDraft;
  title: string;
  dateText: string;
  durationMs?: number;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 25 }, (_, index) => CURRENT_YEAR - index);

interface ItemCardProps {
  item: ReviewItem;
  use24h: boolean;
  isPlaying: boolean;
  onTitleChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onTogglePlay: () => void;
  onRemove: () => void;
}

function ItemCard({
  item,
  use24h,
  isPlaying,
  onTitleChange,
  onDateChange,
  onTogglePlay,
  onRemove,
}: ItemCardProps) {
  const { draft } = item;

  const durationLabel = item.durationMs ? formatDuration(item.durationMs) : '--:--';
  const meta = [
    durationLabel,
    draft.extension ? draft.extension.toUpperCase() : undefined,
    draft.sizeBytes ? formatBytes(draft.sizeBytes) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const dateLabel = use24h ? 'DD/MM/AAAA HH:mm' : 'DD/MM/AAAA hh:mm AM';

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Pressable
          style={[styles.play, !draft.supported && styles.playDisabled]}
          onPress={onTogglePlay}
          disabled={!draft.supported || !draft.filePath}
          accessibilityLabel={isPlaying ? 'Pausar' : 'Tocar'}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={20}
            color={draft.supported ? colors.text : colors.textTertiary}
            style={isPlaying ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
        <View style={styles.cardHeadText}>
          <Text style={styles.original} numberOfLines={1}>
            {draft.originalName}
          </Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
        <Pressable style={styles.remove} onPress={onRemove} accessibilityLabel="Remover">
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {draft.supported ? (
        <View style={styles.fields}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Título</Text>
            <TextInput
              value={item.title}
              onChangeText={onTitleChange}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Data ({dateLabel})</Text>
            <TextInput
              value={item.dateText}
              onChangeText={onDateChange}
              placeholder={dateLabel}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />
          </View>
        </View>
      ) : (
        <View style={styles.reject}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={styles.rejectText}>{draft.reason ?? 'Formato nao suportado.'}</Text>
        </View>
      )}
    </View>
  );
}

function probeDuration(player: AudioPlayer, uri: string): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    let sub: { remove: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      if (sub) sub.remove();
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.isLoaded && status.duration > 0) finish(Math.round(status.duration * 1000));
    });
    timer = setTimeout(() => finish(null), 4000);
    player.replace(uri);
  });
}

export default function ImportReviewScreen() {
  const library = useLibrary();
  const { importYear, setImportYear, lastNotebookId } = useSettings();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [notebookId, setNotebookId] = useState(lastNotebookId ?? DEFAULT_NOTEBOOK_ID);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const targetNotebookId = library.notebooks.some((notebook) => notebook.id === notebookId)
    ? notebookId
    : (library.notebooks.find((notebook) => notebook.isDefault)?.id ?? DEFAULT_NOTEBOOK_ID);
  const [ignored, setIgnored] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [use24h, setUse24h] = useState(true);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [invert, setInvert] = useState(false);

  const itemsRef = useRef<ReviewItem[]>([]);
  const committedRef = useRef(false);
  const importYearRef = useRef(importYear);
  useEffect(() => {
    importYearRef.current = importYear;
  }, [importYear]);

  useEffect(() => {
    itemsRef.current = items ?? [];
  }, [items]);

  const computeDateText = useCallback(
    (draft: ImportDraft, selectedYear: number, inverted: boolean, h24: boolean) =>
      formatBrDateTime(
        resolveRecordedAt(draft.date ?? null, {
          year: selectedYear,
          invert: inverted,
          fallback: new Date(draft.fallbackMs ?? Date.now()),
        }),
        h24,
      ),
    [],
  );

  // Um unico player para toda a revisao: sonda as duracoes em sequencia e toca
  // sob demanda. Criar um AudioPlayer por item quebra o expo-audio no Android.
  const playerRef = useRef<AudioPlayer | null>(null);
  const playerSubRef = useRef<{ remove: () => void } | null>(null);
  const cancelledRef = useRef(false);
  const loadedRef = useRef(false);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const ensurePlayer = useCallback((): AudioPlayer => {
    if (playerRef.current) return playerRef.current;
    const player = createAudioPlayer();
    playerSubRef.current = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) setPlayingKey(null);
    });
    playerRef.current = player;
    return player;
  }, []);

  const probeDurations = useCallback(
    async (drafts: ImportDraft[]) => {
      const player = ensurePlayer();
      for (const draft of drafts) {
        if (cancelledRef.current) break;
        if (!draft.supported || !draft.filePath) continue;
        const ms = await probeDuration(player, draft.filePath);
        if (!cancelledRef.current && ms) {
          setItems(
            (prev) =>
              prev?.map((it) => (it.draft.key === draft.key ? { ...it, durationMs: ms } : it)) ??
              prev,
          );
        }
      }
    },
    [ensurePlayer],
  );

  const togglePlay = useCallback(
    (item: ReviewItem) => {
      const uri = item.draft.filePath;
      if (!uri) return;
      const player = ensurePlayer();
      if (playingKey === item.draft.key) {
        player.pause();
        setPlayingKey(null);
        return;
      }
      player.replace(uri);
      player.play();
      setPlayingKey(item.draft.key);
    },
    [ensurePlayer, playingKey],
  );

  useEffect(
    () => () => {
      cancelledRef.current = true;
      playerSubRef.current?.remove();
      playerRef.current?.remove();
      playerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (loadedRef.current) return undefined;
    loadedRef.current = true;
    let alive = true;
    prepareSharedAudios()
      .then(({ drafts, ignored: extra }) => {
        if (!alive) return;
        const named = drafts.find((draft) => draft.date?.year);
        const initialYear = named?.date?.year ?? importYearRef.current ?? CURRENT_YEAR;
        setYear(initialYear);
        setItems(
          drafts.map((draft) => ({
            draft,
            title: draft.title,
            dateText: computeDateText(draft, initialYear, false, true),
          })),
        );
        setIgnored(extra);
        void probeDurations(drafts);
      })
      .catch(() => {
        if (alive) setError('Não foi possível ler o áudio compartilhado.');
      });
    return () => {
      alive = false;
    };
  }, [computeDateText, probeDurations]);

  // Ao desmontar sem enviar, descarta os arquivos copiados (nada foi persistido).
  useEffect(
    () => () => {
      if (!committedRef.current) {
        for (const item of itemsRef.current) {
          if (item.draft.id) deleteSessionFiles(item.draft.id);
        }
      }
    },
    [],
  );

  const updateItem = useCallback((key: string, patch: Partial<ReviewItem>) => {
    setItems((prev) => prev?.map((it) => (it.draft.key === key ? { ...it, ...patch } : it)) ?? prev);
  }, []);

  const applyBatch = useCallback(
    (selectedYear: number, inverted: boolean, h24: boolean) => {
      setItems(
        (prev) =>
          prev?.map((it) => ({
            ...it,
            dateText: computeDateText(it.draft, selectedYear, inverted, h24),
          })) ?? prev,
      );
    },
    [computeDateText],
  );

  const chooseYear = useCallback(
    (value: number) => {
      setYear(value);
      void setImportYear(value);
      applyBatch(value, invert, use24h);
    },
    [applyBatch, invert, setImportYear, use24h],
  );

  const chooseInvert = useCallback(
    (value: boolean) => {
      setInvert(value);
      applyBatch(year, value, use24h);
    },
    [applyBatch, use24h, year],
  );

  const setTimeFormat = useCallback(
    (value: boolean) => {
      setUse24h(value);
      applyBatch(year, invert, value);
    },
    [applyBatch, invert, year],
  );

  const removeItem = useCallback((key: string) => {
    const removed = itemsRef.current.find((it) => it.draft.key === key);
    if (removed?.draft.id) deleteSessionFiles(removed.draft.id);
    playerRef.current?.pause();
    setPlayingKey((current) => (current === key ? null : current));
    setItems((prev) => prev?.filter((it) => it.draft.key !== key) ?? prev);
  }, []);

  const sendAll = useCallback(async () => {
    if (sending) return;
    const list = itemsRef.current.filter((it) => it.draft.supported);
    if (list.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const now = new Date();
      const recordings: Recording[] = [];
      for (const item of list) {
        const parsed = parseBrDateTime(item.dateText);
        if (!parsed) {
          setError(`Data invalida em "${item.title}". Use DD/MM/AAAA HH:mm.`);
          setSending(false);
          return;
        }
        const draft: ImportDraft = {
          ...item.draft,
          title: item.title.trim() || item.draft.title,
          recordedAt: parsed.toISOString(),
          durationMs: item.durationMs ?? item.draft.durationMs,
        };
        recordings.push({ ...draftToRecording(draft, now), notebookId: targetNotebookId });
      }
      committedRef.current = true;
      for (const recording of recordings) {
        await library.enqueue(recording);
      }
      router.replace('/');
    } catch {
      setError('Não foi possível enfileirar os áudios.');
      setSending(false);
    }
  }, [library, sending, targetNotebookId]);

  const supportedCount = items?.filter((it) => it.draft.supported).length ?? 0;
  const loading = items === null;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/')} style={styles.back} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Revisar importação</Text>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
          <Text style={styles.hint}>Lendo o áudio...</Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <Text style={styles.lead}>
              Confira o que vai ser enviado. O áudio original é preservado; só o título e a data
              podem mudar.
            </Text>

            <View style={styles.controlRow}>
              <Text style={styles.controlLabel}>Caderno</Text>
              <Pressable
                style={styles.segment}
                onPress={() => setNotebookPickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Escolher caderno"
              >
                <Text style={styles.segmentText} numberOfLines={1}>
                  {library.notebooks.find((item) => item.id === targetNotebookId)?.name ??
                    'Notas ao acaso'}
                </Text>
                <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.control}>
              <Text style={styles.controlLabel}>Ano das gravações</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.yearRow}
              >
                {YEARS.map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => chooseYear(value)}
                    style={[styles.yearChip, year === value && styles.yearChipActive]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.yearText, year === value && styles.yearTextActive]}>
                      {value}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View style={styles.controlRow}>
              <Text style={styles.controlLabel}>Ordem dia/mês</Text>
              <View style={styles.segment}>
                <Pressable
                  onPress={() => chooseInvert(false)}
                  style={[styles.segmentItem, !invert && styles.segmentItemActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.segmentText, !invert && styles.segmentTextActive]}>
                    Dia/Mês
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => chooseInvert(true)}
                  style={[styles.segmentItem, invert && styles.segmentItemActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.segmentText, invert && styles.segmentTextActive]}>
                    Mês/Dia
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.controlRow}>
              <Text style={styles.controlLabel}>Formato de hora</Text>
              <View style={styles.segment}>
                <Pressable
                  onPress={() => setTimeFormat(true)}
                  style={[styles.segmentItem, use24h && styles.segmentItemActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.segmentText, use24h && styles.segmentTextActive]}>24h</Text>
                </Pressable>
                <Pressable
                  onPress={() => setTimeFormat(false)}
                  style={[styles.segmentItem, !use24h && styles.segmentItemActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.segmentText, !use24h && styles.segmentTextActive]}>
                    AM/PM
                  </Text>
                </Pressable>
              </View>
            </View>

            {ignored > 0 ? (
              <View style={styles.alert}>
                <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
                <Text style={styles.alertText}>
                  {ignored} áudio(s) acima de 50 foram ignorados.
                </Text>
              </View>
            ) : null}

            {items && items.length > 0 ? (
              items.map((item) => (
                <ItemCard
                  key={item.draft.key}
                  item={item}
                  use24h={use24h}
                  isPlaying={playingKey === item.draft.key}
                  onTitleChange={(value) => updateItem(item.draft.key, { title: value })}
                  onDateChange={(value) => updateItem(item.draft.key, { dateText: value })}
                  onTogglePlay={() => togglePlay(item)}
                  onRemove={() => removeItem(item.draft.key)}
                />
              ))
            ) : (
              <View style={styles.center}>
                <Ionicons name="musical-notes-outline" size={30} color={colors.textTertiary} />
                <Text style={styles.emptyText}>Nenhum áudio para importar.</Text>
              </View>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <Button
              label={supportedCount > 1 ? `Enviar tudo (${supportedCount})` : 'Enviar'}
              onPress={() => void sendAll()}
              disabled={supportedCount === 0}
              loading={sending}
            />
          </View>
        </>
      )}

      <NotebookPicker
        visible={notebookPickerOpen}
        notebooks={library.notebooks}
        currentId={targetNotebookId}
        onClose={() => setNotebookPickerOpen(false)}
        onSelect={(id) => {
          setNotebookId(id);
          setNotebookPickerOpen(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm },
  list: { padding: spacing.xl, gap: spacing.lg },
  lead: { color: colors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
  control: { gap: spacing.sm },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  controlLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  yearRow: { gap: spacing.sm, paddingRight: spacing.sm },
  yearChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  yearChipActive: { backgroundColor: colors.accent },
  yearText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  yearTextActive: { color: '#FFFFFF' },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  segmentItemActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  segmentTextActive: { color: '#FFFFFF' },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  alertText: { flex: 1, color: colors.warning, fontSize: fontSize.sm, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisabled: { opacity: 0.5 },
  cardHeadText: { flex: 1, gap: 3 },
  original: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: fontSize.xs },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  fields: { gap: spacing.md },
  field: { gap: spacing.sm },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.lg,
    height: 48,
  },
  reject: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rejectText: { flex: 1, color: colors.warning, fontSize: fontSize.sm },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  footer: {
    padding: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
