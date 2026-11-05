/**
 * Detalhe de uma entidade do mapa, em tela propria.
 *
 * Abre ao tocar em uma bola do grafo. Mostra as estatísticas e os trechos
 * que provam a relação, igual ao painel que antes subia de baixo. Tocar
 * em "Voltar" retorna ao grafo inteiro.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { EntityDetail } from '@/components/graph/EntityDetail';
import type { EntityKind, GraphData, GraphNodeKind } from '@/core/graphModel';
import { kindLabel, splitNodeId } from '@/core/graphModel';
import type { EntityPanel } from '@/core/graphPanel';
import type { GraphSnapshot } from '@/services/graphData';
import {
  graphFromSnapshot,
  kindCounts,
  loadEntityPanel,
  loadGraphSnapshot,
  readCachedSnapshot,
  rememberSnapshot,
} from '@/services/graphData';
import { back, push } from '@/services/appNavigation';
import { useRenderCount } from '@/dev/perf';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { GRAPH_PALETTES } from '@/theme/graph';
import { useTheme } from '@/theme/ThemeContext';
import type { ThemeName } from '@/theme/tokens';

const SNAPSHOT_FRESH_MS = 20_000;

type MapEntityParams = { id: string };

export default function MapEntityScreen() {
  useRenderCount('MapEntityScreen');
  const { colors: theme, name: themeName } = useTheme();
  const graphColors = GRAPH_PALETTES[themeName as ThemeName];
  const params = useLocalSearchParams<MapEntityParams>();
  const entityId = params.id;

  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<EntityPanel | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const mounted = useRef(true);
  const panelSeq = useRef(0);

  const data = useMemo(() => {
    if (!snapshot) return null;
    return graphFromSnapshot(snapshot, {
      nodeLimit: 120,
      edgesPerNode: 6,
      noteLimit: 120,
    });
  }, [snapshot]);

  const counts = useMemo(() => {
    if (!data) return { person: 0, place: 0, theme: 0, decision: 0 };
    return kindCounts(data);
  }, [data]);
  const entityTotal = counts ? Object.values(counts).reduce((s, v) => s + v, 0) : 0;

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `entity:${entityId}`;
    let cachedSnapshot: GraphSnapshot | null = null;
    let snapshotCacheValue: { key: string; at: number; snapshot: GraphSnapshot } | null = null;

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
        snapshotCacheValue = { key: cacheKey, at: Date.now(), snapshot: next };
        if (!sameSnapshot(cachedSnapshot, next)) setSnapshot(next);
        setLoading(false);
        void hydratePanel(next);
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        setError('Não foi possível carregar o mapa.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entityId]);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

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

  function splitNodeId(id: string): { kind: GraphNodeKind; id: string } | null {
    const sep = id.indexOf(':');
    if (sep <= 0) return null;
    const kind = id.slice(0, sep) as GraphNodeKind;
    const nid = id.slice(sep + 1);
    return { kind, id: nid };
  }

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

  if (!data || !entity) return null;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Press onPress={back} style={styles.backButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={20} color={theme.text} />
          <Text style={styles.backText}>Mapa</Text>
        </Press>
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
        <Press
          onPress={() => push(`/note/${entity.id}`)}
          style={styles.openNoteButton}
          accessibilityLabel="Abrir nota"
        >
          <Ionicons name="arrow-forward" size={14} color={theme.accent} />
        </Press>
      </View>

      {panelLoading || !panel ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <EntityDetail
          panel={panel}
          colors={graphColors}
          snap={0}
          onOpenNote={(entryId) => push(`/note/${entryId}`)}
          onRename={() => {}}
          onIcon={() => {}}
          onClaimSelf={() => {}}
        />
      )}
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
    paddingTop: 10,
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: baseColors.danger, fontSize: fontSize.sm, paddingHorizontal: spacing.md },
});
