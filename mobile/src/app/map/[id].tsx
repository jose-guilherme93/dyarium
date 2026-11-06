/**
 * Detalhe de uma entidade do mapa, em tela propria.
 *
 * Abre ao tocar em uma bola do grafo. Mostra as estatísticas e os trechos
 * que provam a relação, com o grafo focado nessa entidade abaixo das
 * informações. Tocar em "Voltar" retorna ao grafo inteiro.
 *
 * Ordem visual: header (nome), grafico de humor (quando houver), depois
 * o restante das informacoes (estatisticas e trechos), e por fim o grafo
 * das relacoes dessa entidade.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, ScrollView } from 'react-native';
import { useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { EntityDetail } from '@/components/graph/EntityDetail';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/graph/GraphCanvas';
import { MoodPanel } from '@/components/graph/MoodPanel';
import type { EntityKind, GraphNodeKind } from '@/core/graphModel';
import { kindLabel, splitNodeId } from '@/core/graphModel';
import type { MoodPoint } from '@/core/graphMood';
import { buildEntityMood } from '@/core/graphMood';
import type { EntityPanel } from '@/core/graphPanel';
import type { GraphSnapshot } from '@/services/graphData';
import {
  graphFromSnapshot,
  layoutSeeded,
  loadEntityPanel,
  loadGraphSnapshot,
  readCachedSnapshot,
} from '@/services/graphData';
import { back, push } from '@/services/appNavigation';
import { useRenderCount } from '@/dev/perf';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { GRAPH_PALETTES } from '@/theme/graph';
import { useTheme } from '@/theme/ThemeContext';
import type { ThemeName } from '@/theme/tokens';

type MapEntityParams = { id: string };

export default function MapEntityScreen() {
  useRenderCount('MapEntityScreen');
  const { colors: theme, name: themeName } = useTheme();
  const graphColors = GRAPH_PALETTES[themeName as ThemeName];
  const params = useLocalSearchParams<MapEntityParams>();
  const rawId = params.id;
  const entityId = Array.isArray(rawId) ? (rawId[0] ?? '') : (rawId ?? '');
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<EntityPanel | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [moodSeries, setMoodSeries] = useState<MoodPoint[] | null>(null);
  const mounted = useRef(true);
  const panelSeq = useRef(0);
  const canvasRef = useRef<GraphCanvasHandle>(null);

  const data = useMemo(() => {
    if (!snapshot) return null;
    return graphFromSnapshot(snapshot, {
      nodeLimit: 120,
      edgesPerNode: 6,
      noteLimit: 120,
    });
  }, [snapshot]);

  const focusLayout = useMemo(() => {
    if (!data || !entityId) return null;
    return layoutSeeded(data, entityId, null);
  }, [data, entityId]);

  const graphData = useMemo(() => {
    if (!data || !focusLayout) return null;
    return { data, layout: focusLayout };
  }, [data, focusLayout]);

  const graphKinds = useMemo(
    () => new Set<EntityKind>(['person', 'place', 'theme', 'decision']),
    [],
  );

  const hydratePanel = useCallback(
    (snap: GraphSnapshot) => {
      const parsed = splitNodeId(entityId);
      const eid = parsed?.kind && parsed.kind !== 'user' ? parsed.id : null;
      if (!eid) {
        setPanel(null);
        setPanelLoading(false);
        return;
      }
      const seq = panelSeq.current + 1;
      panelSeq.current = seq;
      loadEntityPanel(snap, eid).then((p) => {
        if (panelSeq.current === seq && mounted.current) setPanel(p);
        setPanelLoading(false);
      });
    },
    [entityId],
  );

  useEffect(() => {
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

    let cancelled = false;
    const cacheKey = `entity:${entityId}`;
    let cachedSnapshot: GraphSnapshot | null = null;

    readCachedSnapshot(cacheKey).then((cached) => {
      if (cancelled || !mounted.current) return;
      cachedSnapshot = cached;
      if (cached) {
        setSnapshot(cached);
        setLoading(false);
      }
    });

    loadGraphSnapshot({})
      .then((next) => {
        if (cancelled || !mounted.current || !next) return;
        if (!sameSnapshot(cachedSnapshot, next)) setSnapshot(next);
        setLoading(false);
        void hydratePanel(next);
        const parsed = splitNodeId(entityId);
        const eid = parsed?.kind && parsed.kind !== 'user' ? parsed.id : null;
        if (eid) {
          const series = buildEntityMood(next.links, next.entries, eid);
          if (mounted.current) setMoodSeries(series);
        }
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        setError('Não foi possível carregar o mapa.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entityId, hydratePanel]);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
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

  if (loading || error) {
    return (
      <View style={styles.screen}>
        {error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : (
          <ActivityIndicator color={theme.accent} />
        )}
      </View>
    );
  }

  // Sem dados ou sem entidade reconhecida: ainda assim mostra o grafo focado,
  // para a nao ficar em branco quando o no saiu do recorte.
  if (!data) return null;

  // Largura disponível para o grafo: tela inteira menos padding dos lados.
  const graphWidth = Math.max(300, screenWidth - spacing.sm * 2);
  // Altura generosa para o grafo da relação ficar visível e usável.
  const graphHeight = 420;

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
        ) : null}
        {entity ? (
          <Press
            onPress={() => push(`/note/${entity.id}`)}
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
        {/* Grafico de humor primeiro, quando houver dados. */}
        {moodSeries && moodSeries.length > 0 ? (
          <View style={styles.moodSection}>
            <MoodPanel series={moodSeries} colors={graphColors} subject={entity?.name ?? null} />
          </View>
        ) : null}

        {/* Restante das informacoes: estatisticas e trechos.
             scrollEnabled={false} para nao aninhar FlatList dentro do ScrollView externo. */}
        {panelLoading || !panel ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
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
            />
          </View>
        )}

        {/* Grafo focado nesta entidade: aparece como ultima secao da tela,
            depois de todas as informacoes. */}
        {graphData && (
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
              kinds={graphKinds}
              onSelect={(id) => {
                if (id && id !== 'user' && id !== entityId) {
                  push(`/map/${id}`);
                }
              }}
            />
          </View>
        )}
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
