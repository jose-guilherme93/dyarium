/**
 * Mapa de relacoes do aparelho.
 *
 * O grafo e derivado do SQLite local; nenhuma chamada de rede e necessaria para
 * abrir. A folha de baixo tem tres alturas e, na altura cheia, rola todos os
 * trechos das notas que mencionam a entidade escolhida. A reconciliacao com o
 * servidor roda em segundo plano e nunca bloqueia o desenho.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import {
  Profiler,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  BackHandler,
  InteractionManager,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { TagStrip } from '@/components/TagStrip';
import { EntityDetail } from '@/components/graph/EntityDetail';
import { EntityEditor } from '@/components/graph/EntityEditor';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/graph/GraphCanvas';
import { GraphIcon } from '@/components/graph/GraphIcon';
import { MapFilters, type MapPeriod } from '@/components/graph/MapFilters';
import { MapSheet, SNAP_DETAIL, SNAP_REST, type MapSheetHandle } from '@/components/graph/MapSheet';
import { MoodPanel } from '@/components/graph/MoodPanel';
import type { EntityKind, GraphData, GraphNodeKind } from '@/core/graphModel';
import { kindLabel, splitNodeId } from '@/core/graphModel';
import type { EntityPanel } from '@/core/graphPanel';
import {
  graphFromSnapshot,
  kindCounts,
  layoutForGraph,
  layoutSeeded,
  loadEntityPanel,
  loadGraphSnapshot,
  loadMoodSeries,
  noteKeyFromNode,
  panelForEntity,
  readCachedSnapshot,
  rememberSnapshot,
  type GraphSnapshot,
} from '@/services/graphData';
import { buildEntityMood } from '@/core/graphMood';
import type { MoodPoint } from '@/core/graphMood';
import {
  claimLocalSelf,
  ensureEntityDerivation,
  renameLocalEntity,
  setLocalEntityIcon,
} from '@/services/db';
import { syncEntities } from '@/services/entitySync';
import { back, push } from '@/services/appNavigation';
import { listNotebooks } from '@/services/notebooks';
import type { Notebook } from '@/core/notebooks';
import { mark, useRenderCount } from '@/dev/perf';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { GRAPH_PALETTES } from '@/theme/graph';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';
import type { GraphLayout } from '@/core/graphLayout';

const PERIODS: MapPeriod[] = [
  { key: 'all', label: 'Tudo' },
  { key: '7', label: '7d' },
  { key: '30', label: '30d' },
  { key: '90', label: '90d' },
  { key: 'year', label: 'Ano' },
];

const KINDS: EntityKind[] = ['person', 'place', 'theme', 'decision'];

/**
 * Cache de sessao do recorte. Reabrir o mapa com o mesmo filtro pinta na hora e
 * nao toca no SQLite: o grafo e desenho, nao consulta. Depois de alguns
 * segundos a leitura fresca roda por tras.
 */
let snapshotCache: { key: string; at: number; snapshot: GraphSnapshot } | null = null;

/** Escurecido do desenho ao trocar de cena, em ms. */
const VEIL_IN = 110;
const VEIL_OUT = 220;

/** Altura fixa de uma linha da lista de entidades, em pt. */
const OVERVIEW_ROW = 46;

/** Idade em que o cache ainda vale sem ir ao banco. */
const SNAPSHOT_FRESH_MS = 20_000;

/** Mesmo recorte, mesmo desenho: evita remontar o SVG a toa. */
function sameSnapshot(a: GraphSnapshot, b: GraphSnapshot): boolean {
  return (
    a.entries.length === b.entries.length &&
    a.links.length === b.links.length &&
    a.entities.length === b.entities.length &&
    a.total === b.total &&
    a.analyzed === b.analyzed
  );
}

function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function periodRange(period: string): { from?: string; to?: string } {
  if (period === 'all') return {};
  const now = new Date();
  const to = localDay(now);
  if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to };
  const days = period === '7' ? 7 : period === '30' ? 30 : 90;
  const from = new Date(now);
  from.setDate(now.getDate() - (days - 1));
  return { from: localDay(from), to };
}

function entityNodeId(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}

/** Glifo leve para a lista: a fonte e mais barata que um SVG por linha. */
function overviewGlyph(kind: GraphNodeKind): ComponentProps<typeof Ionicons>['name'] {
  switch (kind) {
    case 'place':
      return 'home';
    case 'theme':
      return 'pricetag';
    case 'decision':
      return 'checkmark';
    default:
      return 'person';
  }
}

/** Linha da visao geral: virtualizada, para descer a folha nao custar nada. */
const OverviewRow = memo(function OverviewRow({
  node,
  color,
  onPress,
}: {
  node: GraphData['nodes'][number];
  color: string;
  onPress: (id: string) => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  return (
    <Press
      style={styles.overviewRow}
      onPress={() => onPress(node.id)}
      accessibilityRole="button"
      accessibilityLabel={`${node.label}, ${node.mentions} menções`}
    >
      <View style={[styles.overviewIcon, { backgroundColor: color }]}>
        <Ionicons name={overviewGlyph(node.kind)} size={15} color={colors.bg} />
      </View>
      <Text style={styles.overviewName} numberOfLines={1}>
        {node.label}
      </Text>
      <Text style={styles.overviewMeta}>{node.mentions}</Text>
      <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
    </Press>
  );
});

export default function MapScreen() {
  useRenderCount('MapScreen');
  const styles = useThemedStyles(baseStyles);
  const { colors: theme, name: themeName } = useTheme();
  const graphColors = GRAPH_PALETTES[themeName];
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ focusKind?: string; focusName?: string }>();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);

  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Set<EntityKind>>(new Set(KINDS));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState('all');
  const [notebookId, setNotebookId] = useState('');
  const [sheetSnap, setSheetSnap] = useState(SNAP_REST);
  const [tab, setTab] = useState<'detail' | 'mood'>('detail');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  // O desenho que esta na tela. Quando o conjunto muda (abrir um no, filtrar),
  // o anterior fica ate a posicao nova chegar: trocar para um quadro vazio
  // faria a tela piscar no meio do toque.
  const [shown, setShown] = useState<{ data: GraphData; layout: GraphLayout } | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<EntityPanel | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  const [mood, setMood] = useState<MoodPoint[]>([]);
  const [moodLoading, setMoodLoading] = useState(false);

  const sheetRef = useRef<MapSheetHandle>(null);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const focusApplied = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const panelSeq = useRef(0);
  const moodSeq = useRef(0);
  const tabRef = useRef<'detail' | 'mood'>('detail');
  const loadRef = useRef<() => Promise<void>>(async () => undefined);
  const loadedOnce = useRef(false);
  const mounted = useRef(true);

  const data = useMemo(() => {
    if (!snapshot) return null;
    return graphFromSnapshot(snapshot, {
      focus: focusId ?? undefined,
      nodeLimit: 120,
      edgesPerNode: 6,
      noteLimit: 120,
    });
  }, [snapshot, focusId]);

  // Mapa inteiro, sem foco: os numeros dos filtros falam da biblioteca toda e
  // nao encolhem quando uma entidade e aberta.
  const whole = useMemo(
    () => (snapshot ? graphFromSnapshot(snapshot, { nodeLimit: 120, edgesPerNode: 6 }) : null),
    [snapshot],
  );

  // O foco se semeia nas posicoes do desenho que esta na tela: as bolas que ja
  // estavam ali nao saem do lugar, e a fisica tem pouco a assentar.
  const focusLayout = useMemo(
    () =>
      data && focusId ? layoutSeeded(data, focusId, shown?.layout.positions ?? null) : null,
    [data, focusId, shown],
  );
  const visible = data ? (focusLayout ? { data, layout: focusLayout } : shown) : null;

  const hydratePanel = useCallback(async (snap: GraphSnapshot, id: string | null) => {
    const parsed = id ? splitNodeId(id) : null;
    const entityId =
      parsed && parsed.kind !== 'note' && parsed.kind !== 'user' ? parsed.id : null;
    const seq = panelSeq.current + 1;
    panelSeq.current = seq;
    if (!entityId) {
      setSelectedPanel(null);
      setPanelLoading(false);
      return;
    }
    try {
      const panel = await loadEntityPanel(snap, entityId);
      if (panelSeq.current === seq) setSelectedPanel(panel);
    } catch {
      if (panelSeq.current === seq) setSelectedPanel(null);
    } finally {
      if (panelSeq.current === seq) setPanelLoading(false);
    }
  }, []);

  const hydrateMood = useCallback(async (snap: GraphSnapshot) => {
    const seq = moodSeq.current + 1;
    moodSeq.current = seq;
    setMoodLoading(true);
    try {
      const series = await loadMoodSeries(snap.entries);
      if (moodSeq.current === seq) setMood(series);
    } catch {
      if (moodSeq.current === seq) setMood([]);
    } finally {
      if (moodSeq.current === seq) setMoodLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    const cacheKey = `${notebookId}|${period}|${params.focusKind ?? ''}|${params.focusName ?? ''}`;
    const cached = snapshotCache?.key === cacheKey ? snapshotCache : null;
    if (!loadedOnce.current && cached) {
      // Pinta imediatamente com o recorte da visita anterior.
      setSnapshot(cached.snapshot);
      setLoading(false);
    } else if (!loadedOnce.current) {
      // Sem cache de sessao: o ultimo recorte gravado pinta antes de qualquer
      // leitura. Abrir o mapa nao espera o banco.
      const disk = await readCachedSnapshot(cacheKey);
      if (!mounted.current) return;
      if (disk) {
        setSnapshot(disk);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    setError(null);
    if (cached && Date.now() - cached.at < SNAPSHOT_FRESH_MS) {
      // Cache quente: abrir o mapa nao le o banco nem recalcula nada.
      loadedOnce.current = true;
      setLoading(false);
      return;
    }
    const range = periodRange(period);
    const started = Date.now();
    try {
      const next = await loadGraphSnapshot({
        notebookId: notebookId || undefined,
        ...range,
      });
      // Fechar o mapa no meio da leitura nao pode continuar montando a tela.
      if (!mounted.current) return;
      if (__DEV__) {
        console.log(
          `[map] snapshot ${next.entries.length} notas ${next.links.length} vinculos ${Date.now() - started}ms`,
        );
      }
      const previous = cached?.snapshot;
      snapshotCache = { key: cacheKey, at: Date.now(), snapshot: next };
      // Recorte identico: mantem o objeto anterior para o desenho nao refazer.
      if (!previous || !sameSnapshot(previous, next)) {
        setSnapshot(next);
        // Guarda para a proxima abertura; nao segura a tela.
        rememberSnapshot(cacheKey, next);
      }
      if (tabRef.current === 'mood') void hydrateMood(next);
      // A selecao/foco que sumiu com o filtro deixa de existir.
      const current = selectedRef.current;
      if (current && current !== 'user') {
        const parsed = splitNodeId(current);
        const exists =
          parsed &&
          next.entities.some(
            (entity) => entity.kind === parsed.kind && entity.id === parsed.id,
          );
        if (!exists) {
          panelSeq.current += 1;
          selectedRef.current = null;
          setSelectedId(null);
          setSelectedPanel(null);
          setPanelLoading(false);
        } else {
          void hydratePanel(next, current);
        }
      }
      setFocusId((currentFocus) =>
        currentFocus
          ? next.entities.some(
              (entity) => entityNodeId(entity.kind, entity.id) === currentFocus,
            )
            ? currentFocus
            : null
          : null,
      );
      // O foco pedido por uma analise (`focusKind`/`focusName`) vira id assim
      // que o catalogo local chega.
      if (!focusApplied.current) {
        const kind = params.focusKind as EntityKind | undefined;
        const name = params.focusName;
        if (!kind || !name) {
          focusApplied.current = true;
        } else {
          const entity = next.entities.find(
            (item) => item.kind === kind && item.name.toLowerCase() === name.toLowerCase(),
          );
          if (entity) {
            focusApplied.current = true;
            const id = entityNodeId(entity.kind, entity.id);
            selectedRef.current = id;
            setFocusId(id);
            setSelectedId(id);
            void hydratePanel(next, id);
          }
        }
      }
    } catch {
      setError('Não foi possível ler o mapa do aparelho.');
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, [notebookId, period, params.focusKind, params.focusName, hydratePanel, hydrateMood]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // A derivacao das analises antigas so comeca depois que o mapa esta
  // desenhado: enquanto ele abre, a leitura do layout tem o banco so para ela.
  const drawn = Boolean(visible);
  useEffect(() => {
    if (!drawn) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // So depois que a tela e o primeiro gesto terminam: o mapa abre sem
    // disputar a thread com a derivacao das analises antigas.
    const interaction = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        const started = Date.now();
        void ensureEntityDerivation()
          .then((processed) => {
            if (__DEV__) {
              console.log(`[map] backfill ${processed} ${Date.now() - started}ms`);
            }
            if (alive && processed > 0) void loadRef.current();
          })
          .catch(() => undefined);
      }, 2500);
    });
    return () => {
      alive = false;
      // O timer nasce dentro da interacao; `cancel()` para a interacao pendente,
      // mas nao um timer ja agendado. Sem isto, a tela desmontada ainda acordava
      // 2,5 s depois para derivar analises (e logar) sem ninguem olhando.
      interaction.cancel();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [drawn]);

  useEffect(() => {
    // O foco ja trouxe o layout no proprio toque; o caminho do banco e do mapa
    // inteiro, que e grande e reaproveitado entre aberturas.
    if (!data || focusLayout) return undefined;
    let alive = true;
    void layoutForGraph(data).then((next) => {
      if (!alive) return;
      setShown({ data, layout: next });
    });
    return () => {
      alive = false;
    };
  }, [data, focusLayout]);

  // Sincronizacao best-effort: nao atrasa o primeiro desenho. Se o servidor
  // estiver fora, o mapa segue com o que o aparelho tem.
  useEffect(() => {
    void syncEntities().catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    void listNotebooks()
      .then((items) => {
        if (alive) setNotebooks(items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const reloadSnapshot = useCallback(async () => {
    const range = periodRange(period);
    try {
      const next = await loadGraphSnapshot({ notebookId: notebookId || undefined, ...range });
      setSnapshot(next);
      return next;
    } catch {
      return null;
    }
  }, [notebookId, period]);

  const selectedEntity = useMemo(() => {
    if (!snapshot || !selectedId) return null;
    const parsed = splitNodeId(selectedId);
    if (!parsed || parsed.kind === 'note' || parsed.kind === 'user') return null;
    return (
      snapshot.entities.find(
        (entity) => entity.kind === parsed.kind && entity.id === parsed.id,
      ) ?? null
    );
  }, [snapshot, selectedId]);

  const selectedStats = useMemo(() => {
    if (!snapshot || !selectedEntity) return null;
    let mentions = 0;
    const notes = new Set<string>();
    for (const link of snapshot.links) {
      if (link.entityId !== selectedEntity.id) continue;
      mentions += Math.max(1, link.count);
      notes.add(link.entryId);
    }
    return { mentions, notes: notes.size };
  }, [snapshot, selectedEntity]);

  // Com uma entidade aberta, o Humor fala dela: o tom dos vinculos nota x
  // entidade, dia a dia. Sem entidade, fala da biblioteca inteira.
  const entityMood = useMemo(
    () =>
      snapshot && selectedEntity
        ? buildEntityMood(snapshot.links, snapshot.entries, selectedEntity.id)
        : null,
    [snapshot, selectedEntity],
  );
  const moodSeries = entityMood ?? mood;
  const moodSubject = selectedEntity?.name ?? null;
  const moodBusy = entityMood ? false : moodLoading;

  const counts = useMemo(() => (whole ? kindCounts(whole) : null), [whole]);
  const entityTotal = counts ? KINDS.reduce((sum, kind) => sum + counts[kind], 0) : 0;

  const openNote = useCallback(
    (entryId: string) => {
      const entry = snapshot?.entryByKey[entryId];
      const target = entry?.localId ?? entry?.entryId ?? entryId;
      push(`/note/${target}`);
    },
    [snapshot],
  );

  // Veu do desenho: escurece a cena antes de trocar e so abre depois que o
  // desenho novo esta no lugar. Sem isso o mapa velho pisca e a camera salta.
  const [veil, setVeil] = useState(false);
  const veilOpacity = useSharedValue(0);
  const veilTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const veilGuard = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    veilOpacity.value = withTiming(veil ? 1 : 0, { duration: veil ? VEIL_IN : VEIL_OUT });
  }, [veil, veilOpacity]);

  const veilStyle = useAnimatedStyle(() => ({ opacity: veilOpacity.value }));

  /** Troca o desenho atras do escurecido. A acao roda com o veu fechado. */
  const switchScene = useCallback((action: () => void) => {
    setVeil(true);
    if (veilTimer.current) clearTimeout(veilTimer.current);
    if (veilGuard.current) clearTimeout(veilGuard.current);
    veilTimer.current = setTimeout(() => {
      action();
      // Se o desenho novo nao chegar, o veu abre sozinho.
      veilGuard.current = setTimeout(() => setVeil(false), 1500);
    }, VEIL_IN);
  }, []);

  const sceneReady = veil && Boolean(visible) && visible?.data === data;
  useEffect(() => {
    if (!sceneReady) return undefined;
    const timer = setTimeout(() => setVeil(false), 60);
    return () => clearTimeout(timer);
  }, [sceneReady]);

  /** Volta ao mapa inteiro: nada escolhido, nada em foco. */
  const resetToMap = useCallback(() => {
    panelSeq.current += 1;
    selectedRef.current = null;
    setSelectedId(null);
    setSelectedPanel(null);
    setPanelLoading(false);
    if (focusId) switchScene(() => setFocusId(null));
  }, [focusId, switchScene]);

  /**
   * Abre uma bola: ela vira a raiz da propria visao. Todo o resto sai de cena
   * e ficam so ela, as relacoes dela e as notas que a citam. Tocar no dono
   * ("Você") devolve o mapa inteiro.
   */
  const selectNode = useCallback(
    (id: string | null) => {
      if (!id || id === 'user') {
        resetToMap();
        return;
      }
      const parsed = splitNodeId(id);
      if (parsed?.kind === 'note') {
        openNote(noteKeyFromNode(id));
        return;
      }
      selectedRef.current = id;
      setSelectedId(id);
      // So troca o desenho se a bola ainda nao esta aberta: tocar de novo na
      // mesma bola nao pode piscar a tela.
      if (id !== focusId) switchScene(() => setFocusId(id));
      tabRef.current = 'detail';
      setTab('detail');
      // A folha fica onde o usuario deixou (50%): ele sobe se quiser ler mais.
      // Os numeros vem do snapshot na hora; so os trechos chegam depois.
      const instant = snapshot && parsed ? panelForEntity(snapshot, parsed.id) : null;
      setSelectedPanel(instant);
      setPanelLoading(!instant);
      if (snapshot) void hydratePanel(snapshot, id);
    },
    [openNote, resetToMap, snapshot, hydratePanel, focusId, switchScene],
  );

  // Voltar do Android desfaz o estado do mapa antes de sair dele: Humor volta
  // para Detalhe, a folha desce para o repouso e o foco volta ao mapa inteiro.
  // So no repouso, com a lista embaixo, e que sai para a biblioteca.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tabRef.current === 'mood') {
        tabRef.current = 'detail';
        setTab('detail');
        return true;
      }
      if (sheetSnap > SNAP_REST + 0.01) {
        sheetRef.current?.snapTo(SNAP_REST);
        return true;
      }
      if (focusId) {
        resetToMap();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [sheetSnap, focusId, resetToMap]);

  // A lista e para procurar, nao para ranquear: ordem alfabetica e mais simples
  // de achar um nome do que a ordem por mencoes do desenho.
  const overviewNodes = useMemo(
    () =>
      data
        ? data.nodes
            .filter((node) => node.kind !== 'note')
            .filter((node) => kinds.has(node.kind as EntityKind) || node.id === selectedId)
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
        : [],
    [data, kinds, selectedId],
  );

  const renderOverview = useCallback(
    ({ item }: ListRenderItemInfo<GraphData['nodes'][number]>) => (
      <OverviewRow
        node={item}
        color={item.kind === 'user' ? theme.neutralSoft : graphColors[item.kind as EntityKind]}
        onPress={selectNode}
      />
    ),
    [theme.neutralSoft, graphColors, selectNode],
  );

  const toggleKind = useCallback((kind: EntityKind) => {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next.size === 0 ? new Set(KINDS) : next;
    });
  }, []);

  const editEntity = useCallback(
    async (action: () => Promise<unknown>) => {
      setEditorBusy(true);
      setEditorError(null);
      try {
        await action();
        const next = await reloadSnapshot();
        if (next) await hydratePanel(next, selectedRef.current);
      } catch (cause) {
        setEditorError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
      } finally {
        setEditorBusy(false);
      }
    },
    [reloadSnapshot, hydratePanel],
  );

  const onRename = useCallback(
    (name: string) => {
      if (!selectedEntity) return;
      void editEntity(async () => {
        const renamed = await renameLocalEntity(selectedEntity.kind, selectedEntity.name, name);
        const nextId = entityNodeId(renamed.kind, renamed.id);
        selectedRef.current = nextId;
        setSelectedId(nextId);
        setSelectedPanel(null);
        if (focusId) setFocusId(nextId);
        setEditorOpen(false);
        void syncEntities().catch(() => undefined);
      });
    },
    [editEntity, selectedEntity, focusId],
  );

  const onIcon = useCallback(
    (icon: string) => {
      if (!selectedEntity) return;
      void editEntity(async () => {
        await setLocalEntityIcon(selectedEntity.kind, selectedEntity.name, icon);
        void syncEntities().catch(() => undefined);
      });
    },
    [editEntity, selectedEntity],
  );

  const onClaimSelf = useCallback(() => {
    if (!selectedEntity) return;
    void editEntity(async () => {
      await claimLocalSelf(selectedEntity.name);
      panelSeq.current += 1;
      selectedRef.current = null;
      setSelectedId(null);
      setSelectedPanel(null);
      setFocusId(null);
      setEditorOpen(false);
      void syncEntities().catch(() => undefined);
    });
  }, [editEntity, selectedEntity]);

  const sheetHeader = (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetTitleRow}>
        {selectedEntity ? (
          <View
            style={[
              styles.entityDot,
              { backgroundColor: graphColors[selectedEntity.kind] },
            ]}
          >
            <GraphIcon
              kind={selectedEntity.kind}
              icon={selectedEntity.icon}
              size={16}
              color={theme.bg}
            />
          </View>
        ) : null}
        <View style={styles.sheetTitleText}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {selectedEntity ? selectedEntity.name : 'Você'}
          </Text>
          <Text style={styles.sheetMeta}>
            {selectedEntity && selectedStats
              ? `${kindLabel(selectedEntity.kind)} · ${selectedStats.mentions} menções · ${selectedStats.notes} notas`
              : `${entityTotal} entidades · ${snapshot?.total ?? 0} notas`}
          </Text>
        </View>
      </View>

      <View style={styles.tabs}>
        <Press
          style={[styles.tab, tab === 'detail' ? styles.tabActive : null]}
          onPress={() => {
            tabRef.current = 'detail';
            setTab('detail');
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'detail' }}
        >
          <Text style={[styles.tabText, tab === 'detail' ? styles.tabTextActive : null]}>
            Detalhe
          </Text>
        </Press>
        <Press
          style={[styles.tab, tab === 'mood' ? styles.tabActive : null]}
          onPress={() => {
            tabRef.current = 'mood';
            setTab('mood');
            if (sheetSnap < SNAP_DETAIL) sheetRef.current?.snapTo(SNAP_DETAIL);
            if (snapshot) void hydrateMood(snapshot);
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'mood' }}
        >
          <Text style={[styles.tabText, tab === 'mood' ? styles.tabTextActive : null]}>Humor</Text>
        </Press>
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      {visible ? (
        <Profiler
          id="graph"
          onRender={(_id, _phase, actual) => mark('prof.graph_ms', actual)}
        >
          <GraphCanvas
          ref={canvasRef}
          data={visible.data}
          layout={visible.layout}
          colors={graphColors}
          width={width}
          height={height}
          viewportTop={insets.top + (focusId ? 72 : 50)}
          viewportBottom={Math.round(height * (1 - SNAP_REST))}
          selectedId={selectedId}
          focusMode={Boolean(focusId)}
          kinds={kinds}
          onSelect={selectNode}
          />
        </Profiler>
      ) : null}

      <Animated.View
        pointerEvents="none"
        style={[
          styles.veil,
          { bottom: Math.round(height * (1 - SNAP_REST)), backgroundColor: theme.bg },
          veilStyle,
        ]}
      />

      <View style={[styles.chrome, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.topBar}>
          <Press onPress={() => back()} style={styles.iconButton} accessibilityLabel="Voltar">
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Press>
          <Ionicons name="git-network-outline" size={18} color={theme.textSecondary} />
          <TagStrip style={styles.chipStrip} contentStyle={styles.chipStripContent}>
            {KINDS.map((kind) => {
              const active = kinds.has(kind);
              return (
                <Press
                  key={kind}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => toggleKind(kind)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${kindLabel(kind)}: ${counts?.[kind] ?? 0}`}
                >
                  <View
                    style={[
                      styles.chipDot,
                      { backgroundColor: active ? graphColors[kind] : theme.textTertiary },
                    ]}
                  />
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {kindLabel(kind)} {counts?.[kind] ?? 0}
                  </Text>
                </Press>
              );
            })}
          </TagStrip>
          <Press
            onPress={() => setFiltersOpen(true)}
            style={styles.iconButton}
            accessibilityLabel="Filtros do mapa"
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={notebookId || period !== 'all' ? theme.accent : theme.text}
            />
          </Press>
        </View>

      </View>

      {selectedId || focusId ? (
        <Press
          style={[styles.mapBack, { bottom: Math.round(height * SNAP_REST) + spacing.sm }]}
          onPress={resetToMap}
          accessibilityRole="button"
          accessibilityLabel="Voltar ao mapa inteiro"
        >
          <Ionicons name="chevron-back" size={13} color={theme.text} />
          <Text style={styles.mapBackText}>Mapa</Text>
        </Press>
      ) : null}

      <View style={[styles.zoom, { bottom: Math.round(height * SNAP_REST) + spacing.sm }]}>
        <Press
          style={styles.zoomButton}
          onPress={() => canvasRef.current?.zoomIn()}
          accessibilityLabel="Aproximar"
        >
          <Ionicons name="add" size={14} color={theme.text} />
        </Press>
        <Press
          style={styles.zoomButton}
          onPress={() => canvasRef.current?.zoomOut()}
          accessibilityLabel="Afastar"
        >
          <Ionicons name="remove" size={14} color={theme.text} />
        </Press>
        <Press
          style={styles.zoomButton}
          onPress={() => canvasRef.current?.fit()}
          accessibilityLabel="Ajustar à tela"
        >
          <Ionicons name="contract-outline" size={13} color={theme.text} />
        </Press>
      </View>

      {(loading || !visible) && !error ? (
        <View
          style={[
            styles.graphLoading,
            {
              top: insets.top + 50,
              bottom: Math.round(height * (1 - SNAP_REST)),
            },
          ]}
          pointerEvents="none"
        >
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}
      {error ? (
        <View style={styles.centerState}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      <MapSheet
        ref={sheetRef}
        header={sheetHeader}
        onSnapChange={setSheetSnap}
        initialSnap={SNAP_REST}
      >
        {(snap) =>
          tab === 'mood' ? (
            <ScrollView
              style={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              scrollEnabled
              contentContainerStyle={styles.moodScroll}
            >
              {moodBusy ? (
                <View style={styles.panelLoading}>
                  <ActivityIndicator color={theme.accent} />
                </View>
              ) : (
                <MoodPanel series={moodSeries} colors={graphColors} subject={moodSubject} />
              )}
            </ScrollView>
          ) : selectedEntity ? (
            panelLoading || !selectedPanel ? (
              <View style={styles.panelLoading}>
                <ActivityIndicator color={theme.accent} />
              </View>
            ) : (
              <EntityDetail
                panel={selectedPanel}
                colors={graphColors}
                snap={snap}
                onOpenNote={openNote}
                onRename={() => {
                  setEditorError(null);
                  setEditorOpen(true);
                }}
                onIcon={() => {
                  setEditorError(null);
                  setEditorOpen(true);
                }}
                onClaimSelf={onClaimSelf}
              />
            )
          ) : (
            <FlatList
              data={overviewNodes}
              keyExtractor={(node) => node.id}
              renderItem={renderOverview}
              style={styles.sheetScroll}
              contentContainerStyle={styles.overview}
              showsVerticalScrollIndicator={false}
              initialNumToRender={10}
              maxToRenderPerBatch={6}
              updateCellsBatchingPeriod={40}
              windowSize={5}
              // Altura fixa da linha: a lista sabe onde cada nome comeca sem
              // medir nada, entao rolar nao paga layout por linha.
              getItemLayout={(_, index) => ({
                length: OVERVIEW_ROW,
                offset: OVERVIEW_ROW * index,
                index,
              })}
              removeClippedSubviews
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {snapshot?.total ? 'Sem relações' : 'Sem notas'}
                </Text>
              }
            />
          )
        }
      </MapSheet>

      <MapFilters
        visible={filtersOpen}
        periods={PERIODS}
        period={period}
        notebookId={notebookId}
        notebooks={notebooks}
        onClose={() => setFiltersOpen(false)}
        onPeriod={(key) => {
          setPeriod(key);
          setFiltersOpen(false);
        }}
        onNotebook={(id) => {
          setNotebookId(id);
          setFiltersOpen(false);
        }}
      />

      <EntityEditor
        key={selectedEntity?.id ?? 'none'}
        entity={selectedEntity}
        visible={editorOpen}
        busy={editorBusy}
        error={editorError}
        onClose={() => setEditorOpen(false)}
        onRename={onRename}
        onIcon={onIcon}
        onClaimSelf={onClaimSelf}
      />
    </View>
  );
}

const baseStyles = defineStyles({
  screen: { flex: 1, backgroundColor: baseColors.bg },
  veil: { position: 'absolute', left: 0, right: 0, top: 0 },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    gap: 2,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  screenTitle: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  statsText: {
    color: baseColors.textSecondary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  chipStrip: {
    flex: 1,
    marginLeft: spacing.xs,
  },
  chipStripContent: { alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: baseColors.neutralSoft,
  },
  chipActive: { backgroundColor: baseColors.surfaceElevated },
  chipDot: { width: 5, height: 5, borderRadius: 3 },
  chipText: { color: baseColors.textTertiary, fontSize: 9, fontWeight: '600' },
  chipTextActive: { color: baseColors.text },
  zoom: { position: 'absolute', right: spacing.sm, gap: spacing.xs },
  mapBack: {
    position: 'absolute',
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 4,
    paddingRight: 9,
    height: 24,
    borderRadius: 12,
    backgroundColor: baseColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
  },
  mapBackText: { color: baseColors.text, fontSize: fontSize.xs, fontWeight: '600' },
  zoomButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: baseColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
  },
  centerState: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  graphLoading: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  error: { color: baseColors.danger, fontSize: fontSize.sm },
  sheetHeader: { gap: spacing.xs },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entityDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitleText: { flex: 1, gap: 1 },
  sheetTitle: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  sheetMeta: {
    color: baseColors.textSecondary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  tabs: { flexDirection: 'row', gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: baseColors.neutralSoft,
  },
  tabActive: { backgroundColor: baseColors.accentSoft },
  tabText: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  tabTextActive: { color: baseColors.accent },
  overview: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  sheetScroll: { flex: 1 },
  overviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: OVERVIEW_ROW,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  overviewIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewName: { flex: 1, color: baseColors.text, fontSize: fontSize.md },
  overviewMeta: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    color: baseColors.textTertiary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
  moodScroll: { paddingTop: spacing.md },
  panelLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
});
