import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { memo, useCallback, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  SectionList,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { NoteActionsSheet } from '@/components/NoteActionsSheet';
import type { NoteProperty } from '@/components/NoteMenu';
import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import { formatBytes, formatDateTime, utf8ByteLength } from '@/core/format';
import { groupRecordingsByYear, type RecordingSection } from '@/core/group';
import { isBlankDraft } from '@/core/note';
import { countChars, countWords, markdownToPlain } from '@/core/richText';
import { displayTitle } from '@/core/title';
import { needsNoteSync, type Recording } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { directoryBytes, sessionDirectory } from '@/services/files';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording } from '@/state/RecordingContext';
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
  onLongPress(item: Recording, anchor: { x: number; y: number }): void;
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
  onLongPress,
  onRemove,
  onArchive,
  onUnarchive,
}: NoteRowProps) {
  return (
    <SwipeRow
      label={swipeDelete ? 'Apagar' : item.archived ? 'Desarquivar' : 'Arquivar'}
      icon={swipeDelete ? 'trash-outline' : 'archive-outline'}
      color={swipeDelete ? colors.danger : colors.warning}
      onAction={() =>
        swipeDelete ? onRemove(item.id) : item.archived ? onUnarchive(item.id) : onArchive(item.id)
      }
    >
      <RecordingCard
        recording={item}
        onOpen={() => onOpen(item.id)}
        onLongPress={(anchor) => onLongPress(item, anchor)}
      />
    </SwipeRow>
  );
});

// Identidade estavel: evita re-render dos cards a cada atualizacao da lista.
function ItemSeparator() {
  return <View style={styles.separator} />;
}

function keyExtractor(item: Recording) {
  return item.id;
}

export default function RecordScreen() {
  const { recordings, remove, kick, refresh, pull, createDraftNote, archiveNote, unarchiveNote } =
    useLibrary();
  const { start: startRecording } = useRecording();
  const { swipeAction } = useSettings();
  useRenderCount('Home');

  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [actionsNote, setActionsNote] = useState<Recording | null>(null);
  const [actionsProps, setActionsProps] = useState<NoteProperty[]>([]);
  const [actionsAnchor, setActionsAnchor] = useState<{ x: number; y: number } | null>(null);

  const pending = recordings.filter(
    (r) => PENDING_STATUSES.includes(r.status) || needsNoteSync(r),
  ).length;
  const interrupted = recordings.filter((r) => r.status === 'interrupted').length;

  const syncState: 'ok' | 'syncing' | 'error' = recordings.some((r) => r.status === 'failed')
    ? 'error'
    : pending > 0
      ? 'syncing'
      : 'ok';
  // Nuvem discreta: o proprio icone diz o estado geral e um pequeno ponto ao
  // lado sinaliza envio em andamento (azul) ou falha (vermelho).
  const syncIcon =
    syncState === 'error'
      ? 'cloud-offline-outline'
      : syncState === 'syncing'
        ? 'cloud-upload-outline'
        : 'cloud-done-outline';

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

  // Cada opcao do menu cria a nota e ja abre no modo certo, para o usuario
  // escrever/gravar/anexar sem passos extras dentro da nota.
  const startNote = useCallback(
    async (action: 'text' | 'image' | 'link') => {
      setNewMenuOpen(false);
      const note = await createDraftNote();
      router.push({ pathname: '/note/[id]', params: { id: note.id, action } });
    },
    [createDraftNote],
  );

  const startAudio = useCallback(async () => {
    setNewMenuOpen(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    const note = await createDraftNote();
    // Dispara a gravacao enquanto navega: quando a tela abre, ja esta gravando.
    void startRecording();
    router.push({ pathname: '/record', params: { noteId: note.id } });
  }, [createDraftNote, startRecording]);

  const openNote = useCallback(
    (noteId: string) => router.push({ pathname: '/note/[id]', params: { id: noteId } }),
    [],
  );
  const removeNote = useCallback((noteId: string) => void remove(noteId), [remove]);

  // Toque longo no card: abre as opcoes (compartilhar, arquivar, apagar, ficha).
  const openActions = useCallback((item: Recording, anchor: { x: number; y: number }) => {
    const plain = markdownToPlain(item.text ?? '');
    const bytes = directoryBytes(sessionDirectory(item.id)) + utf8ByteLength(plain);
    setActionsAnchor(anchor);
    setActionsNote(item);
    setActionsProps([
      { label: 'Criada', value: formatDateTime(item.createdAt) },
      { label: 'Origem', value: item.filePath ? 'Áudio' : 'Texto' },
      { label: 'Palavras', value: String(countWords(item.text ?? '')) },
      { label: 'Caracteres', value: String(countChars(item.text ?? '')) },
      { label: 'Tamanho', value: formatBytes(bytes) },
      { label: 'Status', value: STATUS_META[item.status].label },
    ]);
  }, []);

  const closeActions = useCallback(() => setActionsNote(null), []);

  const shareActions = useCallback(() => {
    const item = actionsNote;
    setActionsNote(null);
    if (!item) return;
    const parts = [displayTitle(item)];
    const plain = markdownToPlain(item.text ?? '').trim();
    if (plain) parts.push('', plain);
    if (item.transcript && item.transcript.trim() && item.transcript !== item.text) {
      parts.push('', item.transcript.trim());
    }
    void Share.share({ message: parts.join('\n') }).catch(() => undefined);
  }, [actionsNote]);

  const archiveActions = useCallback(() => {
    const item = actionsNote;
    setActionsNote(null);
    if (!item) return;
    void (item.archived ? unarchiveNote(item.id) : archiveNote(item.id));
  }, [actionsNote, archiveNote, unarchiveNote]);

  const deleteActions = useCallback(() => {
    const item = actionsNote;
    setActionsNote(null);
    if (!item) return;
    void remove(item.id);
  }, [actionsNote, remove]);
  const archive = useCallback((noteId: string) => void archiveNote(noteId), [archiveNote]);
  const unarchive = useCallback((noteId: string) => void unarchiveNote(noteId), [unarchiveNote]);
  const swipeDelete = swipeAction === 'delete';

  const renderItem = useCallback(
    ({ item }: { item: Recording }) => (
      <NoteRow
        item={item}
        swipeDelete={swipeDelete}
        onOpen={openNote}
        onLongPress={openActions}
        onRemove={removeNote}
        onArchive={archive}
        onUnarchive={unarchive}
      />
    ),
    [swipeDelete, openNote, openActions, removeNote, archive, unarchive],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: RecordingSection }) => (
      <Text style={styles.sectionHeader}>{section.title}</Text>
    ),
    [],
  );

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.largeTitle}>Notas</Text>
          <Text style={styles.headerSub}>
            {recordings.length === 0
              ? 'Nada por aqui ainda'
              : `${activeNotes.length} nota${activeNotes.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push('/sync')}
            accessibilityLabel="Sincronização"
          >
            <Ionicons name={syncIcon} size={22} color={colors.textTertiary} />
            {syncState !== 'ok' ? (
              <View
                style={[
                  styles.syncDot,
                  { backgroundColor: syncState === 'error' ? colors.danger : colors.accent },
                ]}
              />
            ) : null}
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Opções"
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
                  ? 'Uma gravação foi interrompida'
                  : `${interrupted} gravações interrompidas`}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.warning} />
            </Pressable>
          ) : null}

          <SectionList
            sections={sections}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={ItemSeparator}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.textSecondary}
              />
            }
            renderSectionHeader={renderSectionHeader}
            renderItem={renderItem}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="document-text-outline" size={30} color={colors.textTertiary} />
                </View>
                <Text style={styles.emptyTitle}>Nenhuma nota</Text>
                <Text style={styles.emptyText}>
                  Toque em + para criar uma nota de texto, imagem, áudio ou link.
                </Text>
              </View>
            }
          />
        </>
      )}

      {newMenuOpen ? (
        <Pressable
          style={styles.fabBackdrop}
          onPress={() => setNewMenuOpen(false)}
          accessibilityLabel="Fechar menu"
        />
      ) : null}

      <View style={styles.fabWrap} pointerEvents="box-none">
        {newMenuOpen ? (
          <View style={styles.fabMenu}>
            <NewMenuItem icon="link-outline" label="Link" onPress={() => void startNote('link')} />
            <NewMenuItem
              icon="image-outline"
              label="Imagem"
              onPress={() => void startNote('image')}
            />
            <NewMenuItem icon="mic-outline" label="Áudio" onPress={() => void startAudio()} />
            <NewMenuItem
              icon="document-text-outline"
              label="Texto"
              onPress={() => void startNote('text')}
            />
          </View>
        ) : null}
        <Pressable
          style={styles.fab}
          onPress={() => setNewMenuOpen((value) => !value)}
          accessibilityLabel={newMenuOpen ? 'Fechar menu' : 'Nova nota'}
        >
          <Ionicons name={newMenuOpen ? 'close' : 'add'} size={28} color="#FFFFFF" />
        </Pressable>
      </View>

      <NoteActionsSheet
        recording={actionsNote}
        properties={actionsProps}
        anchor={actionsAnchor}
        onClose={closeActions}
        onShare={shareActions}
        onArchive={archiveActions}
        onDelete={deleteActions}
      />
    </Screen>
  );
}

function NewMenuItem({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.fabItem} onPress={onPress} accessibilityLabel={label}>
      <Text style={styles.fabItemLabel}>{label}</Text>
      <View style={styles.fabItemIcon}>
        <Ionicons name={icon} size={18} color={colors.text} />
      </View>
    </Pressable>
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
  syncDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
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
  list: { paddingHorizontal: spacing.xl, paddingBottom: 96 },
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
  fabBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  fabWrap: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  fabMenu: { alignItems: 'flex-end', gap: spacing.sm },
  fabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  fabItemLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  fabItemIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
