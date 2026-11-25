import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { push } from '@/services/appNavigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Swipeable } from 'react-native-gesture-handler';

import { ActivityCenter } from '@/components/ActivityCenter';
import { activityDestination } from '@/services/activity';
import { useActivities } from '@/state/useActivities';
import { HomeHeader } from '@/components/HomeHeader';
import { NoteActionsSheet } from '@/components/NoteActionsSheet';
import type { NoteProperty } from '@/components/NoteMenu';
import { NotebookPicker } from '@/components/NotebookPicker';
import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { DriveExpiredBanner } from '@/components/DriveExpiredBanner';
import { STATUS_LABELS } from '@/components/StatusChip';
import { TagFilterRow } from '@/components/TagFilterRow';
import { RecentCard } from '@/components/RecentCard';
import { NoteOrderSheet } from '@/components/NoteOrderSheet';
import { formatBytes, formatDateTime, noteDateIso } from '@/core/format';
import {
  recordingNotebookId,
  tagCountsForFilter,
} from '@/core/notebookFilter';
import { DEFAULT_NOTEBOOK_ID, noteNotebooks } from '@/core/notebooks';
import { buildRecentItems, filterRecent, sortRecent, type RecentItem } from '@/core/recent';
import { noteStats } from '@/core/noteStats';
import { markdownToPlain } from '@/core/richText';
import { displayTitle } from '@/core/title';
import { needsNoteSync, type Recording } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { directoryBytes, sessionDirectory } from '@/services/files';
import { useLibrary } from '@/state/LibraryContext';
import { useDrive } from '@/state/useDrive';
import { useRecording } from '@/state/RecordingContext';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';
import { Button, Icon, type IconName } from '@/ui';
import { designRadius, designRow, designSpace, designType } from '@/theme/design';
import { useDesign } from '@/ui/useDesign';

const PENDING_STATUSES = ['recorded', 'queued', 'uploading', 'failed'];

interface SwipeRowProps {
  children: React.ReactNode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onAction: () => void;
}

function SwipeRow({ children, label, icon, color, onAction }: SwipeRowProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

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
          <Ionicons name={icon} size={22} color={colors.onAccent} />
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
  glyphIcon?: IconName;
  glyphColor?: string;
  onOpen(id: string): void;
  onLongPress(item: Recording, anchor: { x: number; y: number }): void;
  onRemove(id: string): void;
  onArchive(id: string): void;
  onUnarchive(id: string): void;
  busy?: {
    kind: 'transcription' | 'analysis';
    percent?: number;
    queued?: boolean;
    remote?: boolean;
  } | null;
}

// Linha memoizada: a home re-renderiza quando a fila muda; sem isto, todas as
// linhas (com Swipeable) eram recriadas a cada mudanca.
const NoteRow = memo(function NoteRow({
  item,
  swipeDelete,
  notebookLabel,
  glyphIcon,
  glyphColor,
  onOpen,
  onLongPress,
  onRemove,
  onArchive,
  onUnarchive,
  busy = null,
}: NoteRowProps) {
  const { colors } = useTheme();

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
        busy={busy}
        glyphIcon={glyphIcon}
        glyphColor={glyphColor}
        onOpen={onOpen}
        onLongPress={onLongPress}
      />
    </SwipeRow>
  );
});

// Identidade estavel: evita re-render dos cards a cada atualizacao da lista.
function keyExtractor(item: RecentItem) {
  if (item.kind === 'note') return `note:${item.recording.id}`;
  if (item.kind === 'book') return `book:${item.notebook.id}`;
  return `project:${item.mcpId}:${item.name}`;
}

export default function NotebookScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const designColors = useDesign();

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
  const { swipeAction, lastNotebookId, setLastNotebookId, noteOrder, setNoteOrder } =
    useSettings();
  const drive = useDrive();
  useRenderCount('NotebookScreen');
  // Trabalho pesado em andamento por nota: o card mostra icone e porcentagem.
  const activities = useActivities();
  const busyByNote = useMemo(() => {
    const map = new Map<
      string,
      {
        kind: 'transcription' | 'analysis';
        percent?: number;
        queued?: boolean;
        remote?: boolean;
      }
    >();
    for (const activity of activities) {
      if (activity.status !== 'running') continue;
      if (activity.kind !== 'transcription' && activity.kind !== 'analysis') continue;
      const destination = activityDestination(activity);
      if (!destination?.noteId) continue;
      const current = map.get(destination.noteId);
      const next = {
        kind: activity.kind,
        percent: activity.progress,
        queued: activity.progress === undefined,
        remote: activity.detail === 'No servidor',
      };
      // O trabalho mais recente da nota aparece; os demais seguem no centro.
      if (!current || (next.percent ?? 0) >= (current.percent ?? 0)) {
        map.set(destination.noteId, next);
      }
    }
    return map;
  }, [activities]);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // A lista vazia por filtro oferece a saida em um toque, sem paragrafo.
  const clearFilters = useCallback(() => {
    setQuery('');
    setSelectedTags([]);
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  // `null` = paginas recentes (todos os cadernos); um id = so aquele caderno.
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [actionsNote, setActionsNote] = useState<Recording | null>(null);
  const [actionsProps, setActionsProps] = useState<NoteProperty[]>([]);
  const [actionsAnchor, setActionsAnchor] = useState<{ x: number; y: number } | null>(null);

  // Livros e o caderno MCP ficam fora da lista de notas: livros viram linhas
  // proprias e o MCP vira projetos. O picker de caderno continua mostrando o
  // MCP, porque seleciona-lo abre a superficie Projetos.
  const shownNotebooks = useMemo(() => noteNotebooks(notebooks), [notebooks]);
  const noteNotebookIds = useMemo(
    () => new Set(notebooks.filter((n) => n.kind !== 'book' && n.kind !== 'mcp').map((n) => n.id)),
    [notebooks],
  );
  const diaryRecordings = useMemo(
    () => recordings.filter((recording) => noteNotebookIds.has(recordingNotebookId(recording))),
    [recordings, noteNotebookIds],
  );
  const scopeNotebook = scopeId
    ? shownNotebooks.find((notebook) => notebook.id === scopeId)
    : undefined;
  // O caderno do escopo tambem e o destino de novas notas; sem escopo, vale o
  // ultimo escolhido e, por fim, o padrao.
  const targetNotebook =
    scopeNotebook ??
    shownNotebooks.find((notebook) => notebook.id === lastNotebookId) ??
    shownNotebooks.find((notebook) => notebook.isDefault) ??
    shownNotebooks[0];
  // Handlers da lista nao podem depender de `notebooks`: cada refresh do banco
  // troca a identidade da lista, e isso recriava `openActions` e re-renderizava
  // todos os cards. As refs guardam a versao mais nova sem mudar os handlers.
  const notebooksRef = useRef(shownNotebooks);
  const targetNotebookRef = useRef(targetNotebook);
  useEffect(() => {
    notebooksRef.current = shownNotebooks;
  }, [shownNotebooks]);
  useEffect(() => {
    targetNotebookRef.current = targetNotebook;
  }, [targetNotebook]);

  const notebookId = targetNotebook?.id ?? DEFAULT_NOTEBOOK_ID;

  const pending = diaryRecordings.filter(
    (r) => PENDING_STATUSES.includes(r.status) || needsNoteSync(r),
  ).length;
  const interrupted = diaryRecordings.filter((r) => r.status === 'interrupted').length;

  const syncState: 'ok' | 'syncing' | 'error' = diaryRecordings.some((r) => r.status === 'failed')
    ? 'error'
    : pending > 0
      ? 'syncing'
      : 'ok';

  const recentItems = useMemo(
    () => buildRecentItems({ recordings, notebooks }),
    [recordings, notebooks],
  );
  const itemList = useMemo(
    () =>
      sortRecent(
        filterRecent(recentItems, {
          query,
          tags: selectedTags,
          notebookId: scopeNotebook?.id ?? null,
        }),
        noteOrder,
      ),
    [recentItems, query, selectedTags, scopeNotebook, noteOrder],
  );
  const notebookNames = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook.name])),
    [notebooks],
  );
  const tagCounts = useMemo(
    () => tagCountsForFilter(diaryRecordings, scopeNotebook?.id ?? null, selectedTags),
    [diaryRecordings, scopeNotebook, selectedTags],
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
    // Uma conversao para texto puro alimenta palavras, caracteres e tamanho.
    const stats = noteStats(item.text ?? '');
    const bytes = directoryBytes(sessionDirectory(item.id)) + stats.bodyBytes;
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
      { label: 'Palavras', value: String(stats.words) },
      { label: 'Caracteres', value: String(stats.chars) },
      { label: 'Tamanho', value: formatBytes(bytes) },
      { label: 'Status', value: STATUS_LABELS[item.status] },
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
      // O caderno de projetos nao e uma lista de notas: no app ele abre a
      // superficie Projetos, com as abas Itens e Projetos (docs/projetos.md).
      if (id) {
        const target = notebooksRef.current.find((notebook) => notebook.id === id);
        if (target?.kind === 'mcp') {
          setNotebookPickerOpen(false);
          push({ pathname: '/projects', params: { notebook: id } });
          return;
        }
      }
      setScopeId(id);
      setNotebookPickerOpen(false);
      setQuery('');
      setSelectedTags([]);
      if (id) void setLastNotebookId(id);
    },
    [setLastNotebookId],
  );

  const renderRecentItem = useCallback(
    ({ item }: { item: RecentItem }) => {
      if (item.kind === 'note') {
        const recording = item.recording;
        return (
          <NoteRow
            item={recording}
            swipeDelete={swipeDelete}
            notebookLabel={
              scopeNotebook
                ? undefined
                : (notebookNames.get(recordingNotebookId(recording)) ?? 'Notas ao acaso')
            }
            glyphIcon="doc"
            glyphColor={designColors.textMuted}
            onOpen={openNote}
            onLongPress={openActions}
            onRemove={removeNote}
            onArchive={archive}
            onUnarchive={unarchive}
            busy={busyByNote.get(recording.id) ?? null}
          />
        );
      }
      return <RecentCard item={item} />;
    },
    [
      swipeDelete,
      scopeNotebook,
      notebookNames,
      openNote,
      openActions,
      busyByNote,
      removeNote,
      archive,
      unarchive,
      designColors.textMuted,
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
      onOpenMap={() => push('/map')}
      onOpenCalendar={() => push('/calendar')}
      onOpenActivity={() => setActivityOpen(true)}
      onOpenSettings={() => push('/settings')}
      profile={drive.profile}
      accountState={
        drive.status === 'connected'
          ? 'connected'
          : drive.status === 'expired'
            ? 'expired'
            : 'off'
      }
      onOpenProfile={() => push('/perfil')}
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

      <DriveExpiredBanner />

      {interrupted > 0 ? (
        <Press
          style={[
            styles.alert,
            { borderColor: designColors.warning, backgroundColor: designColors.surfaceAlt },
          ]}
          onPress={() => push('/recovery')}
        >
          <Icon name="alert" size={12} color={designColors.warning} />
          <Text style={[styles.alertText, { color: designColors.text }]}>
            {interrupted === 1
              ? 'Uma gravação foi interrompida'
              : `${interrupted} gravações interrompidas`}
          </Text>
          <Icon name="forward" size={12} color={designColors.warning} />
        </Press>
      ) : null}

      <View style={styles.padded}>
        <TagFilterRow
          tags={tagCounts}
          selected={selectedTags}
          onToggle={toggleTag}
          onClear={() => setSelectedTags([])}
          onManage={() => push('/tags')}
          order={noteOrder}
          onPressOrder={() => setOrderOpen(true)}
        />
      </View>

      <FlatList
        data={itemList}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // A home abre com 10 linhas, nao com a tela inteira de cards: cada card
        // monta um Swipeable e o icone da capa. Montar 50 no boot segurava o
        // primeiro toque do usuario.
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={7}
        updateCellsBatchingPeriod={50}
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
            <Icon
              name={
                query || selectedTags.length > 0
                  ? 'search'
                  : scopeNotebook
                    ? 'book'
                    : 'clock'
              }
              size={24}
              color={designColors.textMuted}
            />
            <Text style={styles.emptyTitle}>
              {query || selectedTags.length > 0
                ? 'Nenhuma nota com esse filtro'
                : scopeNotebook
                  ? 'Nenhuma nota neste caderno'
                  : 'Nenhuma nota ainda'}
            </Text>
            <View style={styles.emptyAction}>
              {query || selectedTags.length > 0 ? (
                <Button title="limpar filtros" variant="secondary" onPress={clearFilters} />
              ) : (
                <Button title="nova nota" onPress={() => setNewMenuOpen(true)} />
              )}
            </View>
          </View>
        }
      />

      {newMenuOpen ? (
        <Press
          style={[styles.fabBackdrop, { backgroundColor: designColors.overlay }]}
          onPress={() => setNewMenuOpen(false)}
          feedback={false}
          accessibilityLabel="Fechar menu"
        />
      ) : null}

      <View style={styles.fabWrap} pointerEvents="box-none">
        {newMenuOpen ? (
          <View style={styles.fabMenu}>
            <NewMenuItem icon="link" label="Link" onPress={() => void startNote('link')} />
            <NewMenuItem icon="image" label="Imagem" onPress={() => void startNote('image')} />
            <NewMenuItem icon="mic" label="Áudio" onPress={() => void startAudio()} />
            <NewMenuItem icon="doc" label="Texto" onPress={() => void startNote('text')} />
          </View>
        ) : null}
        <Press
          style={[styles.fab, { backgroundColor: designColors.primary }]}
          onPress={() => setNewMenuOpen((value) => !value)}
          accessibilityLabel={newMenuOpen ? 'Fechar menu' : 'Nova nota'}
        >
          <Icon name={newMenuOpen ? 'close' : 'plus'} size={22} color={designColors.surface} />
        </Press>
      </View>

      <NotebookPicker
        visible={notebookPickerOpen}
        notebooks={shownNotebooks}
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

      <NoteOrderSheet
        visible={orderOpen}
        order={noteOrder}
        onChange={(next) => void setNoteOrder(next)}
        onClose={() => setOrderOpen(false)}
      />

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
  icon: 'link' | 'image' | 'mic' | 'doc';
  label: string;
  onPress: () => void;
}) {
  const colors = useDesign();
  const styles = useThemedStyles(baseStyles);
  return (
    <Press
      style={[
        styles.fabItem,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.line },
      ]}
      onPress={onPress}
      accessibilityLabel={label}
    >
      <Text style={[styles.fabItemLabel, { color: colors.text }]}>{label}</Text>
      <View style={[styles.fabItemIcon, { borderColor: colors.line }]}>
        <Icon name={icon} size={12} color={colors.text} />
      </View>
    </Press>
  );
}

/** Esqueleto da lista: o app abre antes do SQLite terminar de ler. */
function NoteListSkeleton() {
  const styles = useThemedStyles(baseStyles);

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

const baseStyles = defineStyles({
  screen: { paddingHorizontal: 0 },
  padded: { paddingHorizontal: spacing.sm },
  list: { paddingBottom: 96 },
  skeleton: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  skeletonRow: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  skeletonTitle: {
    width: '55%',
    height: 15,
    borderRadius: 4,
    backgroundColor: baseColors.surface,
  },
  skeletonSub: {
    width: '82%',
    height: 11,
    borderRadius: 4,
    backgroundColor: baseColors.surface,
    opacity: 0.7,
  },
  swipeAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeLabel: { color: baseColors.onAccent, fontSize: fontSize.xs, fontWeight: '700' },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: baseColors.warningSoft,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  alertText: { flex: 1, fontSize: designType.body.size, fontWeight: '500' },
  empty: { alignItems: 'center', gap: designSpace.s8, paddingTop: designSpace.s32 },
  emptyAction: { alignSelf: 'center', marginTop: designSpace.s4 },
  emptyTitle: {
    color: baseColors.text,
    fontSize: designType.title.size,
    fontWeight: '600',
    letterSpacing: -0.085,
  },
  fabBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fabWrap: {
    position: 'absolute',
    right: designSpace.s16,
    bottom: designSpace.s16,
    alignItems: 'flex-end',
    gap: designSpace.s8,
  },
  fabMenu: { alignItems: 'flex-end', gap: designSpace.s4 },
  fabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s6,
    backgroundColor: baseColors.surface,
    borderRadius: designRadius.control,
    paddingLeft: designSpace.s8,
    paddingRight: designSpace.s4,
    paddingVertical: designSpace.s4,
    borderWidth: 1,
    borderColor: baseColors.borderStrong,
  },
  fabItemLabel: { fontSize: designType.body.size, fontWeight: '500' },
  fabItemIcon: {
    width: 22,
    height: 22,
    borderRadius: designRadius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: designRow.touch,
    height: designRow.touch,
    borderRadius: designRow.touch / 2,
    backgroundColor: baseColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
