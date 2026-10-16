import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { memo, useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { groupRecordingsByYear, type RecordingSection } from '@/core/group';
import { isBlankDraft } from '@/core/note';
import { needsNoteSync, type Recording } from '@/core/types';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

const PENDING_STATUSES = ['recorded', 'queued', 'uploading', 'failed'];

interface SwipeRowProps {
  children: React.ReactNode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onAction: () => void;
}

function SwipeRow({ children, label, icon, color, onAction }: SwipeRowProps) {
  const ref = useRef<Swipeable>(null);
  return (
    <Swipeable
      ref={ref}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          style={[styles.swipeAction, { backgroundColor: color }]}
          onPress={() => {
            ref.current?.close();
            onAction();
          }}
          accessibilityLabel={label}
        >
          <Ionicons name={icon} size={22} color="#FFFFFF" />
          <Text style={styles.swipeLabel}>{label}</Text>
        </Pressable>
      )}
    >
      {children}
    </Swipeable>
  );
}

interface NoteRowProps {
  item: Recording;
  swipeDelete: boolean;
  onOpen(id: string): void;
  onRetry(id: string): void;
  onRemove(id: string): void;
  onArchive(id: string): void;
  onUnarchive(id: string): void;
}

// Linha memoizada: a home re-renderiza quando a fila muda; sem isto, todas as
// linhas (com Swipeable) eram recriadas a cada mudanca.
const NoteRow = memo(function NoteRow({
  item,
  swipeDelete,
  onOpen,
  onRetry,
  onRemove,
  onArchive,
  onUnarchive,
}: NoteRowProps) {
  return (
    <SwipeRow
      label={swipeDelete ? 'Apagar' : item.archived ? 'Desarquivar' : 'Arquivar'}
      icon={swipeDelete ? 'trash-outline' : 'archive-outline'}
      color={swipeDelete ? colors.danger : colors.warning}
      onAction={() => (swipeDelete ? onRemove(item.id) : onArchive(item.id))}
    >
      <RecordingCard
        recording={item}
        onRetry={() => onRetry(item.id)}
        onDelete={() => onRemove(item.id)}
        onOpen={() => onOpen(item.id)}
        onArchive={() => (item.archived ? onUnarchive(item.id) : onArchive(item.id))}
      />
    </SwipeRow>
  );
});

export default function RecordScreen() {
  const { recordings, retry, remove, kick, refresh, pull, createDraftNote, archiveNote, unarchiveNote } =
    useLibrary();
  const { swipeAction } = useSettings();

  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const pending = recordings.filter(
    (r) => PENDING_STATUSES.includes(r.status) || needsNoteSync(r),
  ).length;
  const interrupted = recordings.filter((r) => r.status === 'interrupted').length;

  const syncState: 'ok' | 'syncing' | 'error' = recordings.some((r) => r.status === 'failed')
    ? 'error'
    : pending > 0
      ? 'syncing'
      : 'ok';
  const syncIcon =
    syncState === 'error'
      ? 'cloud-offline-outline'
      : syncState === 'syncing'
        ? 'cloud-upload-outline'
        : 'cloud-done-outline';
  const syncColor =
    syncState === 'error'
      ? colors.danger
      : syncState === 'syncing'
        ? colors.textSecondary
        : colors.textTertiary;

  const term = query.trim().toLowerCase();
  const matches = (r: Recording) =>
    !term ||
    r.title.toLowerCase().includes(term) ||
    (r.text ?? '').toLowerCase().includes(term) ||
    (r.transcript ?? '').toLowerCase().includes(term);

  const activeNotes = recordings.filter((r) => !r.archived && !isBlankDraft(r) && matches(r));
  const archivedNotes = recordings.filter((r) => r.archived && matches(r));
  const sections: RecordingSection[] = groupRecordingsByYear(activeNotes);
  if (archivedNotes.length > 0) {
    sections.push({ year: 0, title: 'Arquivadas', data: archivedNotes });
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
      kick();
      pull();
    } finally {
      setRefreshing(false);
    }
  }, [refresh, kick, pull]);

  const handleRecord = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    const note = await createDraftNote();
    router.push({ pathname: '/record', params: { noteId: note.id } });
  };

  const handleAdd = async () => {
    const note = await createDraftNote();
    router.push({ pathname: '/note/[id]', params: { id: note.id } });
  };

  const openNote = useCallback(
    (noteId: string) => router.push({ pathname: '/note/[id]', params: { id: noteId } }),
    [],
  );
  const retryNote = useCallback((noteId: string) => void retry(noteId), [retry]);
  const removeNote = useCallback((noteId: string) => void remove(noteId), [remove]);
  const archive = useCallback((noteId: string) => void archiveNote(noteId), [archiveNote]);
  const unarchive = useCallback((noteId: string) => void unarchiveNote(noteId), [unarchiveNote]);
  const swipeDelete = swipeAction === 'delete';

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.largeTitle}>Notas</Text>
          <Text style={styles.headerSub}>
            {recordings.length === 0
              ? 'Nada por aqui ainda'
              : `${activeNotes.length} nota${activeNotes.length === 1 ? '' : 's'}${
                  pending > 0 ? ` · ${pending} na fila` : ''
                }`}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push('/sync')}
            accessibilityLabel="Sincronizacao"
          >
            <Ionicons name={syncIcon} size={22} color={syncColor} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Opcoes"
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {(
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar notas"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              style={styles.searchInput}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} accessibilityLabel="Limpar busca">
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>

          {interrupted > 0 ? (
            <Pressable style={styles.alert} onPress={() => router.push('/recovery')}>
              <Ionicons name="warning" size={18} color={colors.warning} />
              <Text style={styles.alertText}>
                {interrupted === 1
                  ? 'Uma gravacao foi interrompida'
                  : `${interrupted} gravacoes interrompidas`}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.warning} />
            </Pressable>
          ) : null}

          {pending > 0 ? (
            <Pressable style={styles.queueBar} onPress={kick}>
              <Ionicons name="cloud-upload-outline" size={16} color={colors.accent} />
              <Text style={styles.queueText}>{pending} na fila · Enviar agora</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.accent} />
            </Pressable>
          ) : null}

          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.textSecondary}
              />
            }
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <NoteRow
                item={item}
                swipeDelete={swipeDelete}
                onOpen={openNote}
                onRetry={retryNote}
                onRemove={removeNote}
                onArchive={archive}
                onUnarchive={unarchive}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="document-text-outline" size={30} color={colors.textTertiary} />
                </View>
                <Text style={styles.emptyTitle}>Nenhuma nota</Text>
                <Text style={styles.emptyText}>
                  Toque em + para escrever uma nota ou no botao vermelho para gravar audio.
                </Text>
              </View>
            }
          />
        </>
      )}

      <View style={styles.bottomBar}>
        <Pressable
          style={styles.audioButton}
          onPress={() => void handleRecord()}
          accessibilityLabel="Gravar audio"
        >
          <Ionicons name="mic" size={24} color="#FFFFFF" />
        </Pressable>
        <Pressable
          style={styles.textButton}
          onPress={() => void handleAdd()}
          accessibilityLabel="Nova nota de texto"
        >
          <Ionicons name="add" size={26} color={colors.text} />
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  headerText: { gap: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  largeTitle: { color: colors.text, fontSize: 34, fontWeight: '700', letterSpacing: 0.3 },
  headerSub: { color: colors.textSecondary, fontSize: fontSize.sm },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 40,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.sm, paddingVertical: 0 },
  recordingView: {
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
  recHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  separator: { height: spacing.sm },
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  swipeAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    borderRadius: 14,
    marginLeft: spacing.sm,
  },
  swipeLabel: { color: '#FFFFFF', fontSize: fontSize.xs, fontWeight: '700' },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.warningSoft,
    borderRadius: 14,
    padding: spacing.md,
  },
  alertText: { flex: 1, color: colors.warning, fontSize: fontSize.sm, fontWeight: '600' },
  queueBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    padding: spacing.md,
  },
  queueText: { flex: 1, color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  empty: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxxl },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  audioButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.record,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomHint: { color: colors.textTertiary, fontSize: fontSize.xs },
});
