import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
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
import { Screen } from '@/components/Screen';
import { formatBytes, formatDuration } from '@/core/format';
import { draftToRecording, formatBrDateTime, parseBrDateTime, type ImportDraft } from '@/core/import';
import type { Recording } from '@/core/types';
import { deleteSessionFiles } from '@/services/files';
import { prepareSharedAudios } from '@/services/share';
import { useLibrary } from '@/state/LibraryContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

interface ReviewItem {
  draft: ImportDraft;
  title: string;
  dateText: string;
  durationMs?: number;
}

interface ItemCardProps {
  item: ReviewItem;
  use24h: boolean;
  onTitleChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onDuration: (ms: number) => void;
  onRemove: () => void;
}

function ItemCard({
  item,
  use24h,
  onTitleChange,
  onDateChange,
  onDuration,
  onRemove,
}: ItemCardProps) {
  const { draft } = item;
  const player = useAudioPlayer(draft.filePath ?? null);
  const status = useAudioPlayerStatus(player);
  const reportedDurationRef = useRef(0);

  // Dispara o carregamento da midia sem tocar (play seguido de pause antes de
  // carregar) para que a duracao fique disponivel na revisao.
  useEffect(() => {
    if (!draft.supported || !draft.filePath) return;
    player.play();
    player.pause();
  }, [draft.supported, draft.filePath, player]);

  // Reporta a duracao assim que o player carrega.
  useEffect(() => {
    if (status.isLoaded && status.duration > 0) {
      const ms = Math.round(status.duration * 1000);
      // So reporta quando muda: evita re-render em loop (a identidade do
      // callback muda a cada render do pai).
      if (reportedDurationRef.current !== ms) {
        reportedDurationRef.current = ms;
        onDuration(ms);
      }
    }
  }, [status.isLoaded, status.duration, onDuration]);

  const togglePlay = () => {
    if (!draft.filePath) return;
    if (status.playing) player.pause();
    else player.play();
  };

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
          onPress={togglePlay}
          disabled={!draft.supported || !draft.filePath}
          accessibilityLabel={status.playing ? 'Pausar' : 'Tocar'}
        >
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={20}
            color={draft.supported ? colors.text : colors.textTertiary}
            style={status.playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
        <View style={styles.cardHeadText}>
          <Text style={styles.original} numberOfLines={1}>
            {draft.originalName}
          </Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
        <Pressable
          style={styles.remove}
          onPress={onRemove}
          accessibilityLabel="Remover"
        >
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {draft.supported ? (
        <View style={styles.fields}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Titulo</Text>
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

export default function ImportReviewScreen() {
  const library = useLibrary();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [ignored, setIgnored] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Padrao do Brasil: 24h. O toggle troca para AM/PM.
  const [use24h, setUse24h] = useState(true);

  const itemsRef = useRef<ReviewItem[]>([]);
  const committedRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items ?? [];
  }, [items]);

  useEffect(() => {
    let alive = true;
    prepareSharedAudios()
      .then(({ drafts, ignored: extra }) => {
        if (!alive) return;
        setItems(
          drafts.map((draft) => ({
            draft,
            title: draft.title,
            dateText: formatBrDateTime(new Date(draft.recordedAt)),
          })),
        );
        setIgnored(extra);
      })
      .catch(() => {
        if (alive) setError('Nao foi possivel ler o audio compartilhado.');
      });
    return () => {
      alive = false;
      // Saiu sem enviar: descarta os arquivos copiados (nada foi persistido).
      if (!committedRef.current) {
        for (const item of itemsRef.current) {
          if (item.draft.id) deleteSessionFiles(item.draft.id);
        }
      }
    };
  }, []);

  const updateItem = useCallback((key: string, patch: Partial<ReviewItem>) => {
    setItems((prev) => prev?.map((it) => (it.draft.key === key ? { ...it, ...patch } : it)) ?? prev);
  }, []);

  const setTimeFormat = useCallback((value: boolean) => {
    setUse24h(value);
    setItems(
      (prev) =>
        prev?.map((it) => {
          const parsed = parseBrDateTime(it.dateText);
          return parsed ? { ...it, dateText: formatBrDateTime(parsed, value) } : it;
        }) ?? prev,
    );
  }, []);

  const removeItem = useCallback((key: string) => {
    const removed = itemsRef.current.find((it) => it.draft.key === key);
    if (removed?.draft.id) deleteSessionFiles(removed.draft.id);
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
        recordings.push(draftToRecording(draft, now));
      }
      committedRef.current = true;
      for (const recording of recordings) {
        await library.enqueue(recording);
      }
      router.replace('/');
    } catch {
      setError('Nao foi possivel enfileirar os audios.');
      setSending(false);
    }
  }, [library, sending]);

  const supportedCount = items?.filter((it) => it.draft.supported).length ?? 0;
  const loading = items === null;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/')} style={styles.back} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Revisar importacao</Text>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
          <Text style={styles.hint}>Lendo o audio...</Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <Text style={styles.lead}>
              Confira o que vai ser enviado. O audio original e preservado; so o titulo e a data
              podem mudar.
            </Text>

            <View style={styles.formatRow}>
              <Text style={styles.formatLabel}>Formato de hora</Text>
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
                  {ignored} audio(s) acima de 5 foram ignorados.
                </Text>
              </View>
            ) : null}

            {items && items.length > 0 ? (
              items.map((item) => (
                <ItemCard
                  key={item.draft.key}
                  item={item}
                  use24h={use24h}
                  onTitleChange={(value) => updateItem(item.draft.key, { title: value })}
                  onDateChange={(value) => updateItem(item.draft.key, { dateText: value })}
                  onDuration={(ms) => updateItem(item.draft.key, { durationMs: ms })}
                  onRemove={() => removeItem(item.draft.key)}
                />
              ))
            ) : (
              <View style={styles.center}>
                <Ionicons name="musical-notes-outline" size={30} color={colors.textTertiary} />
                <Text style={styles.emptyText}>Nenhum audio para importar.</Text>
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
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  formatLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
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
