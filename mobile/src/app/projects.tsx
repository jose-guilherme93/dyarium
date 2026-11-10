import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import {
  parseProjectLogs,
  itemKindCounts,
  type LogItem,
  type LogSession,
} from '@/core/projetoLog';
import { fontFamilyNative } from '@/core/typography';
import type { Recording } from '@/core/types';
import { back, push } from '@/services/appNavigation';
import { getRecording } from '@/services/db';
import { useLibrary } from '@/state/LibraryContext';
import {
  baseColors,
  fontSize,
  radius,
  spacing,
  type ThemeColors,
} from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

/**
 * Superficie "Projetos" do caderno MCP (docs/projetos.md), nativa do app.
 * O corpo das notas do caderno e lido pelo modulo projetoLog (mesmo acesso da
 * tela de nota) e vira duas abas: Itens (cartoes por sessao, unica variante em
 * tela estreita) e Projetos (uma linha por projeto, expansivel). O que se ve
 * aqui e a mesma hierarquia do dashboard, com a linguagem visual do app.
 */

type TabId = 'items' | 'projects';
type RangeId = '7' | '30' | 'all';

/** Item da aba Itens: linha do indice amarrada a nota (entry) do caderno. */
interface ItemRow extends LogItem {
  entryId: string | null;
}

/** Sessao com a nota dona dos itens (para abrir o leitor). */
interface SessionRow {
  session: LogSession;
  entryId: string | null;
}

const KIND_ORDER = ['feat', 'fix', 'perf', 'test', 'docs', 'chore'];
const RANGE_OPTIONS: { id: RangeId; label: string }[] = [
  { id: '7', label: '7 dias' },
  { id: '30', label: '30 dias' },
  { id: 'all', label: 'tudo' },
];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Dia como numero, para comparar datas sem fuso. */
function dayNumber(date: string): number {
  const parts = date.split('-').map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return Number.NaN;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 864e5;
}

function todayNumber(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5;
}

/** "9 nov" como no prototipo; a entrada vem como AAAA-MM-DD. */
function shortDate(date: string): string {
  const day = dayNumber(date);
  if (Number.isNaN(day)) return date;
  const d = new Date(day * 864e5);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "hoje", "ontem" ou "ha N dias"; sem trabalho quando nunca houve. */
function relativeDay(date: string | null): string {
  if (!date) return 'sem trabalho';
  const diff = todayNumber() - dayNumber(date);
  if (diff <= 0) return 'hoje';
  if (diff === 1) return 'ontem';
  return `há ${diff} dias`;
}

function itensLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'itens'}`;
}

function projetosLabel(count: number): string {
  return `${count} ${count === 1 ? 'projeto' : 'projetos'}`;
}

/** Matiz por kind, dessaturada e vinda do tema (feat verde, fix tijolo...). */
function kindColor(colors: ThemeColors, kind: string): string {
  switch (kind) {
    case 'feat':
      return colors.success;
    case 'fix':
      return colors.danger;
    case 'perf':
      return colors.info;
    case 'test':
      return colors.warning;
    default:
      return colors.textSecondary;
  }
}

function mixColor(foreground: string, background: string, amount: number): string {
  const parse = (value: string): [number, number, number] => {
    const trimmed = value.trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
    if (hex) {
      const raw = hex[1];
      const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
      return [
        Number.parseInt(full.slice(0, 2), 16),
        Number.parseInt(full.slice(2, 4), 16),
        Number.parseInt(full.slice(4, 6), 16),
      ];
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
    if (rgb) {
      return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }
    return [0, 0, 0];
  };
  const [fr, fg, fb] = parse(foreground);
  const [br, bg, bb] = parse(background);
  const mix = (channel: number, base: number) =>
    Math.round(channel * amount + base * (1 - amount));
  return `rgb(${mix(fr, br)}, ${mix(fg, bg)}, ${mix(fb, bb)})`;
}

function KindBadge({ kind }: { kind: string }) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <View style={styles.kindSlot}>
      <View
        style={[
          styles.kindBadge,
          { backgroundColor: mixColor(kindColor(colors, kind), colors.bg, 0.15) },
        ]}
      >
        <Text style={[styles.kindText, { color: kindColor(colors, kind) }]} numberOfLines={1}>
          {kind}
        </Text>
      </View>
    </View>
  );
}

/** Emoji da entry quando houver; sem ele, a letra inicial do nome. */
function ProjectMark({
  icon,
  project,
  size = 'md',
}: {
  icon?: string;
  project: string;
  size?: 'sm' | 'md';
}) {
  const styles = useThemedStyles(baseStyles);
  // A letra de reserva vem da fonte do app; o emoji da entry (quando o registro
  // passar a traz-lo) desenha com a fonte de emoji do sistema.
  const text = icon || (project.charAt(0) ? project.charAt(0).toUpperCase() : '?');
  const glyph = Boolean(icon);

  return (
    <View style={[styles.mark, size === 'sm' ? styles.markSm : null]} accessibilityElementsHidden>
      <Text style={glyph ? styles.markEmoji : styles.markLetter} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** Uma linha de item: badge de kind, titulo e commit mono. */
function ItemLine({
  item,
  onPress,
}: {
  item: ItemRow;
  onPress: (entryId: string | null) => void;
}) {
  const styles = useThemedStyles(baseStyles);

  return (
    <Press
      style={styles.itemRow}
      onPress={() => onPress(item.entryId)}
      accessibilityRole="button"
      accessibilityLabel={`${item.kind} ${item.title}, ${item.project}`}
      hitSlop={4}
    >
      <KindBadge kind={item.kind} />
      <Text style={styles.itemTitle} numberOfLines={1}>
        {item.title}
      </Text>
      {item.commit ? (
        <Text style={styles.commitText} numberOfLines={1}>
          {item.commit}
        </Text>
      ) : (
        <View style={styles.commitSpacer} />
      )}
    </Press>
  );
}

export default function ProjectsScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ notebook?: string }>();

  const { notebooks, recordings, ready, refresh, refreshNotebooks, pull } = useLibrary();

  // O caderno MCP no aparelho e uma nota por projeto: o titulo da nota e o nome
  // do projeto e o corpo e o log com os blocos de sessao (fence ou legado).
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

  // Corpos lidos do SQLite, o mesmo acesso da tela de nota; `null` = primeira
  // leitura ainda sem resultado (skeleton). Reler em segundo plano nao apaga o
  // indice ja desenhado.
  const [bodies, setBodies] = useState<Record<string, string> | null>(null);
  const [readError, setReadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!ready) return undefined;
    if (notes.length === 0) return undefined;
    let active = true;
    void (async () => {
      const read = await Promise.all(
        notes.map(async (note) => {
          try {
            const row = await getRecording(note.id);
            return { id: note.id, body: row?.text ?? '', failed: false };
          } catch {
            // Falha de leitura nao pode derrubar a tela nem vazar detalhe.
            return { id: note.id, body: '', failed: true };
          }
        }),
      );
      if (!active) return;
      const failed = read.filter((entry) => entry.failed).length;
      setBodies(Object.fromEntries(read.map((entry) => [entry.id, entry.body])));
      setReadError(failed > 0 ? 'Falha ao ler as notas do caderno.' : '');
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

  const index = useMemo(() => {
    if (!bodies) return null;
    const projectByNoteId: Record<string, string> = {};
    const entryByProject: Record<string, string> = {};
    notes.forEach((note) => {
      if (!note.title) return;
      projectByNoteId[note.id] = note.title;
      if (entryByProject[note.title] === undefined) entryByProject[note.title] = note.id;
    });
    const parsed = parseProjectLogs(
      notes.map((note) => ({ id: note.id, body: bodies[note.id] ?? '' })),
      projectByNoteId,
    );
    const sessionRows: SessionRow[] = parsed.map((session) => ({
      session,
      entryId: entryByProject[session.project] ?? null,
    }));
    const rows: ItemRow[] = [];
    sessionRows.forEach((row) => {
      row.session.items.forEach((item) => {
        rows.push({ ...item, entryId: row.entryId });
      });
    });
    const kinds = [...KIND_ORDER];
    const extra = new Set<string>();
    rows.forEach((row) => {
      if (row.kind && !KIND_ORDER.includes(row.kind) && !extra.has(row.kind)) {
        extra.add(row.kind);
        kinds.push(row.kind);
      }
    });
    return { rows, sessions: sessionRows, kinds };
  }, [bodies, notes]);

  const [tab, setTab] = useState<TabId>('items');
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<RangeId>('all');
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});

  const data = index ?? { rows: [] as ItemRow[], sessions: [] as SessionRow[], kinds: [] as string[] };

  // Vigencia do periodo igual ao dashboard: 7 dias = os ultimos 6 + hoje.
  const limit = range === 'all' ? 0 : range === '7' ? 6 : 29;
  const keep = useCallback(
    (row: LogItem): boolean => {
      if (projectFilter.size > 0 && !(row.project && projectFilter.has(row.project))) return false;
      if (kindFilter.size > 0 && !kindFilter.has(row.kind)) return false;
      if (limit > 0) {
        const day = dayNumber(row.date);
        if (Number.isNaN(day) || day < todayNumber() - limit) return false;
      }
      return true;
    },
    [projectFilter, kindFilter, limit],
  );

  const filtered = useMemo(() => data.rows.filter(keep), [data.rows, keep]);
  const filteredSessions = useMemo(
    () =>
      data.sessions
        .map((row) => ({ ...row, items: row.session.items.filter(keep) }))
        .filter((row) => row.items.length > 0),
    [data.sessions, keep],
  );

  const projects = useMemo(
    () =>
      notes
        .filter((note) => Boolean(note.title))
        .map((note) => ({
          project: note.title,
          entryId: note.id,
          // O pull grava o icone da entry no banco local; sem ele, a letra
          // inicial do projeto faz o papel.
          icon: note.icon,
          sessions: data.sessions.filter((row) => row.session.project === note.title),
        })),
    [notes, data.sessions],
  );

  const openEntry = useCallback((entryId: string | null) => {
    if (!entryId) return;
    push({ pathname: '/note/[id]', params: { id: entryId } });
  }, []);

  const toggleSet = (value: string, current: Set<string>, apply: (next: Set<string>) => void) => {
    const next = new Set(current);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    apply(next);
  };

  const header = (
    <View style={styles.header}>
      <Press onPress={() => back()} style={styles.iconButton} accessibilityLabel="Voltar">
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Press>
      <View style={styles.headerText}>
        <Text style={styles.title} numberOfLines={1}>
          {mcpNotebook?.name ?? 'Projetos'}
        </Text>
      </View>
      <View style={styles.iconButton} />
    </View>
  );

  const tabs = (
    <View style={styles.tabs} accessibilityRole="tablist">
      <Press
        testID="tab-items"
        style={[styles.tab, tab === 'items' ? styles.tabOn : null]}
        onPress={() => setTab('items')}
        accessibilityRole="button"
        accessibilityState={{ selected: tab === 'items' }}
      >
        <Text style={[styles.tabText, tab === 'items' ? styles.tabTextOn : null]}>Itens</Text>
        <Text style={styles.tabCount}>{filtered.length}</Text>
      </Press>
      <Press
        testID="tab-projects"
        style={[styles.tab, tab === 'projects' ? styles.tabOn : null]}
        onPress={() => setTab('projects')}
        accessibilityRole="button"
        accessibilityState={{ selected: tab === 'projects' }}
      >
        <Text style={[styles.tabText, tab === 'projects' ? styles.tabTextOn : null]}>Projetos</Text>
      </Press>
    </View>
  );

  const emptyBlock = (title: string, note: string) => (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="albums-outline" size={28} color={colors.textTertiary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{note}</Text>
    </View>
  );

  const filterActive = projectFilter.size > 0 || kindFilter.size > 0 || range !== 'all';
  const itemsEmpty =
    data.rows.length > 0 && filterActive
      ? emptyBlock('Nada com esse filtro', 'Ajuste os chips ou o período.')
      : emptyBlock('Sem sessões', 'As notas do caderno ainda não têm blocos de projeto.');

  if (!ready || (notes.length > 0 && bodies === null)) {
    return (
      <Screen style={styles.screen}>
        {header}
        {tabs}
        <ProjectsSkeleton />
      </Screen>
    );
  }

  if (!mcpNotebook) {
    return (
      <Screen style={styles.screen}>
        {header}
        {tabs}
        {emptyBlock('Sem caderno de projetos', 'O caderno Projetos aparece quando o servidor MCP é configurado.')}
      </Screen>
    );
  }

  if (notes.length === 0) {
    return (
      <Screen style={styles.screen}>
        {header}
        {tabs}
        {emptyBlock('Caderno vazio', 'As notas de projeto chegam aqui com a sincronização.')}
      </Screen>
    );
  }

  if (tab === 'projects') {
    return (
      <Screen style={styles.screen}>
        {header}
        {tabs}
        {readError ? (
          <View style={styles.errorBar}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{readError}</Text>
          </View>
        ) : null}
        <FlatList
          testID="projects-list"
          data={projects}
          keyExtractor={(item) => item.entryId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.textSecondary} />
          }
          renderItem={({ item }) => {
            // Janela de 35 dias como no dashboard: a linha mostra o trabalho
            // recente; sessoes mais velhas ficam fora.
            const recentSessions = item.sessions.filter((row) =>
              row.session.items.some((entry) => {
                const day = dayNumber(entry.date);
                return !Number.isNaN(day) && day >= todayNumber() - 34;
              }),
            );
            const recentItems = recentSessions.flatMap((row) => row.session.items);
            const last = recentSessions[0]?.session.date ?? null;
            const counts = itemKindCounts(recentItems);
            const dotColor =
              last === null
                ? colors.textTertiary
                : todayNumber() - dayNumber(last) <= 1
                  ? colors.success
                  : todayNumber() - dayNumber(last) <= 8
                    ? colors.warning
                    : colors.textTertiary;
            const open = Boolean(openProjects[item.entryId]);
            return (
              <View style={styles.project}>
                <Press
                  testID={`project-row-${item.entryId}`}
                  style={[styles.projectRow, open ? styles.projectRowOn : null]}
                  onPress={() =>
                    setOpenProjects((current) => ({ ...current, [item.entryId]: !open }))
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${item.project}, ${relativeDay(last)}, ${itensLabel(recentItems.length)}`}
                >
                  <ProjectMark icon={item.icon} project={item.project} />
                  <View style={styles.projectName}>
                    <Text style={styles.projectTitle} numberOfLines={1}>
                      {item.project}
                    </Text>
                    <Text style={styles.projectSub} numberOfLines={1}>
                      {relativeDay(last)} · {itensLabel(recentItems.length)}
                    </Text>
                  </View>
                  <View style={[styles.barTrack, { backgroundColor: colors.bg, gap: 1 }]}>
                    {recentItems.length > 0
                      ? KIND_ORDER.map((kind) => {
                          const count = counts[kind] ?? 0;
                          if (count === 0) return null;
                          return (
                            <View
                              key={kind}
                              style={[
                                styles.barSegment,
                                {
                                  width: `${(count / recentItems.length) * 100}%`,
                                  backgroundColor: mixColor(kindColor(colors, kind), colors.bg, 0.7),
                                },
                              ]}
                            />
                          );
                        })
                      : null}
                  </View>
                  <View style={styles.dotWrap}>
                    <View style={[styles.dot, { backgroundColor: dotColor }]} />
                  </View>
                  <Ionicons
                    name={open ? 'chevron-down' : 'chevron-forward'}
                    size={16}
                    color={colors.textTertiary}
                  />
                </Press>
                {open
                  ? recentSessions.map((row) => {
                      const detailsKey = row.session.sessionId;
                      const detailsOpen = Boolean(openDetails[detailsKey]);
                      const hasDetails =
                        row.session.commits.length > 0 || row.session.links.length > 0;
                      return (
                        <View key={detailsKey} style={styles.sessionBlock}>
                          <View style={styles.sessionHead}>
                            <Text style={styles.sessionDate}>{shortDate(row.session.date)}</Text>
                            <Text style={styles.sessionMeta} numberOfLines={1}>
                              · {row.session.host}
                            </Text>
                            <Text style={styles.sessionMeta}>
                              · {itensLabel(row.session.items.length)}
                            </Text>
                            <View style={styles.push} />
                            {row.entryId ? (
                              <Press
                                testID={`nota-${row.entryId}`}
                                onPress={() => openEntry(row.entryId)}
                                style={styles.notaBtn}
                                accessibilityRole="button"
                                accessibilityLabel={`Abrir nota de ${row.session.project}`}
                                hitSlop={8}
                              >
                                <Text style={styles.notaText}>Nota</Text>
                              </Press>
                            ) : null}
                          </View>
                          {row.session.items.map((entry, at) => (
                            <ItemLine
                              key={`${entry.title}:${at}`}
                              item={{ ...entry, entryId: row.entryId }}
                              onPress={openEntry}
                            />
                          ))}
                          {hasDetails ? (
                            <View style={styles.detWrap}>
                              <Press
                                testID={`detalhes-${detailsKey}`}
                                onPress={() =>
                                  setOpenDetails((current) => ({
                                    ...current,
                                    [detailsKey]: !detailsOpen,
                                  }))
                                }
                                style={styles.detToggle}
                                accessibilityRole="button"
                                accessibilityState={{ expanded: detailsOpen }}
                                hitSlop={8}
                              >
                                <Ionicons
                                  name={detailsOpen ? 'chevron-down' : 'chevron-forward'}
                                  size={13}
                                  color={colors.textSecondary}
                                />
                                <Text style={styles.detLabel}>Detalhes técnicos</Text>
                              </Press>
                              {detailsOpen ? (
                                <View style={styles.detBody}>
                                  {row.session.commits.map((commit, at) => (
                                    <Text key={`${commit.hash}:${at}`} style={styles.detLine} numberOfLines={1}>
                                      {commit.hash ? `${commit.hash} — ` : ''}
                                      {commit.message}
                                    </Text>
                                  ))}
                                  {row.session.links.map((link, at) => (
                                    <Text key={`${link.url}:${at}`} style={styles.detLine} numberOfLines={1}>
                                      {link.label ? `${link.label}: ` : ''}
                                      {link.url}
                                    </Text>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  : null}
              </View>
            );
          }}
          ListEmptyComponent={itemsEmpty}
        />
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      {header}
      {tabs}
      {readError ? (
        <View style={styles.errorBar}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{readError}</Text>
        </View>
      ) : null}

      <View style={styles.toolbar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolbarScroll}
        >
          {projects.map((item) => (
            <Press
              key={item.entryId}
              testID={`chip-pj-${item.project}`}
              style={[styles.chip, projectFilter.has(item.project) ? styles.chipOn : null]}
              onPress={() => toggleSet(item.project, projectFilter, setProjectFilter)}
              accessibilityRole="button"
              accessibilityState={{ selected: projectFilter.has(item.project) }}
              accessibilityLabel={`Filtrar projeto ${item.project}`}
            >
              <ProjectMark icon={item.icon} project={item.project} size="sm" />
              <Text style={styles.chipText} numberOfLines={1}>
                {item.project}
              </Text>
            </Press>
          ))}
          {projects.length > 0 ? <View style={styles.divider} /> : null}
          {data.kinds.map((kind) => (
            <Press
              key={kind}
              testID={`chip-kind-${kind}`}
              style={[styles.chip, kindFilter.has(kind) ? styles.chipOn : null]}
              onPress={() => toggleSet(kind, kindFilter, setKindFilter)}
              accessibilityRole="button"
              accessibilityState={{ selected: kindFilter.has(kind) }}
              accessibilityLabel={`Filtrar kind ${kind}`}
            >
              <Text style={[styles.chipKind, { color: kindFilter.has(kind) ? kindColor(colors, kind) : colors.textSecondary }]}>
                {kind}
              </Text>
            </Press>
          ))}
          <View style={styles.divider} />
          <View style={styles.seg}>
            {RANGE_OPTIONS.map((option) => (
              <Press
                key={option.id}
                testID={`range-${option.id}`}
                style={[styles.segBtn, range === option.id ? styles.segBtnOn : null]}
                onPress={() => setRange(option.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: range === option.id }}
              >
                <Text style={[styles.segText, range === option.id ? styles.segTextOn : null]}>
                  {option.label}
                </Text>
              </Press>
            ))}
          </View>
        </ScrollView>
      </View>

      <FlatList
        testID="items-list"
        data={filteredSessions}
        keyExtractor={(item) => item.session.sessionId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.textSecondary} />
        }
        renderItem={({ item }) => (
          <View style={styles.sess}>
            <Press
              style={styles.sessHead}
              onPress={() => openEntry(item.entryId)}
              accessibilityRole="button"
              accessibilityLabel={`${item.session.project}, ${shortDate(item.session.date)} ${item.session.host}, ${itensLabel(item.items.length)}`}
            >
              <ProjectMark
                icon={projects.find((entry) => entry.project === item.session.project)?.icon}
                project={item.session.project}
                size="sm"
              />
              <Text style={styles.sessProject} numberOfLines={1}>
                {item.session.project}
              </Text>
              <Text style={styles.sessMeta} numberOfLines={1}>
                · {shortDate(item.session.date)} · {item.session.host}
              </Text>
              <View style={styles.push} />
              <Text style={styles.sessCount}>{itensLabel(item.items.length)}</Text>
            </Press>
            {item.items.map((entry, at) => (
              <ItemLine
                key={`${entry.title}:${at}`}
                item={{ ...entry, entryId: item.entryId }}
                onPress={openEntry}
              />
            ))}
          </View>
        )}
        ListEmptyComponent={itemsEmpty}
      />

      <View style={styles.foot}>
        <Text style={styles.footText}>
          {itensLabel(filtered.length)} · {projetosLabel(new Set(filtered.map((row) => row.project)).size)}
        </Text>
      </View>
    </Screen>
  );
}

/** Esqueleto denso: a tela nasce com linhas, igual a home. */
function ProjectsSkeleton() {
  const styles = useThemedStyles(baseStyles);

  return (
    <View style={styles.skeleton} testID="projects-loading" pointerEvents="none" accessibilityLabel="Carregando projetos">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonMark} />
          <View style={styles.skeletonLines}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonSub} />
          </View>
        </View>
      ))}
    </View>
  );
}

const baseStyles = defineStyles({
  screen: { paddingHorizontal: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },

  tabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.sm,
  },
  tabOn: { backgroundColor: baseColors.surfaceElevated },
  tabText: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  tabTextOn: { color: baseColors.text, fontWeight: '600' },
  tabCount: { color: baseColors.textTertiary, fontSize: fontSize.xs },

  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: baseColors.dangerSoft,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  errorText: { flex: 1, color: baseColors.danger, fontSize: fontSize.xs, fontWeight: '600' },

  toolbar: {
    height: 52,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  toolbarScroll: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
    backgroundColor: baseColors.surface,
  },
  chipOn: { backgroundColor: baseColors.surfaceElevated, borderColor: baseColors.borderStrong },
  chipText: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '500', maxWidth: 120 },
  chipKind: {
    fontFamily: fontFamilyNative('mono'),
    fontSize: 11,
    fontWeight: '500',
  },
  divider: { width: 1, height: 18, backgroundColor: baseColors.border },
  seg: {
    flexDirection: 'row',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
    overflow: 'hidden',
  },
  segBtn: { height: 34, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: baseColors.surfaceElevated },
  segText: { color: baseColors.textSecondary, fontSize: fontSize.xs },
  segTextOn: { color: baseColors.text, fontWeight: '600' },

  list: { paddingHorizontal: spacing.lg, paddingBottom: 64 },

  mark: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: baseColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markSm: { width: 22, height: 22, borderRadius: 6 },
  markLetter: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '700' },
  markEmoji: { fontSize: 13 },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.xs,
  },
  kindSlot: { width: 56, alignItems: 'flex-start' },
  kindBadge: {
    paddingHorizontal: 7,
    height: 20,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindText: { fontSize: 11, fontWeight: '600' },
  itemTitle: { flex: 1, color: baseColors.text, fontSize: fontSize.sm },
  commitText: {
    fontFamily: fontFamilyNative('mono'),
    fontSize: 11,
    color: baseColors.textSecondary,
    maxWidth: 92,
  },
  commitSpacer: { width: 40 },

  // cartoes por sessao (aba Itens)
  sess: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
    paddingVertical: spacing.sm,
  },
  sessHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.xs,
  },
  sessProject: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600', maxWidth: 140 },
  sessMeta: { color: baseColors.textTertiary, fontSize: fontSize.xs, flexShrink: 1 },
  sessCount: { color: baseColors.textSecondary, fontSize: fontSize.xs },
  push: { flex: 1 },

  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: baseColors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  footText: { color: baseColors.textSecondary, fontSize: fontSize.xs },

  // aba Projetos
  project: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: baseColors.border },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  projectRowOn: { backgroundColor: baseColors.surface },
  projectName: { flex: 1, gap: 2 },
  projectTitle: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  projectSub: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  barTrack: {
    flexDirection: 'row',
    width: 64,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: baseColors.neutralSoft,
  },
  barSegment: { height: 6 },
  dotWrap: { width: 12, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },

  sessionBlock: {
    backgroundColor: baseColors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    paddingVertical: spacing.xs,
  },
  sessionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 34,
    paddingTop: spacing.xs,
  },
  sessionDate: { color: baseColors.text, fontSize: fontSize.xs, fontWeight: '600' },
  sessionMeta: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  notaBtn: {
    height: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notaText: { color: baseColors.accent, fontSize: fontSize.xs, fontWeight: '600' },

  detWrap: { paddingTop: spacing.xs, paddingBottom: spacing.sm },
  detToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    height: 32,
    paddingRight: spacing.md,
  },
  detLabel: { color: baseColors.textSecondary, fontSize: fontSize.xs },
  detBody: {
    borderLeftWidth: 2,
    borderLeftColor: baseColors.border,
    paddingLeft: spacing.md,
    marginTop: 6,
    gap: 3,
  },
  detLine: {
    fontFamily: fontFamilyNative('mono'),
    fontSize: 11,
    color: baseColors.textSecondary,
  },

  empty: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxxl },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: baseColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: {
    color: baseColors.textTertiary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },

  skeleton: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  skeletonMark: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: baseColors.surface,
  },
  skeletonLines: { flex: 1, gap: spacing.sm },
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
});
