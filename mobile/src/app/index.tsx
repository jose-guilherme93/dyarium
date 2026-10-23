import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { push } from '@/services/appNavigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Press } from '@/components/Press';
import { Swipeable } from 'react-native-gesture-handler';

import { ActivityCenter } from '@/components/ActivityCenter';
import { HomeHeader } from '@/components/HomeHeader';
import { NoteActionsSheet } from '@/components/NoteActionsSheet';
import type { NoteProperty } from '@/components/NoteMenu';
import { NotebookPicker } from '@/components/NotebookPicker';
import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import { TagFilterRow } from '@/components/TagFilterRow';
import { formatBytes, formatDateTime, noteDateIso, utf8ByteLength } from '@/core/format';
import {
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
        dense
        notebookLabel={notebookLabel}
        onOpen={onOpen}
        onLongPress={onLongPress}
      />
    </SwipeRow>
  );
});

// Identidade estavel: evita re-render dos cards a cada atualizacao da lista.
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

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  // `null` = paginas recentes (todos os cadernos); um id = so aquele caderno.
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [actionsNote, setActionsNote] = useState<Recording | null>(null);
  const [actionsProps, setActionsProps] = useState<NoteProperty[]>([]);
  const [actionsAnchor, setActionsAnchor] = useState<{ x: number; y: number } | null>(null);

  const scopeNotebook = scopeId
    ? notebooks.find((notebook) => notebook.id === scopeId)
    : undefined;
  // O caderno do escopo tambem e o destino de novas notas; sem escopo, vale o
  // ultimo escolhido e, por fim, o padrao.
  const targetNotebook =
    scopeNotebook ??
    notebooks.find((notebook) => notebook.id === lastNotebookId) ??
    notebooks.find((notebook) => notebook.isDefault) ??
    notebooks[0];
  // Handlers da lista nao podem depender de `notebooks`: cada refresh do banco
  // troca a identidade da lista, e isso recriava `openActions` e re-renderizava
  // todos os cards. As refs guardam a versao mais nova sem mudar os handlers.
  const notebooksRef = useRef(notebooks);
  const targetNotebookRef = useRef(targetNotebook);
  useEffect(() => {
    notebooksRef.current = notebooks;
  }, [notebooks]);
  useEffect(() => {
    targetNotebookRef.current = targetNotebook;
  }, [targetNotebook]);

  const notebookId = targetNotebook?.id ?? DEFAULT_NOTEBOOK_ID;

  const pending = recordings.filter(
    (r) => PENDING_STATUSES.includes(r.status) || needsNoteSync(r),
  ).length;
  const interrupted = recordings.filter((r) => r.status === 'interrupted').length;

  const syncState: 'ok' | 'syncing' | 'error' = recordings.some((r) => r.status === 'failed')
    ? 'error'
    : pending > 0
      ? 'syncing'
      : 'ok';

  const noteList = useMemo(
    () =>
      scopeNotebook
        ? notesInNotebook(recordings, {
            notebookId: scopeNotebook.id,
            tags: selectedTags,
            query,
          })
        : recentNotes(recordings, { tags: selectedTags, query }),
    [recordings, scopeNotebook, selectedTags, query],
  );
  const notebookNames = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook.name])),
    [notebooks],
  );
  const tagCounts = useMemo(
    () => tagCountsForFilter(recordings, scopeNotebook?.id ?? null, selectedTags),
    [recordings, scopeNotebook, selectedTags],
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
      targetNotebookRef.current;
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

  const toggleSearch = useCallback(() => {
    if (searchOpen) {
      setSearchOpen(false);
      setQuery('');
      return;
    }
    setSearchOpen(true);
  }, [searchOpen]);

  const selectScope = useCallback(
    (id: string | null) => {
      setScopeId(id);
      setNotebookPickerOpen(false);
      setQuery('');
      setSelectedTags([]);
      if (id) void setLastNotebookId(id);
    },
    [setLastNotebookId],
  );

  const renderNote = useCallback(
    ({ item }: { item: Recording }) => (
      <NoteRow
        item={item}
        swipeDelete={swipeDelete}
        notebookLabel={
          scopeNotebook
            ? undefined
            : (notebookNames.get(recordingNotebookId(item)) ?? 'Notas ao acaso')
        }
        onOpen={openNote}
        onLongPress={openActions}
        onRemove={removeNote}
        onArchive={archive}
        onUnarchive={unarchive}
      />
    ),
    [
      swipeDelete,
      scopeNotebook,
      notebookNames,
      openNote,
      openActions,
      removeNote,
      archive,
      unarchive,
    ],
  );

  const header = (
    <HomeHeader
      notebook={scopeNotebook}
      syncState={syncState}
      searchOpen={searchOpen}
      query={query}
      searchPlaceholder={
        scopeNotebook ? 'Buscar neste caderno' : 'Buscar em todos os cadernos'
      }
      onToggleSearch={toggleSearch}
      onChangeQuery={setQuery}
      onOpenNotebooks={() => setNotebookPickerOpen(true)}
      onOpenSync={() => push('/sync')}
      onOpenActivity={() => setActivityOpen(true)}
      onOpenSettings={() => push('/settings')}
    />
  );

  if (!ready) {
    // O cabecalho aparece no primeiro frame; so a lista espera o SQLite.
    return (
      <Screen style={styles.screen}>
        {header}
        <NoteListSkeleton />
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      {header}

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

      <FlatList
        data={noteList}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textSecondary}
          />
        }
        renderItem={renderNote}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name={
                  query || selectedTags.length > 0
                    ? 'funnel-outline'
                    : scopeNotebook
                      ? 'book-outline'
                      : 'time-outline'
                }
                size={30}
                color={colors.textTertiary}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {query || selectedTags.length > 0
                ? 'Nenhuma nota com esse filtro'
                : scopeNotebook
                  ? 'Nenhuma nota neste caderno'
                  : 'Nenhuma nota ainda'}
            </Text>
            <Text style={styles.emptyText}>
              {query || selectedTags.length > 0
                ? scopeNotebook
                  ? 'Limpe a busca ou as tags para ver o caderno inteiro.'
                  : 'Limpe a busca ou as tags para ver todas as notas.'
                : scopeNotebook
                  ? 'Toque em + para criar a primeira nota deste caderno.'
                  : 'Toque em + para criar uma nota de texto, imagem, áudio ou link.'}
            </Text>
          </View>
        }
      />

      {newMenuOpen ? (
        <Press
          style={styles.fabBackdrop}
          onPress={() => setNewMenuOpen(false)}
          feedback={false}
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

      <NotebookPicker
        visible={notebookPickerOpen}
        notebooks={notebooks}
        currentId={scopeNotebook?.id}
        recentSelected={!scopeNotebook}
        title="Cadernos"
        onClose={() => setNotebookPickerOpen(false)}
        onSelectRecent={() => selectScope(null)}
        onManage={() => {
          setNotebookPickerOpen(false);
          push('/notebooks');
        }}
        onSelect={selectScope}
      />

      {activityOpen ? (
        <ActivityCenter visible onClose={() => setActivityOpen(false)} />
      ) : null}

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

/** Esqueleto da lista: o app abre antes do SQLite terminar de ler. */
function NoteListSkeleton() {
  return (
    <View
      style={styles.skeleton}
      testID="home-loading"
      pointerEvents="none"
      accessibilityLabel="Carregando notas"
    >
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonSub} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0 },
  padded: { paddingHorizontal: spacing.sm },
  list: { paddingBottom: 96 },
  skeleton: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  skeletonRow: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  skeletonTitle: {
    width: '55%',
    height: 15,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  skeletonSub: {
    width: '82%',
    height: 11,
    borderRadius: 4,
    backgroundColor: colors.surface,
    opacity: 0.7,
  },
  swipeAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeLabel: { color: '#FFFFFF', fontSize: fontSize.xs, fontWeight: '700' },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    padding: spacing.sm,
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
