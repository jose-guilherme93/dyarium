/**
 * Detalhe de uma entidade do mapa, em tela propria.
 *
 * Abre ao tocar em uma bola do grafo. A tela carrega em tres camadas, nesta
 * ordem, porque e a ordem em que o usuario le:
 *
 * 1. humor -- sai direto das ligacoes que ja vieram no recorte do mapa;
 * 2. referencias -- os trechos das notas e das transcricoes ligadas a entidade,
 *    lidos do banco em paginas de 15, com "Ver mais" no fim da lista;
 * 3. o grafo focado nesta entidade -- montado so quando a camada 2 assenta,
 *    para nao aparecer antes das informacoes nem disputar quadro com elas.
 *
 * Enquanto uma camada nao chega, o lugar dela fica reservado por um esqueleto:
 * o conteudo nao aparece do nada e a tela nao pula.
 *
 * Ordem visual: header (nome), grafico de humor (quando houver), depois
 * o restante das informacoes (estatisticas e trechos), e por fim o grafo
 * das relacoes dessa entidade.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { EntityDetail } from '@/components/graph/EntityDetail';
import { DetailSkeleton, GraphSkeleton, MoodSkeleton } from '@/components/graph/EntitySkeletons';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/graph/GraphCanvas';
import { MoodPanel } from '@/components/graph/MoodPanel';
import { buildEntityPreview } from '@/core/graphBuild';
import { layoutRelationPreview } from '@/core/graphLayout';
import type { EntityKind } from '@/core/graphModel';
import { kindLabel, splitNodeId } from '@/core/graphModel';
import type { MoodPoint } from '@/core/graphMood';
import { buildEntityMood } from '@/core/graphMood';
import type { EntityPanel } from '@/core/graphPanel';
import { resolveNoteId } from '@/core/graphPanel';
import type { GraphSnapshot } from '@/services/graphData';
import {
  ENTITY_PANEL_MORE,
  ENTITY_PANEL_PAGE,
  graphFromSnapshot,
  loadEntityPanel,
  loadGraphSnapshot,
  readSessionSnapshot,
} from '@/services/graphData';
import { back, push } from '@/services/appNavigation';
import { useLibrary } from '@/state/LibraryContext';
import { useRenderCount } from '@/dev/perf';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { GRAPH_PALETTES } from '@/theme/graph';
import { useTheme } from '@/theme/ThemeContext';
import type { ThemeName } from '@/theme/tokens';

type MapEntityParams = { id: string };

/** Recortes so com contagens iguais: evita reler o painel sem motivo. */
function sameSnapshot(a: GraphSnapshot | null, b: GraphSnapshot | null): boolean {
  if (!a || !b) return false;
  return (
    a.entries.length === b.entries.length &&
    a.links.length === b.links.length &&
    a.entities.length === b.entities.length &&
    a.total === b.total &&
    a.analyzed === b.analyzed
  );
}

/** Bloco do cabecalho enquanto o nome ainda nao chegou. */
function HeaderSkeleton() {
  return (
    <View style={styles.titleWrapper}>
      <View style={[styles.entityDot, styles.skeletonBlock]} />
      <View style={styles.titleTextWrapper}>
        <View style={[styles.skeletonLine, { width: '58%', height: 14 }]} />
        <View style={[styles.skeletonLine, { width: '34%', height: 10, marginTop: 5 }]} />
      </View>
    </View>
  );
}

export default function MapEntityScreen() {
  useRenderCount('MapEntityScreen');
  const library = useLibrary();
  const { colors: theme, name: themeName } = useTheme();
  const graphColors = GRAPH_PALETTES[themeName as ThemeName];
  const params = useLocalSearchParams<MapEntityParams>();
  const rawId = params.id;
  const entityId = Array.isArray(rawId) ? (rawId[0] ?? '') : (rawId ?? '');
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const entityKey = useMemo(() => {
    const parsed = splitNodeId(entityId);
    return parsed?.kind && parsed.kind !== 'user' && parsed.kind !== 'note' ? parsed.id : null;
  }, [entityId]);

  // O mapa acabou de ler a biblioteca: o recorte da sessao ja pinta no primeiro
  // quadro, sem tocar no banco e sem esperar efeito nenhum.
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(() =>
    readSessionSnapshot({}),
  );
  const [error, setError] = useState<string | null>(null);
  // Camada 1: humor, calculado do recorte inicial.
  const [moodSeries, setMoodSeries] = useState<MoodPoint[] | null>(() => {
    const cached = readSessionSnapshot({});
    if (!cached || !entityKey) return null;
    return buildEntityMood(cached.links, cached.entries, entityKey);
  });
  // Camada 2: referencias, em paginas de 15.
  const [panel, setPanel] = useState<EntityPanel | null>(null);
  const [hasMoreItems, setHasMoreItems] = useState(false);
  // Nota ou dono nao tem painel: a camada 2 ja nasce assentada.
  const [panelSettled, setPanelSettled] = useState(!entityKey);
  const [panelLimit, setPanelLimit] = useState(ENTITY_PANEL_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const mounted = useRef(true);
  const snapshotRef = useRef<GraphSnapshot | null>(snapshot);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const openedAt = useRef(0);
  const graphLogged = useRef(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const setMoodFrom = useCallback(
    (snap: GraphSnapshot) => {
      if (!entityKey) return;
      const series = buildEntityMood(snap.links, snap.entries, entityKey);
      if (mounted.current) setMoodSeries(series);
    },
    [entityKey],
  );

  // O recorte fresco troca o da sessao quando algo mudou; se for o mesmo
  // objeto, nada re-renderiza. Todas as camadas leem deste snapshot.
  useEffect(() => {
    openedAt.current = Date.now();
    graphLogged.current = false;
    // O mapa ja leu a biblioteca e e ele que a mantem atualizada. Reler aqui
    // custava ~1 s de JSON no SQLite a cada bola aberta, sem mudar o desenho:
    // as notas da camada 2 vem frescas do banco de qualquer jeito. So uma
    // abertura sem mapa (link direto, notificacao) paga a leitura.
    if (snapshotRef.current) return undefined;

    let cancelled = false;
    loadGraphSnapshot({})
      .then((next) => {
        if (cancelled || !mounted.current || !next) return;
        setSnapshot((current) => (sameSnapshot(current, next) ? current : next));
        setMoodFrom(next);
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        // Com o recorte da sessao a tela segue util; sem ele, o erro e a unica
        // informacao verdadeira (o render decide por `snapshot`).
        if (!snapshotRef.current) setError('Não foi possível carregar o mapa.');
      });

    return () => {
      cancelled = true;
    };
  }, [entityId, setMoodFrom]);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  // Camada 2: so as notas da entidade, so a pagina atual. O servico guarda o
  // recorte em memoria, entao voltar ao mesmo no nao relê o banco.
  useEffect(() => {
    if (!snapshot || !entityKey) return undefined;
    let cancelled = false;
    loadEntityPanel(snapshot, entityKey, { limit: panelLimit })
      .then((page) => {
        if (cancelled || !mounted.current) return;
        setPanel(page.panel);
        setHasMoreItems(page.hasMore);
      })
      .catch(() => {
        // Sem o painel ainda da para mostrar o humor e o grafo; o que nao pode
        // e o esqueleto ficar preso para sempre.
        if (cancelled || !mounted.current) return;
        setPanel(null);
        setHasMoreItems(false);
      })
      .finally(() => {
        if (cancelled || !mounted.current) return;
        setPanelSettled(true);
        setLoadingMore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot, entityKey, panelLimit]);

  const onLoadMore = useCallback(() => {
    setLoadingMore(true);
    setPanelLimit((current) => current + ENTITY_PANEL_MORE);
  }, []);

  const entity = useMemo(() => {
    if (!snapshot || !entityId) return null;
    const parsed = splitNodeId(entityId);
    if (!parsed || parsed.kind === 'user') return null;
    return snapshot.entities.find(
      (item) => item.kind === parsed.kind && item.id === parsed.id,
    );
  }, [snapshot, entityId]);

  const stats = useMemo(() => {
    if (!entity || !snapshot) return null;
    const links = snapshot.links.filter((l) => l.entityId === entity.id);
    const keys = [...new Set(links.map((l) => l.entryId))];
    const notes = keys.filter((k) => snapshot.entryByKey[k]);
    return { links, notes };
  }, [snapshot, entity]);

  // Camada 3: o grafo focado so entra depois que a camada 2 assenta. Antes
  // disso ele aparecia primeiro e "do nada", disputando espaco com o spinner.
  const graphReady = panelSettled;

  // Largura/altura antes do desenho: o layout da previa e em pixels de tela,
  // porque o nome tem tamanho fixo.
  // Largura disponível para o grafo: tela inteira menos padding dos lados.
  const graphWidth = Math.max(300, screenWidth - spacing.sm * 2);
  // Altura generosa para o grafo da relação: os nomes embaixo de cada bola
  // precisam de espaço e são o conteúdo da prévia.
  const graphHeight = 560;

  // So a entidade e as relacoes dela -- ate 25, sem o corte de parceiros do
  // mapa. O desenho e uma elipse com espaco para o nome de cada bola.
  const data = useMemo(
    () => (snapshot && graphReady && entityId ? buildEntityPreview(snapshot, entityId, 25) : null),
    [snapshot, graphReady, entityId],
  );

  const focusLayout = useMemo(
    () => (data ? layoutRelationPreview(data) : null),
    [data],
  );

  const graphData = useMemo(() => {
    if (!data || !focusLayout) return null;
    return { data, layout: focusLayout };
  }, [data, focusLayout]);

  useEffect(() => {
    if (!graphData || graphLogged.current) return;
    graphLogged.current = true;
    if (__DEV__) {
      console.log(`[entity] grafo pronto em ${Date.now() - openedAt.current}ms`);
    }
  }, [graphData]);

  const graphKinds = useMemo(
    () => new Set<EntityKind>(['person', 'place', 'theme', 'decision']),
    [],
  );

  // Nota mais recente que cita a entidade, resolvida para a chave local do
  // registro. Antes o botao mandava o id da entidade do grafo para /note e a
  // tela respondia "Nota nao encontrada".
  const targetNote = useMemo(
    () => resolveNoteId(panel, library.recordings),
    [panel, library.recordings],
  );

  if (error && !snapshot) {
    return (
      <View style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Press onPress={back} style={styles.backButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={20} color={theme.text} />
          <Text style={styles.backText}>Mapa</Text>
        </Press>
        {entity ? (
          <View style={styles.titleWrapper}>
            <View style={[styles.entityDot, { backgroundColor: graphColors[entity.kind] }]}>
              <Ionicons
                name={entity.kind === 'place' ? 'home' : entity.kind === 'theme' ? 'pricetag' : entity.kind === 'decision' ? 'checkmark' : 'person'}
                size={16}
                color={theme.bg}
              />
            </View>
            <View style={styles.titleTextWrapper}>
              <Text style={styles.title}>{entity.name}</Text>
              <Text style={styles.meta}>
                {kindLabel(entity.kind)} · {stats?.notes.length} notas
              </Text>
            </View>
          </View>
        ) : (
          <HeaderSkeleton />
        )}
        {targetNote ? (
          <Press
            onPress={() => push(`/note/${targetNote}`)}
            style={styles.openNoteButton}
            accessibilityLabel="Abrir nota"
          >
            <Ionicons name="arrow-forward" size={14} color={theme.accent} />
          </Press>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ ...styles.scrollContent, flexGrow: 1, minHeight: 800 }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={false}
      >
        {/* Camada 1: humor. Enquanto o recorte nao chega, o esqueleto reserva
            o lugar do resumo e do grafico. */}
        {!snapshot ? (
          <MoodSkeleton />
        ) : moodSeries && moodSeries.length > 0 ? (
          <View style={styles.moodSection}>
            <MoodPanel series={moodSeries} colors={graphColors} subject={entity?.name ?? null} />
          </View>
        ) : null}

        {/* Camada 2: estatisticas e trechos, em paginas de 15. */}
        {panel ? (
          // O EntityDetail usa FlatList: dentro do ScrollView externo precisa
          // de um container com altura minima para nao colapsar e esconder o
          // grafo que vem a seguir.
          <View style={styles.detailWrapper}>
            <EntityDetail
              panel={panel}
              colors={graphColors}
              snap={0}
              onOpenNote={(entryId) => push(`/note/${entryId}`)}
              onRename={() => {}}
              onIcon={() => {}}
              onClaimSelf={() => {}}
              scrollEnabled={false}
              hasMore={hasMoreItems}
              onLoadMore={onLoadMore}
              loadingMore={loadingMore}
            />
          </View>
        ) : !panelSettled ? (
          <DetailSkeleton />
        ) : null}

        {/* Camada 3: o grafo focado nesta entidade, por ultimo. */}
        {!graphReady ? (
          <View style={styles.graphSection}>
            <GraphSkeleton />
          </View>
        ) : graphData ? (
          <View style={[styles.graphSection, { height: graphHeight }]}>
            <GraphCanvas
              ref={canvasRef}
              data={graphData.data}
              layout={graphData.layout}
              colors={graphColors}
              width={graphWidth}
              height={graphHeight}
              viewportTop={0}
              viewportBottom={0}
              selectedId={entityId || null}
              focusMode={false}
              interactive={false}
              showLabels
              kinds={graphKinds}
              onSelect={(id) => {
                if (id && id !== 'user' && id !== entityId) {
                  push(`/map/${id}`);
                }
              }}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: baseColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { color: baseColors.text, fontSize: fontSize.xs, fontWeight: '600' },
  titleWrapper: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entityDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTextWrapper: { flex: 1 },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  meta: { color: baseColors.textSecondary, fontSize: fontSize.xs },
  openNoteButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  skeletonBlock: { backgroundColor: baseColors.neutralSoft },
  skeletonLine: {
    borderRadius: radius.sm,
    backgroundColor: baseColors.neutralSoft,
  },
  scrollContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  center: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  error: { color: baseColors.danger, fontSize: fontSize.sm, paddingHorizontal: spacing.md },
  graphSection: {
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
    paddingTop: spacing.sm,
  },
  detailWrapper: { minHeight: 220 },
  moodSection: {
    marginTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
