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
import { router } from 'expo-router';
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
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';
import { TagStrip } from '@/components/TagStrip';
import { EntityActionSheet } from '@/components/graph/EntityActionSheet';
import { EntityEditor } from '@/components/graph/EntityEditor';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/graph/GraphCanvas';
import { GraphIcon } from '@/components/graph/GraphIcon';
import { MapFilters, type MapPeriod } from '@/components/graph/MapFilters';
import { MoodPanel } from '@/components/graph/MoodPanel';
import type { EntityKind, GraphData, GraphNodeKind } from '@/core/graphModel';
import { kindLabel, splitNodeId } from '@/core/graphModel';
import {
  graphFromSnapshot,
  kindCounts,
  layoutForGraph,
  layoutSeeded,
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
  addEntityRejection,
  changeEntityKind,
  claimLocalSelf,
  deleteEntityAndReject,
  ensureEntityDerivation,
  listEntityRejections,
  removeEntityRejection,
  renameLocalEntity,
  restoreEntitySnapshot,
  setEntityLabel,
  setLocalEntityIcon,
  snapshotEntityForUndo,
  type LocalEntitySnapshot,
} from '@/services/db';
import { syncEntities } from '@/services/entitySync';
import { back, push } from '@/services/appNavigation';
import { listNotebooks } from '@/services/notebooks';
import { noteNotebooks, type Notebook } from '@/core/notebooks';
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

type SlideValue = { value: number };

/**
 * Empurrao da cena: o desenho sai por um lado, a troca acontece fora da tela e
 * o novo entra pelo outro. `direction` 1 abre; -1 volta.
 */
function runSlide(
  slideX: SlideValue,
  width: number,
  direction: 1 | -1,
  action: () => void,
): void {
  // Um empurrao por vez: durante a animacao o deslocamento nao e zero.
  if (slideX.value !== 0) return;
  slideX.value = withTiming(-direction * width, { duration: SLIDE_OUT }, (finished) => {
    if (!finished) {
      slideX.value = withTiming(0, { duration: SLIDE_IN });
      return;
    }
    runOnJS(action)();
    slideX.value = direction * width;
    slideX.value = withTiming(0, { duration: SLIDE_IN });
  });
}

/** Escurece (ou abre) o veu do desenho. */
function fadeVeil(target: SlideValue, open: boolean): void {
  target.value = withTiming(open ? 1 : 0, { duration: open ? VEIL_IN : VEIL_OUT });
}

/** Empurrao do desenho ao trocar de cena, em ms: sai e entra. */
const SLIDE_OUT = 130;
const SLIDE_IN = 190;

/** Escurecido do desenho ao trocar de cena, em ms: fecha e abre. */
const VEIL_IN = 110;
const VEIL_OUT = 220;

/** Altura fixa de uma linha da lista de entidades, em pt. */
const OVERVIEW_ROW = 46;

/** Idade em que o cache ainda vale sem ir ao banco. */
const SNAPSHOT_FRESH_MS = 20_000;

/**
 * A derivacao de entidades antigas e uma varredura da biblioteca (2 s neste
 * aparelho). Ela so precisa rodar uma vez por execucao: rodava a cada abertura
 * do mapa e travava a thread de JS por segundos logo depois do desenho.
 */
let derivationChecked = false;

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
  const params = useLocalSearchParams<{
    focusKind?: string;
    focusName?: string;
    /** "kind" abre o menu da entidade ja no seletor de tipo (lapis da nota). */
    edit?: string;
  }>();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);

  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  // Espelho do estado para o efeito da derivacao ler o recorte atual sem
  // reexecutar a cada snapshot novo.
  const snapshotRef = useRef<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Set<EntityKind>>(new Set(KINDS));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState('all');
  const [notebookId, setNotebookId] = useState('');
  const [tab, setTab] = useState<'detail' | 'mood'>('detail');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [actionSheetExpandedType, setActionSheetExpandedType] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [rejections, setRejections] = useState<
    { kind: EntityKind; name: string; nameKey: string; updatedAt: string }[]
  >([]);
  const [rejectionName, setRejectionName] = useState('');
  const [rejectionKind, setRejectionKind] = useState<EntityKind>('person');
  const [undoSnapshot, setUndoSnapshot] = useState<LocalEntitySnapshot | LocalEntitySnapshot[] | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoLabel, setUndoLabel] = useState('Excluído');
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // O desenho que esta na tela. Quando o conjunto muda (abrir um no, filtrar),
  // o anterior fica ate a posicao nova chegar: trocar para um quadro vazio
  // faria a tela piscar no meio do toque.
  const [shown, setShown] = useState<{ data: GraphData; layout: GraphLayout } | null>(null);

  const [mood, setMood] = useState<MoodPoint[]>([]);
  const [moodLoading, setMoodLoading] = useState(false);

  const canvasRef = useRef<GraphCanvasHandle>(null);
  const focusApplied = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const moodSeq = useRef(0);
  const tabRef = useRef<'detail' | 'mood'>('detail');
  const loadRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined);
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

  // Recorte que ja esta na tela. Abrir/fechar uma bola muda a identidade dos
  // params do router; sem esta guarda o mapa relia a biblioteca e refazia o
  // layout a cada ida e volta -- era o travamento de segundos ao voltar.
  const loadedDataKey = useRef<string | null>(null);

  const load = useCallback(async (force = false) => {
    const dataKey = `${notebookId}|${period}`;
    if (!force && loadedOnce.current && loadedDataKey.current === dataKey) return;
    loadedDataKey.current = dataKey;
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
          `[map] snapshot ${next.entries.length} notas ${next.links.length} vinculos ` +
            `${next.analyzed} analisadas ${Date.now() - started}ms`,
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
          selectedRef.current = null;
          setSelectedId(null);
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
            if (params.edit === 'kind') {
              setActionSheetExpandedType(true);
              setActionSheetOpen(true);
            }
          }
        }
      }
    } catch {
      setError('Não foi possível ler o mapa do aparelho.');
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, [notebookId, period, params.focusKind, params.focusName, params.edit, hydrateMood]);

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
    snapshotRef.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    if (!drawn || derivationChecked) return undefined;
    derivationChecked = true;
    let alive = true;
    // Tempo, e nao `runAfterInteractions`: o mapa tem uma deriva continua e a
    // fila de interacoes nunca esvazia, o que impedia a derivacao de rodar.
    const timer = setTimeout(() => {
        const started = Date.now();
        // Mapa com notas mas sem nenhum vinculo: o marcador de derivacao pode
        // estar gravado de uma versao anterior em que nada foi derivado. Nesse
        // caso, refaz a partir das analises guardadas em vez de desistir.
        const actual = snapshotRef.current;
        const force = Boolean(actual && actual.entries.length > 0 && actual.links.length === 0);
        void ensureEntityDerivation(force)
          .then((processed) => {
            if (__DEV__) {
              console.log(`[map] backfill ${processed} ${Date.now() - started}ms`);
            }
            if (alive && processed > 0) {
              // A leitura fresca em cache esconderia justamente o que acabou de
              // ser derivado: joga o cache fora antes de reler.
              snapshotCache = null;
              void loadRef.current(true);
            }
          })
          .catch(() => undefined);
    }, 2500);
    return () => {
      alive = false;
      clearTimeout(timer);
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
        if (alive) setNotebooks(noteNotebooks(items));
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

  // Duas trocas de cena, uma por origem:
  // - a lista e navegacao: o desenho desliza como abrir uma nota;
  // - o desenho e a propria visao mudando: escurece e volta com os nois novos.
  const slideX = useSharedValue(0);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slideX.value }] }));
  const veilOpacity = useSharedValue(0);
  const veilStyle = useAnimatedStyle(() => ({ opacity: veilOpacity.value }));
  const [veil, setVeil] = useState(false);
  const veilGuard = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transition = useRef<'slide' | 'fade'>('fade');

  useEffect(() => {
    fadeVeil(veilOpacity, veil);
  }, [veil, veilOpacity]);

  const switchScene = useCallback(
    (action: () => void, direction: 1 | -1 = 1) => {
      transition.current = 'slide';
      runSlide(slideX, width, direction, action);
    },
    [width, slideX],
  );

  /** Troca a cena com o desenho escurecido: some, troca, volta. */
  const fadeScene = useCallback((action: () => void) => {
    transition.current = 'fade';
    setVeil(true);
    if (veilGuard.current) clearTimeout(veilGuard.current);
    veilGuard.current = setTimeout(() => {
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
    selectedRef.current = null;
    setSelectedId(null);
    if (focusId) {
      if (transition.current === 'slide') switchScene(() => setFocusId(null), -1);
      else fadeScene(() => setFocusId(null));
    }
  }, [focusId, switchScene, fadeScene]);

  /**
   * Abre uma bola: navega para a tela de detalhe da entidade.
   */
  const openEntity = useCallback(
    (id: string, from: 'graph' | 'list') => {
      const parsed = splitNodeId(id);
      if (parsed?.kind === 'note') {
        openNote(noteKeyFromNode(id));
        return;
      }
      if (parsed?.kind && parsed.kind !== 'user') {
        push(`/map/${entityNodeId(parsed.kind as EntityKind, parsed.id)}`);
      }
    },
    [openNote],
  );

  /** Toque no desenho: troca escurecendo. Tocar no dono/vazio volta ao mapa. */
  const selectNode = useCallback(
    (id: string | null) => {
      if (!id || id === 'user') resetToMap();
      else openEntity(id, 'graph');
    },
    [openEntity, resetToMap],
  );



  // Voltar do Android: se houver foco, volta ao mapa inteiro.
  // Caso contrario, sai para a biblioteca.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tabRef.current === 'mood') {
        tabRef.current = 'detail';
        setTab('detail');
        return true;
      }
      if (focusId) {
        resetToMap();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [focusId, resetToMap]);

  // A lista e para procurar, nao para ranquear: ordem alfabetica e mais simples
  // de achar um nome do que a ordem por mencoes do desenho.
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
        await reloadSnapshot();
      } catch (cause) {
        setEditorError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
      } finally {
        setEditorBusy(false);
      }
    },
    [reloadSnapshot],
  );

  const onRename = useCallback(
    (name: string) => {
      if (!selectedEntity) return;
      void editEntity(async () => {
        const renamed = await renameLocalEntity(selectedEntity.kind, selectedEntity.name, name);
        const nextId = entityNodeId(renamed.kind, renamed.id);
        selectedRef.current = nextId;
        setSelectedId(nextId);
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
      selectedRef.current = null;
      setSelectedId(null);
      setFocusId(null);
      setEditorOpen(false);
      void syncEntities().catch(() => undefined);
    });
  }, [editEntity, selectedEntity]);

  const showUndo = useCallback((snapshot: LocalEntitySnapshot | LocalEntitySnapshot[], label = 'Excluído') => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoSnapshot(snapshot);
    setUndoLabel(label);
    setUndoVisible(true);
    undoTimer.current = setTimeout(() => {
      setUndoVisible(false);
      setUndoSnapshot(null);
    }, 5000);
  }, []);

  const onKind = useCallback(
    (kind: EntityKind) => {
      if (!selectedEntity) return;
      void (async () => {
        const snap = await snapshotEntityForUndo(selectedEntity.kind, selectedEntity.name);
        setEditorBusy(true);
        setEditorError(null);
        try {
          await changeEntityKind(selectedEntity.kind, selectedEntity.name, kind);
          await reloadSnapshot();
          if (snap) showUndo(snap, 'Tipo alterado');
          setEditorOpen(false);
          setActionSheetOpen(false);
          void syncEntities().catch(() => undefined);
        } catch (cause) {
          setEditorError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
        } finally {
          setEditorBusy(false);
        }
      })();
    },
    [selectedEntity, reloadSnapshot, showUndo],
  );

  const onLabel = useCallback(
    (label: string) => {
      if (!selectedEntity) return;
      void editEntity(async () => {
        await setEntityLabel(selectedEntity.kind, selectedEntity.name, label);
        void syncEntities().catch(() => undefined);
      });
    },
    [editEntity, selectedEntity],
  );

  const onDelete = useCallback(() => {
    if (!selectedEntity) return;
    void (async () => {
      const snap = await snapshotEntityForUndo(selectedEntity.kind, selectedEntity.name);
      setEditorBusy(true);
      setEditorError(null);
      try {
        await deleteEntityAndReject(selectedEntity.kind, selectedEntity.name);
        await reloadSnapshot();
        if (snap) showUndo(snap, 'Excluído');
        setEditorOpen(false);
        setActionSheetOpen(false);
        selectedRef.current = null;
        setSelectedId(null);
        setFocusId(null);
        void syncEntities().catch(() => undefined);
      } catch (cause) {
        setEditorError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
      } finally {
        setEditorBusy(false);
      }
    })();
  }, [selectedEntity, reloadSnapshot, showUndo]);

  const onUndo = useCallback(() => {
    if (!undoSnapshot) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    void (async () => {
      try {
        await restoreEntitySnapshot(undoSnapshot);
        await reloadSnapshot();
        void syncEntities().catch(() => undefined);
      } catch {
        // ignore
      } finally {
        setUndoVisible(false);
        setUndoSnapshot(null);
      }
    })();
  }, [undoSnapshot, reloadSnapshot]);

  const loadRejections = useCallback(async () => {
    try {
      const list = await listEntityRejections();
      setRejections(
        list.map((r) => ({ kind: r.kind, name: r.name, nameKey: r.nameKey, updatedAt: r.updatedAt })),
      );
    } catch {
      setRejections([]);
    }
  }, []);

  // rejeicoes carregadas ao abrir a memoria (chamado no onPress)

  const onAddRejection = useCallback(() => {
    const name = rejectionName.trim();
    if (!name) return;
    void (async () => {
      try {
        await addEntityRejection(rejectionKind, name);
        setRejectionName('');
        await loadRejections();
        void syncEntities().catch(() => undefined);
      } catch {
        // ignore
      }
    })();
  }, [rejectionName, rejectionKind, loadRejections]);

  const onRemoveRejection = useCallback(
    (kind: EntityKind, name: string) => {
      void (async () => {
        try {
          await removeEntityRejection(kind, name);
          await loadRejections();
          void syncEntities().catch(() => undefined);
        } catch {
          // ignore
        }
      })();
    },
    [loadRejections],
  );

  const sheetHeader = (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetTitleRow}>
        {selectedEntity ? (
          <Press
            style={[
              styles.entityDot,
              { backgroundColor: graphColors[selectedEntity.kind] },
            ]}
            onPress={() => {
              setActionSheetExpandedType(false);
              setActionSheetOpen(true);
            }}
            accessibilityLabel="Editar entidade"
          >
            <GraphIcon
              kind={selectedEntity.kind}
              icon={selectedEntity.icon}
              size={16}
              color={theme.bg}
            />
          </Press>
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
            // A folha fica onde o usuario deixou: nao muda o espaco do grafo.
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
      <View style={styles.graphWindow} pointerEvents="box-none">
        {visible ? (
          <Animated.View style={[styles.graphLayer, slideStyle]}>
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
                viewportBottom={Math.round(height)}
                selectedId={selectedId}
                focusMode={Boolean(focusId)}
                kinds={kinds}
                onSelect={selectNode}
              />
            </Profiler>
          </Animated.View>
        ) : null}
      </View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.veil,
          { bottom: 0, backgroundColor: theme.bg },
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
            onPress={() => {
              setMemoryOpen(true);
              void loadRejections();
            }}
            style={styles.iconButton}
            accessibilityLabel="Memória"
          >
            <Ionicons name="book-outline" size={20} color={theme.text} />
          </Press>
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
          style={[styles.mapBack, { bottom: spacing.sm }]}
          onPress={resetToMap}
          accessibilityRole="button"
          accessibilityLabel="Voltar ao mapa inteiro"
        >
          <Ionicons name="chevron-back" size={13} color={theme.text} />
          <Text style={styles.mapBackText}>Mapa</Text>
        </Press>
      ) : null}

      <View style={[styles.zoom, { bottom: spacing.sm }]}>
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
              bottom: Math.round(height * (1 - 0)),
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

      {sheetHeader}

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
        onKind={onKind}
        onLabel={onLabel}
        onDelete={onDelete}
      />

      <EntityActionSheet
        entity={selectedEntity}
        visible={actionSheetOpen}
        busy={editorBusy}
        error={editorError}
        onClose={() => setActionSheetOpen(false)}
        onOpenName={() => {
          setActionSheetOpen(false);
          setEditorOpen(true);
        }}
        onOpenIcon={() => {
          setActionSheetOpen(false);
          setEditorOpen(true);
        }}
        onClaimSelf={onClaimSelf}
        onKind={onKind}
        onLabel={onLabel}
        onDelete={onDelete}
        initialExpandedType={actionSheetExpandedType}
      />

      {undoVisible ? (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>{undoLabel}</Text>
          <Press onPress={onUndo} accessibilityLabel="Desfazer">
            <Text style={styles.snackbarAction}>Desfazer</Text>
          </Press>
        </View>
      ) : null}

      <BottomSheet visible={memoryOpen} onClose={() => setMemoryOpen(false)} cardStyle={styles.memoryCard}>
        <View style={styles.memoryHeader}>
          <Text style={styles.memoryTitle}>Memória</Text>
        </View>
        <Text style={styles.memoryNote}>O script barra antes de gravar.</Text>
        <View style={styles.memoryAddRow}>
          <View style={styles.memoryPills}>
            {(['person', 'place', 'theme', 'decision'] as EntityKind[]).map((k) => (
              <Press
                key={k}
                style={[styles.memoryPill, rejectionKind === k ? styles.memoryPillActive : null]}
                onPress={() => setRejectionKind(k)}
                accessibilityRole="button"
                accessibilityLabel={kindLabel(k)}
              >
                <Text
                  style={[
                    styles.memoryPillText,
                    rejectionKind === k ? styles.memoryPillTextActive : null,
                  ]}
                >
                  {kindLabel(k)}
                </Text>
              </Press>
            ))}
          </View>
          <TextInput
            style={styles.memoryInput}
            value={rejectionName}
            onChangeText={setRejectionName}
            placeholder="nome"
            placeholderTextColor={theme.textTertiary}
            selectionColor={theme.accent}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={onAddRejection}
            accessibilityLabel="Nome rejeitado"
          />
          <Press
            style={styles.memoryAdd}
            onPress={onAddRejection}
            accessibilityLabel="Adicionar rejeição"
          >
            <Text style={styles.memoryAddText}>Adicionar</Text>
          </Press>
        </View>
        <Text style={styles.memoryNote}>nunca é {kindLabel(rejectionKind).toLowerCase()}</Text>
        <ScrollView style={styles.memoryList}>
          {rejections.map((r) => (
            <View key={`${r.kind}:${r.nameKey}`} style={styles.memoryRow}>
              <Text style={styles.memoryRowText}>
                {r.name} · {kindLabel(r.kind)}
              </Text>
              <Press
                onPress={() => onRemoveRejection(r.kind, r.name)}
                accessibilityLabel={`Remover ${r.name}`}
              >
                <Text style={styles.memoryRemove}>Remover</Text>
              </Press>
            </View>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const baseStyles = defineStyles({
  screen: { flex: 1, backgroundColor: baseColors.bg },
  graphWindow: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' },
  graphLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  // `pointerEvents` no estilo: no Animated.View o prop antigo nao segura o toque.
  veil: { position: 'absolute', left: 0, right: 0, top: 0, pointerEvents: 'none' },
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
  snackbar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: baseColors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
  },
  snackbarText: { color: baseColors.text, fontSize: fontSize.sm },
  snackbarAction: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  memoryCard: { gap: spacing.sm, maxHeight: '82%' },
  memoryHeader: { flexDirection: 'row', alignItems: 'center' },
  memoryTitle: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  memoryNote: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  memoryAddRow: { gap: spacing.xs },
  memoryPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  memoryPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: baseColors.neutralSoft,
  },
  memoryPillActive: { backgroundColor: baseColors.accentSoft },
  memoryPillText: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  memoryPillTextActive: { color: baseColors.accent },
  memoryInput: {
    height: 40,
    borderRadius: radius.md,
    backgroundColor: baseColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
    paddingHorizontal: spacing.md,
    color: baseColors.text,
    fontSize: fontSize.sm,
  },
  memoryAdd: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: baseColors.accentSoft,
  },
  memoryAddText: { color: baseColors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  memoryList: { maxHeight: 240 },
  memoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  memoryRowText: { color: baseColors.text, fontSize: fontSize.sm },
  memoryRemove: { color: baseColors.accent, fontSize: fontSize.xs, fontWeight: '600' },
});
