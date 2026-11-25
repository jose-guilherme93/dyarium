import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  buildProjectTree,
  parseProjectLog,
  pathLabel,
  type LogItem,
  type ProjectTree,
  type ProjectTreeFolderNode,
  type ProjectTreeMachineNode,
  type ProjectTreeSessionNode,
  type SessionNoteState,
} from '@/core/projetoLog';
import type { Recording } from '@/core/types';
import { back, push } from '@/services/appNavigation';
import { getRecording } from '@/services/db';
import { useLibrary } from '@/state/LibraryContext';
import {
  designControl,
  designIcon,
  designRadius,
  designRow,
  designSpace,
  designTree,
  designType,
} from '@/theme/design';
import { Guides, type GuideCell } from '@/ui/projects/Guides';
import { ItemLine } from '@/ui/projects/ItemLine';
import { ProjectMark } from '@/ui/projects/ProjectMark';
import { itensLabel, sessionName, sessoesLabel, stamp } from '@/ui/projects/format';
import { KindMeter, KIND_ORDER } from '@/ui/projects/KindMeter';
import { StateMark } from '@/ui/projects/StateMark';
import { typeStyles } from '@/ui/projects/texts';
import { useDesign } from '@/ui/useDesign';

/**
 * Superficie "Projetos" do caderno MCP (docs/projetos.md), nativa do app, no
 * sistema de interface: a arvore agrupa por maquina + caminho completo (fence
 * v2), com guias de nivel desenhadas em Views (cotovelos T/L, nunca caractere
 * de desenho de caixa). A lista "Itens" segue viva, escopada ao no selecionado.
 * Cor so significa estado; kind e rotulo mono neutro; nenhum paragrafo
 * explica a tela.
 */

type TabId = 'tree' | 'items';
type RangeId = '7' | '30' | 'all';

const RANGE_OPTIONS: { id: RangeId; label: string }[] = [
  { id: '7', label: '7 dias' },
  { id: '30', label: '30 dias' },
  { id: 'all', label: 'tudo' },
];

/** Linha achatada da arvore, com as celulas de guia ja resolvidas. */
type TreeRow =
  | { type: 'machine'; key: string; machine: ProjectTreeMachineNode }
  | { type: 'folder'; key: string; guides: GuideCell[]; folder: ProjectTreeFolderNode }
  | { type: 'session'; key: string; guides: GuideCell[]; node: ProjectTreeSessionNode; flat: boolean };

/** No selecionado na arvore; vira escopo da lista de itens. */
type Scope =
  | { kind: 'machine'; machine: string }
  | { kind: 'folder'; machine: string; path: string }
  | { kind: 'session'; id: string }
  | null;

/** Sessao do indice Itens: fence v2 (nota propria) ou v1/legado. */
interface IndexSession {
  id: string;
  name: string;
  date: string;
  time: string;
  host: string;
  items: LogItem[];
  noteId: string;
  v2: boolean;
  machine?: string;
  path?: string;
  state?: SessionNoteState;
}

/** Projeto sem diretorio (fence v1 / bloco legado), agregado pela entry. */
interface V1Project {
  project: string;
  entryId: string;
  icon: string;
  sessions: number;
  items: number;
  /** Data da sessao mais nova, para a recencia. */
  last: string;
}

function dayNumber(date: string): number {
  const parts = date.split('-').map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return Number.NaN;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 864e5;
}

function todayNumber(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5;
}

/** Recencia curta: `hoje`, `ontem`, `ha N dias`; sem trabalho quando nunca houve. */
function relativeDay(date: string | undefined): string {
  if (!date) return 'sem trabalho';
  const diff = todayNumber() - dayNumber(date);
  if (Number.isNaN(diff)) return 'sem trabalho';
  if (diff <= 0) return 'hoje';
  if (diff === 1) return 'ontem';
  return `há ${diff} dias`;
}

function folderKeyOf(machine: string, path: string): string {
  return `${machine}|${path}`;
}

/** Achata a arvore em linhas de lista, com as guias de cada no resolvidas. */
export function buildTreeRows(
  tree: ProjectTree,
  collapsedMachines: Record<string, boolean>,
  collapsedFolders: Record<string, boolean>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  tree.machines.forEach((machine) => {
    rows.push({ type: 'machine', key: `M|${machine.machine}`, machine });
    if (collapsedMachines[machine.machine]) return;

    type Entry =
      | { kind: 'folder'; folder: ProjectTreeFolderNode }
      | { kind: 'flat'; node: ProjectTreeSessionNode };
    const entries: Entry[] = [
      ...machine.folders.map((folder) => ({ kind: 'folder' as const, folder })),
      ...machine.sessions.map((node) => ({ kind: 'flat' as const, node })),
    ];
    entries.forEach((entry, at) => {
      const hasNext = at < entries.length - 1;
      if (entry.kind === 'folder') {
        const key = folderKeyOf(entry.folder.machine, entry.folder.path);
        const expanded = !collapsedFolders[key];
        rows.push({
          type: 'folder',
          key: `F|${key}`,
          guides: [expanded || hasNext ? 'T' : 'L'],
          folder: entry.folder,
        });
        if (expanded) {
          const children = entry.folder.sessions;
          children.forEach((node, si) => {
            const lastChild = si === children.length - 1;
            const ancestor: GuideCell = hasNext || !lastChild ? 'v' : 'top';
            rows.push({
              type: 'session',
              key: `S|${node.session.id}`,
              guides: [ancestor, si < children.length - 1 ? 'T' : 'L'],
              node,
              flat: false,
            });
          });
        }
      } else {
        rows.push({
          type: 'session',
          key: `S|${entry.node.session.id}`,
          guides: [hasNext ? 'T' : 'L'],
          node: entry.node,
          flat: true,
        });
      }
    });
  });
  return rows;
}

export default function ProjectsScreen() {
  const colors = useDesign();
  const params = useLocalSearchParams<{ notebook?: string }>();
  const { notebooks, recordings, ready, refresh, refreshNotebooks, pull } = useLibrary();

  // Uma unica leitura do relogio por montagem: o estado `interrupted` sai do
  // fence + updated_at e precisa ser estavel entre renders.
  const [now] = useState(() => Date.now());

  const mcpNotebook = useMemo(() => {
    const byParam = params.notebook
      ? notebooks.find((notebook) => notebook.id === params.notebook && notebook.kind === 'mcp')
      : undefined;
    return byParam ?? notebooks.find((notebook) => notebook.kind === 'mcp');
  }, [notebooks, params.notebook]);

  const notes = useMemo(
    () =>
      mcpNotebook
        ? recordings.filter((recording) => recording.notebookId === mcpNotebook.id)
        : ([] as Recording[]),
    [recordings, mcpNotebook],
  );

  // Corpos lidos do SQLite, o mesmo acesso da tela de nota; `null` e a
  // primeira leitura ainda sem resultado. Reler nao apaga o indice desenhado.
  const [bodies, setBodies] = useState<Record<string, string> | null>(null);
  const [readError, setReadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!ready || notes.length === 0) return undefined;
    let active = true;
    void (async () => {
      const read = await Promise.all(
        notes.map(async (note) => {
          try {
            const row = await getRecording(note.id);
            return { id: note.id, body: row?.text ?? '', failed: false };
          } catch {
            // Falha de leitura nao derruba a tela nem vaza detalhe.
            return { id: note.id, body: '', failed: true };
          }
        }),
      );
      if (!active) return;
      const failed = read.filter((entry) => entry.failed).length;
      setBodies(Object.fromEntries(read.map((entry) => [entry.id, entry.body])));
      setReadError(failed > 0 ? 'Falha ao ler as notas.' : '');
    })();
    return () => {
      active = false;
    };
  }, [ready, notes, reload]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      pull();
      await refresh();
      await refreshNotebooks().catch(() => undefined);
      setReload((value) => value + 1);
    } finally {
      setRefreshing(false);
    }
  }, [pull, refresh, refreshNotebooks]);

  // O mesmo corpo alimenta os dois caminhos: a arvore nasce do fence v2; a
  // lista de itens soma o indice legado (v1 e blocos humanos). Nota com fence
  // v2 valido conta uma vez so: o bloco humano dela nao entra duplicado.
  const data = useMemo(() => {
    if (!bodies) return null;
    const noteSources = notes.map((note) => ({
      id: note.id,
      title: note.title,
      body: bodies[note.id] ?? '',
      updatedAt: note.updatedAt,
      entryId: note.entryId ?? null,
    }));
    const tree = buildProjectTree({
      entries: notes.map((note) => ({ id: note.id, title: note.title })),
      notes: noteSources,
      now,
    });

    const titleByNoteId: Record<string, string> = {};
    notes.forEach((note) => {
      if (note.title) titleByNoteId[note.id] = note.title;
    });

    const sessions: IndexSession[] = tree.sessions.map((node) => ({
      id: node.session.id,
      name: sessionName(titleByNoteId[node.noteId], node.session.session),
      date: node.session.date,
      time: node.session.time,
      host: node.machine,
      items: node.session.items,
      noteId: node.noteId,
      v2: true,
      machine: node.machine,
      path: node.path,
      state: node.session.state,
    }));
    const v2Notes = new Set(tree.sessions.map((node) => node.noteId));

    // Projetos sem diretorio: v1 e blocos legados, agregados pela entry,
    // excluidos quando a nota ja entrou na arvore v2 (mesma regra do web,
    // useProjectsIndex.ts: v1Projects).
    const v1Projects: V1Project[] = [];
    notes.forEach((note) => {
      if (v2Notes.has(note.id) || !note.title) return;
      const rows: IndexSession[] = parseProjectLog(bodies[note.id] ?? '', note.title).map(
        (legacy) => ({
          id: legacy.sessionId,
          name: legacy.project,
          date: legacy.date,
          time: legacy.time,
          host: legacy.host,
          items: legacy.items,
          noteId: note.id,
          v2: false,
        }),
      );
      if (rows.length === 0) return;
      sessions.push(...rows);
      v1Projects.push({
        project: note.title,
        entryId: note.id,
        icon: note.icon ?? '',
        sessions: rows.length,
        items: rows.reduce((sum, row) => sum + row.items.length, 0),
        last: rows[0].date,
      });
    });

    const kinds: string[] = [];
    KIND_ORDER.forEach((kind) => {
      if (sessions.some((row) => row.items.some((item) => item.kind === kind))) kinds.push(kind);
    });
    sessions.forEach((row) => {
      row.items.forEach((item) => {
        if (item.kind && !kinds.includes(item.kind)) kinds.push(item.kind);
      });
    });

    return { tree, titleByNoteId, sessions, kinds, v1Projects };
  }, [bodies, notes, now]);

  const [tab, setTab] = useState<TabId>('tree');
  const [collapsedMachines, setCollapsedMachines] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  // O grupo "sem pasta" recolhe sozinho quando carrega mais de um projeto.
  const [collapsedNoPasta, setCollapsedNoPasta] = useState<boolean | null>(null);
  const [scope, setScope] = useState<Scope>(null);
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<RangeId>('all');

  const index = useMemo(
    () =>
      data ?? {
        tree: { machines: [], sessions: [], count: 0 } as unknown as ProjectTree,
        titleByNoteId: {} as Record<string, string>,
        sessions: [] as IndexSession[],
        kinds: [] as string[],
        v1Projects: [] as V1Project[],
      },
    [data],
  );

  const treeRows = useMemo(
    () => buildTreeRows(index.tree, collapsedMachines, collapsedFolders),
    [index.tree, collapsedMachines, collapsedFolders],
  );

  // Grupo dos projetos sem diretorio (v1/legado), sempre acima das maquinas.
  const noPasta = index.v1Projects;
  const noPastaOpen = collapsedNoPasta ?? noPasta.length <= 1;

  const noPastaHeader =
    noPasta.length > 0 ? (
      <View style={[styles.v1Block, { borderBottomColor: colors.line }]}>
        <Pressable
          testID="no-pasta-toggle"
          style={styles.v1Head}
          onPress={() => setCollapsedNoPasta(!noPastaOpen)}
          accessibilityRole="button"
          accessibilityState={{ expanded: noPastaOpen }}
          accessibilityLabel={`Sem pasta, ${noPasta.length} ${noPasta.length === 1 ? 'projeto' : 'projetos'}`}
        >
          <Ionicons
            name={noPastaOpen ? 'chevron-down' : 'chevron-forward'}
            size={designIcon.sm}
            color={colors.textMuted}
          />
          <Text style={[typeStyles.label, { color: colors.textMuted }]}>
            Sem pasta
          </Text>
          <View style={styles.push} />
          <Text style={[typeStyles.mono, { color: colors.textMuted }]}>{noPasta.length}</Text>
        </Pressable>
        {noPastaOpen
          ? noPasta.map((project) => (
              <Pressable
                key={project.entryId}
                testID={`v1-row-${project.entryId}`}
                style={[styles.sessRow, { borderBottomColor: colors.line }]}
                onPress={() => openNote(project.entryId)}
                accessibilityRole="button"
                accessibilityLabel={`${project.project}, ${relativeDay(project.last)}, ${itensLabel(project.items)}`}
              >
                <ProjectMark icon={project.icon} project={project.project} />
                <View style={styles.sessMain}>
                  <Text style={[typeStyles.body, styles.strong, { color: colors.text }]} numberOfLines={1}>
                    {project.project}
                  </Text>
                  <View style={styles.line2}>
                    <Text style={[typeStyles.mono, styles.shrink, { color: colors.textMuted }]} numberOfLines={1}>
                      {`${relativeDay(project.last)} · ${itensLabel(project.items)}`}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))
          : null}
      </View>
    ) : null;

  const inScope = useCallback(
    (row: IndexSession): boolean => {
      if (!scope) return true;
      if (!row.v2) return false;
      if (scope.kind === 'machine') return row.machine === scope.machine;
      if (scope.kind === 'folder') return row.machine === scope.machine && row.path === scope.path;
      return row.id === scope.id;
    },
    [scope],
  );

  const limit = range === 'all' ? 0 : range === '7' ? 6 : 29;
  const keepItem = useCallback(
    (item: LogItem): boolean => {
      if (kindFilter.size > 0 && !kindFilter.has(item.kind)) return false;
      if (limit > 0) {
        const day = dayNumber(item.date);
        if (Number.isNaN(day) || day < todayNumber() - limit) return false;
      }
      return true;
    },
    [kindFilter, limit],
  );

  const scopedSessions = useMemo(() => {
    const out: (IndexSession & { shown: LogItem[] })[] = [];
    index.sessions.forEach((row) => {
      if (!inScope(row)) return;
      const shown = row.items.filter(keepItem);
      if (shown.length > 0) out.push({ ...row, shown });
    });
    return out;
  }, [index.sessions, inScope, keepItem]);

  const filteredCount = scopedSessions.reduce((sum, row) => sum + row.shown.length, 0);
  const filterActive = kindFilter.size > 0 || range !== 'all' || scope !== null;

  const openSessionScreen = useCallback(
    (noteId: string) => {
      if (!noteId) return;
      push({
        pathname: '/projects/session',
        params: { notebook: mcpNotebook?.id ?? '', note: noteId },
      });
    },
    [mcpNotebook],
  );

  const openFolderScreen = useCallback(
    (machine: string, path: string) => {
      push({
        pathname: '/projects/folder',
        params: { notebook: mcpNotebook?.id ?? '', machine, path },
      });
    },
    [mcpNotebook],
  );

  const openNote = useCallback((noteId: string) => {
    if (!noteId) return;
    push({ pathname: '/note/[id]', params: { id: noteId } });
  }, []);

  const scopeLabel = useMemo(() => {
    if (!scope) return '';
    if (scope.kind === 'machine') return scope.machine;
    if (scope.kind === 'folder') return pathLabel(scope.path);
    const row = index.sessions.find((session) => session.id === scope.id);
    return row ? row.name : '';
  }, [scope, index.sessions]);

  const header = (
    <View style={styles.header}>
      <Pressable
        testID="back-button"
        onPress={() => back()}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
      >
        <Ionicons name="chevron-back" size={designIcon.lg} color={colors.text} />
      </Pressable>
      <Text style={[typeStyles.title, styles.headerTitle]} numberOfLines={1}>
        {mcpNotebook?.name ?? 'Projetos'}
      </Text>
      <View style={styles.iconButton} />
    </View>
  );

  const tabs = (
    <View style={styles.tabs} accessibilityRole="tablist">
      <Pressable
        testID="tab-tree"
        style={[
          styles.tab,
          {
            borderColor: colors.line,
            backgroundColor: tab === 'tree' ? colors.surfaceRaised : 'transparent',
          },
        ]}
        onPress={() => setTab('tree')}
        accessibilityRole="tab"
        accessibilityState={{ selected: tab === 'tree' }}
      >
        <Text style={[typeStyles.label, { color: tab === 'tree' ? colors.text : colors.textMuted }]}>
          Árvore
        </Text>
      </Pressable>
      <Pressable
        testID="tab-items"
        style={[
          styles.tab,
          {
            borderColor: colors.line,
            backgroundColor: tab === 'items' ? colors.surfaceRaised : 'transparent',
          },
        ]}
        onPress={() => setTab('items')}
        accessibilityRole="tab"
        accessibilityState={{ selected: tab === 'items' }}
      >
        <Text style={[typeStyles.label, { color: tab === 'items' ? colors.text : colors.textMuted }]}>
          Itens
        </Text>
        <Text style={[typeStyles.mono, { color: colors.textMuted }]}>{filteredCount}</Text>
      </Pressable>
    </View>
  );

  const errorBar = readError ? (
    <View style={[styles.errorBar, { backgroundColor: colors.surfaceRaised }]}>
      <Ionicons name="alert-circle" size={designIcon.md} color={colors.warning} />
      <Text style={[typeStyles.body, { color: colors.text }]} numberOfLines={1}>
        {readError}
      </Text>
      <Text style={[typeStyles.mono, { color: colors.textMuted }]}>{notes.length}</Text>
    </View>
  ) : null;

  const body = (content: ReactNode) => (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      {header}
      {tabs}
      {errorBar}
      {content}
    </SafeAreaView>
  );

  if (!ready || (notes.length > 0 && bodies === null)) {
    return (
      <View style={[styles.shell, { backgroundColor: colors.surface }]}>
        {body(
          <View
            testID="projects-loading"
            pointerEvents="none"
            accessibilityLabel="Carregando"
            style={styles.skeleton}
          >
            {[0, 1, 2, 3, 4].map((row) => (
              <View key={row} style={styles.skeletonRow}>
                <View style={[styles.skeletonDot, { backgroundColor: colors.surfaceAlt }]} />
                <View style={[styles.skeletonLine, { backgroundColor: colors.surfaceAlt }]} />
              </View>
            ))}
          </View>,
        )}
      </View>
    );
  }

  const emptyBlock = (title: string) => (
    <View style={styles.empty}>
      <Ionicons name="albums-outline" size={designIcon.lg} color={colors.textMuted} />
      <Text style={[typeStyles.body, { color: colors.textMuted }]}>{title}</Text>
    </View>
  );

  if (!mcpNotebook) {
    return (
      <View style={[styles.shell, { backgroundColor: colors.surface }]}>
        {body(emptyBlock('Sem caderno'))}
      </View>
    );
  }

  if (notes.length === 0) {
    return (
      <View style={[styles.shell, { backgroundColor: colors.surface }]}>
        {body(emptyBlock('Caderno vazio'))}
      </View>
    );
  }

  if (tab === 'items') {
    return (
      <View style={[styles.shell, { backgroundColor: colors.surface }]}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
          {header}
          {tabs}
          {errorBar}
          <View style={[styles.toolbar, { borderBottomColor: colors.line }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.toolbarScroll}
            >
              {scope ? (
                <Pressable
                  testID="scope-chip"
                  style={[
                    styles.chip,
                    { borderColor: colors.primary, backgroundColor: colors.surfaceRaised },
                  ]}
                  onPress={() => setScope(null)}
                  accessibilityRole="button"
                  accessibilityLabel={`Escopo ${scopeLabel}: limpar`}
                >
                  <Ionicons name="close" size={designIcon.sm} color={colors.text} />
                  <Text style={[typeStyles.label, { color: colors.text }]} numberOfLines={1}>
                    {scopeLabel}
                  </Text>
                </Pressable>
              ) : null}
              {index.kinds.map((kind) => (
                <Pressable
                  key={kind}
                  testID={`chip-kind-${kind}`}
                  style={[
                    styles.chip,
                    {
                      borderColor: kindFilter.has(kind) ? colors.primary : colors.line,
                      backgroundColor: kindFilter.has(kind) ? colors.surfaceRaised : 'transparent',
                    },
                  ]}
                  onPress={() => {
                    const next = new Set(kindFilter);
                    if (next.has(kind)) next.delete(kind);
                    else next.add(kind);
                    setKindFilter(next);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: kindFilter.has(kind) }}
                  accessibilityLabel={`Filtrar ${kind}`}
                >
                  <Text
                    style={[
                      typeStyles.mono,
                      { color: kindFilter.has(kind) ? colors.text : colors.textMuted },
                    ]}
                  >
                    {kind}
                  </Text>
                </Pressable>
              ))}
              <View style={[styles.divider, { backgroundColor: colors.line }]} />
              <View style={[styles.seg, { borderColor: colors.line }]}>
                {RANGE_OPTIONS.map((option) => (
                  <Pressable
                    key={option.id}
                    testID={`range-${option.id}`}
                    style={[
                      styles.segBtn,
                      range === option.id ? { backgroundColor: colors.surfaceRaised } : null,
                    ]}
                    onPress={() => setRange(option.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: range === option.id }}
                  >
                    <Text
                      style={[
                        typeStyles.label,
                        { color: range === option.id ? colors.text : colors.textMuted },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
          <FlatList
            testID="items-list"
            data={scopedSessions}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
                tintColor={colors.textMuted}
                progressBackgroundColor={colors.surface}
              />
            }
            renderItem={({ item }) => (
              <View style={[styles.card, { borderBottomColor: colors.line }]}>
                <Pressable
                  testID={`session-head-${item.id}`}
                  style={styles.cardHead}
                  onPress={() => (item.v2 ? openSessionScreen(item.noteId) : openNote(item.noteId))}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${stamp(item.date, item.time)}, ${item.host}`}
                >
                  <View style={styles.line1}>
                    <Text
                      style={[typeStyles.body, styles.strong, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {item.v2 && item.state ? <StateMark state={item.state} /> : null}
                  </View>
                  <View style={styles.line2}>
                    <Text
                      style={[typeStyles.mono, styles.shrink, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {`${stamp(item.date, item.time)} · ${item.host}`}
                    </Text>
                    <View style={styles.push} />
                    <Text style={[typeStyles.mono, { color: colors.textMuted }]}>
                      {itensLabel(item.shown.length)}
                    </Text>
                  </View>
                </Pressable>
                {item.shown.map((entry, at) => (
                  <ItemLine
                    key={`${entry.title}:${at}`}
                    item={entry}
                    onOpen={() => (item.v2 ? openSessionScreen(item.noteId) : openNote(item.noteId))}
                  />
                ))}
              </View>
            )}
            ListEmptyComponent={emptyBlock(filterActive ? 'Nada no filtro' : 'Sem itens')}
          />
          <View style={[styles.foot, { borderTopColor: colors.line }]}>
            <Text testID="items-count" style={[typeStyles.mono, { color: colors.textMuted }]}>
              {itensLabel(filteredCount)}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.shell, { backgroundColor: colors.surface }]}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        {header}
        {tabs}
        {errorBar}
        <FlatList
          testID="projects-tree"
          data={treeRows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.textMuted}
              progressBackgroundColor={colors.surface}
            />
          }
          renderItem={({ item }) => {
            if (item.type === 'machine') {
              const expanded = !collapsedMachines[item.machine.machine];
              const selected =
                scope?.kind === 'machine' && scope.machine === item.machine.machine;
              return (
                <Pressable
                  testID={`machine-row-${item.machine.machine}`}
                  style={[
                    styles.denseRow,
                    { borderBottomColor: colors.line },
                    selected && { backgroundColor: colors.surfaceAlt },
                  ]}
                  onPress={() => {
                    setCollapsedMachines((current) => ({
                      ...current,
                      [item.machine.machine]: !current[item.machine.machine],
                    }));
                    setScope({ kind: 'machine', machine: item.machine.machine });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded, selected }}
                  accessibilityLabel={`${item.machine.machine}, ${sessoesLabel(item.machine.count)}`}
                  hitSlop={designSpace.s6}
                >
                  <Ionicons
                    name={expanded ? 'chevron-down' : 'chevron-forward'}
                    size={designIcon.sm}
                    color={colors.textMuted}
                  />
                  <Ionicons name="hardware-chip-outline" size={designIcon.md} color={colors.textMuted} />
                  <Text
                    style={[typeStyles.body, styles.strong, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {item.machine.machine}
                  </Text>
                  <View style={styles.push} />
                  <Text style={[typeStyles.mono, { color: colors.textMuted }]}>
                    {item.machine.count}
                  </Text>
                </Pressable>
              );
            }
            if (item.type === 'folder') {
              const key = folderKeyOf(item.folder.machine, item.folder.path);
              const expanded = !collapsedFolders[key];
              const selected =
                scope?.kind === 'folder' &&
                scope.machine === item.folder.machine &&
                scope.path === item.folder.path;
              return (
                <Pressable
                  testID={`folder-row-${key}`}
                  style={[
                    styles.denseRow,
                    { borderBottomColor: colors.line },
                    selected && { backgroundColor: colors.surfaceAlt },
                  ]}
                  onPress={() => {
                    setScope({ kind: 'folder', machine: item.folder.machine, path: item.folder.path });
                    openFolderScreen(item.folder.machine, item.folder.path);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.folder.label}, ${sessoesLabel(item.folder.count)}`}
                  hitSlop={designSpace.s6}
                >
                  <Guides cells={item.guides} />
                  <Pressable
                    testID={`folder-toggle-${key}`}
                    style={styles.chevButton}
                    onPress={() => {
                      setCollapsedFolders((current) => ({ ...current, [key]: !current[key] }));
                      setScope({ kind: 'folder', machine: item.folder.machine, path: item.folder.path });
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={expanded ? 'Recolher' : 'Expandir'}
                    hitSlop={designSpace.s8}
                  >
                    <Ionicons
                      name={expanded ? 'chevron-down' : 'chevron-forward'}
                      size={designIcon.sm}
                      color={colors.textMuted}
                    />
                  </Pressable>
                  <Ionicons name="folder-outline" size={designIcon.md} color={colors.textMuted} />
                  <Text
                    style={[typeStyles.mono, styles.shrink, { color: selected ? colors.text : colors.textMuted }]}
                    numberOfLines={1}
                    accessibilityLabel={item.folder.path}
                  >
                    {item.folder.label}
                  </Text>
                  <View style={styles.push} />
                  <Text style={[typeStyles.mono, { color: colors.textMuted }]}>
                    {item.folder.count}
                  </Text>
                </Pressable>
              );
            }
            const node = item.node;
            const selected = scope?.kind === 'session' && scope.id === node.session.id;
            const name = sessionName(index.titleByNoteId[node.noteId], node.session.session);
            return (
              <Pressable
                testID={`session-row-${node.session.id}`}
                style={[
                  styles.sessRow,
                  { borderBottomColor: colors.line },
                  selected && { backgroundColor: colors.surfaceAlt },
                ]}
                onPress={() => {
                  setScope({ kind: 'session', id: node.session.id });
                  openSessionScreen(node.noteId);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${stamp(node.session.date, node.session.time)}, ${itensLabel(node.session.items.length)}`}
              >
                <Guides cells={item.guides} />
                <Ionicons name="document-text-outline" size={designIcon.md} color={colors.textMuted} />
                <View style={styles.sessMain}>
                  <View style={styles.line1}>
                    <Text
                      style={[typeStyles.body, styles.strong, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                    <StateMark state={node.session.state} />
                  </View>
                  <View style={styles.line2}>
                    {item.flat ? (
                      <Text
                        testID={`flat-path-${node.session.id}`}
                        style={[typeStyles.mono, styles.shrink, { color: colors.textMuted }]}
                        numberOfLines={1}
                        accessibilityLabel={node.path}
                      >
                        {pathLabel(node.path)}
                      </Text>
                    ) : null}
                    <Text
                      style={[typeStyles.mono, styles.shrink, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {`${stamp(node.session.date, node.session.time)} · ${itensLabel(node.session.items.length)}`}
                    </Text>
                    <View style={styles.push} />
                    <KindMeter items={node.session.items} />
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListHeaderComponent={noPastaHeader}
          ListEmptyComponent={noPasta.length > 0 ? null : emptyBlock('Sem sessões')}
        />
        <View style={[styles.foot, { borderTopColor: colors.line }]}>
          <Text style={[typeStyles.mono, { color: colors.textMuted }]}>
            {`${sessoesLabel(index.tree.count)} · ${index.tree.machines.length} ${index.tree.machines.length === 1 ? 'máquina' : 'máquinas'}${
              noPasta.length > 0
                ? ` · ${noPasta.length} ${noPasta.length === 1 ? 'projeto' : 'projetos'}`
                : ''
            }`}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpace.s8,
    paddingVertical: designSpace.s6,
    gap: designSpace.s4,
  },
  iconButton: {
    width: designRow.touch,
    height: designRow.touch,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: -designSpace.s8,
  },
  headerTitle: { flex: 1 },

  tabs: {
    flexDirection: 'row',
    gap: designSpace.s4,
    paddingHorizontal: designSpace.s16,
    paddingBottom: designSpace.s8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s4,
    height: designControl.md,
    paddingHorizontal: designControl.padMd,
    borderRadius: designRadius.control,
    borderWidth: designTree.guide,
  },

  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s6,
    marginHorizontal: designSpace.s16,
    marginBottom: designSpace.s6,
    borderRadius: designRadius.control,
    paddingHorizontal: designSpace.s8,
    height: designControl.md,
  },

  toolbar: {
    borderBottomWidth: designTree.guide,
  },
  toolbarScroll: {
    alignItems: 'center',
    gap: designSpace.s4,
    paddingHorizontal: designSpace.s16,
    minHeight: designRow.dense,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s4,
    height: designControl.md,
    paddingHorizontal: designControl.padMd,
    borderRadius: designRadius.control,
    borderWidth: designTree.guide,
    maxWidth: designRow.touch * 4,
  },
  divider: { width: designTree.guide, height: designControl.md },
  seg: {
    flexDirection: 'row',
    borderRadius: designRadius.control,
    borderWidth: designTree.guide,
    overflow: 'hidden',
  },
  segBtn: {
    height: designControl.sm,
    paddingHorizontal: designControl.padMd,
    alignItems: 'center',
    justifyContent: 'center',
  },

  list: { paddingHorizontal: designSpace.s16, paddingBottom: designSpace.s16 },

  denseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s4,
    minHeight: designRow.dense,
    paddingVertical: designSpace.s6,
    borderBottomWidth: designTree.guide,
  },
  chevButton: {
    width: designControl.md,
    height: designControl.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: -designSpace.s4,
  },

  sessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s6,
    minHeight: designRow.touch,
    paddingVertical: designSpace.s6,
    borderBottomWidth: designTree.guide,
  },

  v1Block: {
    paddingBottom: designSpace.s6,
    marginBottom: designSpace.s6,
    borderBottomWidth: designTree.guide,
    gap: designSpace.s2,
  },
  v1Head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s4,
    minHeight: designRow.dense,
    paddingVertical: designSpace.s6,
  },
  sessMain: { flex: 1, gap: designSpace.s2 },
  line1: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s6 },
  line2: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s4 },
  strong: { fontFamily: typeStyles.title.fontFamily },
  shrink: { flexShrink: 1 },

  card: {
    paddingBottom: designSpace.s8,
    marginBottom: designSpace.s8,
    borderBottomWidth: designTree.guide,
  },
  cardHead: { gap: designSpace.s2 },

  push: { flex: 1 },

  foot: {
    height: designRow.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: designTree.guide,
  },

  empty: { alignItems: 'center', gap: designSpace.s12, paddingTop: designRow.touch * 3 },

  skeleton: { paddingHorizontal: designSpace.s16, paddingTop: designSpace.s12, gap: designSpace.s12 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s8 },
  skeletonDot: { width: designIcon.md, height: designIcon.md, borderRadius: designRadius.control },
  skeletonLine: {
    height: Math.round(designType.body.size * designType.body.lineHeight),
    flex: 1,
  },
});
