import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { push, replace } from '@/services/appNavigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  SectionList,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Press } from '@/components/Press';
import { Swipeable } from 'react-native-gesture-handler';

import { NoteActionsSheet } from '@/components/NoteActionsSheet';
import type { NoteProperty } from '@/components/NoteMenu';
import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import { TagFilterRow } from '@/components/TagFilterRow';
import { formatBytes, formatDateTime, noteDateIso, utf8ByteLength } from '@/core/format';
import { groupRecordingsByYear, type RecordingSection } from '@/core/group';
import {
  noteMatches,
  notesInNotebook,
  recentNotes,
  recordingNotebookId,
  tagCountsForFilter,
} from '@/core/notebookFilter';
import { DEFAULT_NOTEBOOK_ID } from '@/core/notebooks';
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
        <Press
          style={[styles.swipeAction, { backgroundColor: color }]}
          onPress={() => {
            ref.current?.close();
            onAction();
          }}
          accessibilityLabel={label}
        >
          <Ionicons name={icon} size={22} color="#FFFFFF" />
          <Text style={styles.swipeLabel}>{label}</Text>
        </Press>
      )}
    >
      {children}
    </Swipeable>
  );
}

interface NoteRowProps {
  item: Recording;
  swipeDelete: boolean;
  notebookLabel?: string;
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
  notebookLabel,
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
        notebookLabel={notebookLabel}
        onOpen={onOpen}
        onLongPress={onLongPress}
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

export default function NotebookScreen() {
  const {
    recordings,
    notebooks,
    ready,
    remove,
    kick,
    refresh,
    pull,
    createDraftNote,
    archiveNote,
    unarchiveNote,
  } = useLibrary();
  const { start: startRecording } = useRecording();
  const { swipeAction, lastNotebookId, setLastNotebookId } = useSettings();
  useRenderCount('NotebookScreen');

  const [viewMode, setViewMode] = useState<'recent' | 'notebook'>('recent');
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [actionsNote, setActionsNote] = useState<Recording | null>(null);
  const [actionsProps, setActionsProps] = useState<NoteProperty[]>([]);
  const [actionsAnchor, setActionsAnchor] = useState<{ x: number; y: number } | null>(null);

  const currentNotebook =
    notebooks.find((notebook) => notebook.id === lastNotebookId) ??
    (notebooks.length === 1 ? notebooks[0] : undefined);
  const redirectedRef = useRef(false);
  // Handlers da lista nao podem depender de `notebooks`: cada refresh do banco
  // troca a identidade da lista, e isso recriava `openActions` e re-renderizava
  // todos os cards. As refs guardam a versao mais nova sem mudar os handlers.
  const notebooksRef = useRef(notebooks);
  const currentNotebookRef = useRef(currentNotebook);
  useEffect(() => {
    notebooksRef.current = notebooks;
  }, [notebooks]);
  useEffect(() => {
    currentNotebookRef.current = currentNotebook;
  }, [currentNotebook]);

  // Sem caderno valido e com mais de um, a escolha e a tela inicial.
  useEffect(() => {
    if (!ready || notebooks.length === 0) return;
    if (currentNotebook) {
      if (lastNotebookId !== currentNotebook.id) void setLastNotebookId(currentNotebook.id);
      return;
    }
    if (!redirectedRef.current) {
      redirectedRef.current = true;
      replace('/notebooks');
    }
  }, [ready, notebooks.length, currentNotebook, lastNotebookId, setLastNotebookId]);

  // Entrar em outro caderno zera busca e tags; o filtro nao fica preso.
  const notebookId = currentNotebook?.id ?? DEFAULT_NOTEBOOK_ID;
  useEffect(() => {
    // Reset deliberado ao trocar de caderno ou de modo: filtros nao ficam presos.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTags([]);
    setQuery('');
  }, [notebookId, viewMode]);

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

  const notebookFilter = useMemo(
    () => ({ notebookId, tags: selectedTags, query }),
    [notebookId, selectedTags, query],
  );
  const activeNotes = useMemo(
    () => notesInNotebook(recordings, notebookFilter),
    [recordings, notebookFilter],
  );
  const archivedNotes = useMemo(
    () =>
      recordings.filter(
        (recording) => recording.archived && noteMatches(recording, notebookFilter),
      ),
    [recordings, notebookFilter],
  );
  const sections: RecordingSection[] = useMemo(() => {
    const grouped = groupRecordingsByYear(activeNotes);
    if (archivedNotes.length > 0) {
      grouped.push({ year: 0, title: 'Arquivadas', data: archivedNotes });
    }
    return grouped;
  }, [activeNotes, archivedNotes]);
  const recentList = useMemo(
    () => recentNotes(recordings, { tags: selectedTags, query }),
    [recordings, selectedTags, query],
  );
  const notebookNames = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook.name])),
    [notebooks],
  );
  const tagCounts = useMemo(
    () =>
      tagCountsForFilter(
        recordings,
        viewMode === 'recent' ? null : notebookId,
        selectedTags,
      ),
    [recordings, viewMode, notebookId, selectedTags],
  );

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
      const note = await createDraftNote(notebookId);
      push({ pathname: '/note/[id]', params: { id: note.id, action } });
    },
    [createDraftNote, notebookId],
  );

  const startAudio = useCallback(async () => {
    setNewMenuOpen(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    // O microfone abre no toque, antes da nota ser criada: a tela de gravacao
    // entra na frente enquanto o rascunho e resolvido por tras.
    void startRecording();
    const note = await createDraftNote(notebookId);
    push({ pathname: '/record', params: { noteId: note.id, from: 'home' } });
  }, [createDraftNote, notebookId, startRecording]);

  const openNote = useCallback(
    (noteId: string) => push({ pathname: '/note/[id]', params: { id: noteId } }),
    [],
  );
  const removeNote = useCallback((noteId: string) => void remove(noteId), [remove]);

  const openActions = useCallback((item: Recording, anchor: { x: number; y: number }) => {
    const plain = markdownToPlain(item.text ?? '');
    const bytes = directoryBytes(sessionDirectory(item.id)) + utf8ByteLength(plain);
    const notebook =
      notebooksRef.current.find((entry) => entry.id === (item.notebookId || DEFAULT_NOTEBOOK_ID)) ??
      currentNotebookRef.current;
    setActionsAnchor(anchor);
    setActionsNote(item);
    setActionsProps([
      { label: 'Caderno', value: notebook?.name ?? 'Notas ao acaso' },
      { label: 'Gravada em', value: formatDateTime(noteDateIso(item)) },
      item.source === 'share'
        ? { label: 'Importada em', value: formatDateTime(item.createdAt) }
        : { label: 'Criada em', value: formatDateTime(item.createdAt) },
      ...(item.tags && item.tags.length > 0
        ? [{ label: 'Tags', value: item.tags.join(', ') }]
        : []),
      {
        label: 'Origem',
        value: item.filePath ? (item.source === 'share' ? 'Áudio importado' : 'Áudio') : 'Texto',
      },
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

  const toggleTag = useCallback((name: string) => {
    setSelectedTags((prev) =>
      prev.some((tag) => tag.toLowerCase() === name.toLowerCase())
        ? prev.filter((tag) => tag.toLowerCase() !== name.toLowerCase())
        : [...prev, name],
    );
  }, []);

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

  const renderRecentItem = useCallback(
    ({ item }: { item: Recording }) => (
      <NoteRow
        item={item}
        swipeDelete={swipeDelete}
        notebookLabel={notebookNames.get(recordingNotebookId(item)) ?? 'Notas ao acaso'}
        onOpen={openNote}
        onLongPress={openActions}
        onRemove={removeNote}
        onArchive={archive}
        onUnarchive={unarchive}
      />
    ),
    [
      swipeDelete,
      notebookNames,
      openNote,
      openActions,
      removeNote,
      archive,
      unarchive,
    ],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: RecordingSection }) => (
      <Text style={styles.sectionHeader}>{section.title}</Text>
    ),
    [],
  );

  if (!ready) {
    // Evita piscar "Escolha um caderno" antes de o SQLite entregar o caderno
    // salvo; a tela ja esta preta como o resto do app.
    return (
      <Screen style={styles.screen}>
        <View />
      </Screen>
    );
  }

  if (!currentNotebook) {
    return (
      <Screen style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.largeTitle}>Cadernos</Text>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Escolha um caderno</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerActions}>
          <Press
            style={styles.iconButton}
            onPress={() => push('/sync')}
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
          </Press>
          <Press
            style={styles.iconButton}
            onPress={() => push('/settings')}
            accessibilityLabel="Opções"
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Press>
        </View>

        <Press
          style={styles.notebookTitle}
          onPress={() => push('/notebooks')}
          accessibilityRole="button"
          accessibilityLabel={`Caderno ${currentNotebook.name}. Trocar de caderno`}
        >
          <View
            style={[
              styles.notebookDot,
              { backgroundColor: currentNotebook.color || colors.textTertiary },
            ]}
          />
          <Text style={styles.largeTitle}>{currentNotebook.name}</Text>
          <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
        </Press>
      </View>

      <View style={styles.modeToggle}>
        <Press
          style={[styles.modeOption, viewMode === 'recent' ? styles.modeOptionOn : null]}
          onPress={() => setViewMode('recent')}
          accessibilityRole="tab"
          accessibilityState={{ selected: viewMode === 'recent' }}
        >
          <Text
            style={[styles.modeText, viewMode === 'recent' ? styles.modeTextOn : null]}
          >
            Páginas recentes
          </Text>
        </Press>
        <Press
          style={[styles.modeOption, viewMode === 'notebook' ? styles.modeOptionOn : null]}
          onPress={() => setViewMode('notebook')}
          accessibilityRole="tab"
          accessibilityState={{ selected: viewMode === 'notebook' }}
        >
          <Text
            style={[styles.modeText, viewMode === 'notebook' ? styles.modeTextOn : null]}
          >
            Caderno
          </Text>
        </Press>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={
            viewMode === 'recent' ? 'Buscar em todos os cadernos' : 'Buscar neste caderno'
          }
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          style={styles.searchInput}
        />
        {query ? (
          <Press onPress={() => setQuery('')} accessibilityLabel="Limpar busca">
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </Press>
        ) : null}
      </View>

      {interrupted > 0 ? (
        <Press style={styles.alert} onPress={() => push('/recovery')}>
          <Ionicons name="warning" size={18} color={colors.warning} />
          <Text style={styles.alertText}>
            {interrupted === 1
              ? 'Uma gravação foi interrompida'
              : `${interrupted} gravações interrompidas`}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.warning} />
        </Press>
      ) : null}

      <View style={styles.padded}>
        <TagFilterRow
          tags={tagCounts}
          selected={selectedTags}
          onToggle={toggleTag}
          onClear={() => setSelectedTags([])}
          onManage={() => push('/tags')}
        />
      </View>

      {viewMode === 'recent' ? (
        <FlatList
          data={recentList}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={ItemSeparator}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textSecondary}
            />
          }
          renderItem={renderRecentItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name={
                    query || selectedTags.length > 0
                      ? 'funnel-outline'
                      : 'time-outline'
                  }
                  size={30}
                  color={colors.textTertiary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {query || selectedTags.length > 0
                  ? 'Nenhuma nota com esse filtro'
                  : 'Nenhuma nota ainda'}
              </Text>
              <Text style={styles.emptyText}>
                {query || selectedTags.length > 0
                  ? 'Limpe a busca ou as tags para ver todas as notas.'
                  : 'Toque em + para criar uma nota de texto, imagem, áudio ou link.'}
              </Text>
            </View>
          }
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={ItemSeparator}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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
                <Ionicons
                  name={
                    query || selectedTags.length > 0
                      ? 'funnel-outline'
                      : 'document-text-outline'
                  }
                  size={30}
                  color={colors.textTertiary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {query || selectedTags.length > 0
                  ? 'Nenhuma nota com esse filtro'
                  : 'Nenhuma nota'}
              </Text>
              <Text style={styles.emptyText}>
                {query || selectedTags.length > 0
                  ? 'Limpe a busca ou as tags para ver o caderno inteiro.'
                  : 'Toque em + para criar uma nota de texto, imagem, áudio ou link.'}
              </Text>
            </View>
          }
        />
      )}

      {newMenuOpen ? (
        <Press
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
        <Press
          style={styles.fab}
          onPress={() => setNewMenuOpen((value) => !value)}
          accessibilityLabel={newMenuOpen ? 'Fechar menu' : 'Nova nota'}
        >
          <Ionicons name={newMenuOpen ? 'close' : 'add'} size={28} color="#FFFFFF" />
        </Press>
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
    <Press style={styles.fabItem} onPress={onPress} accessibilityLabel={label}>
      <Text style={styles.fabItemLabel}>{label}</Text>
      <View style={styles.fabItemIcon}>
        <Ionicons name={icon} size={18} color={colors.text} />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0 },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  notebookTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  notebookDot: { width: 9, height: 9, borderRadius: 5 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.sm,
  },
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
  largeTitle: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  modeToggle: {
    flexDirection: 'row',
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    padding: 3,
    gap: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeOption: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  modeOptionOn: { backgroundColor: colors.surfaceElevated },
  modeText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  modeTextOn: { color: colors.text, fontWeight: '700' },
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
  padded: { paddingHorizontal: spacing.xl },
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
