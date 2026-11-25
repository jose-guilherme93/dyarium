/**
 * Esqueletos de carregamento da tela da entidade.
 *
 * Estáticos, sem shimmer: animação em loop custa um quadro por frame e derruba
 * o scroll na tela do grafo, que já trabalha no limite de memória do aparelho. A
 * geometria espelha os blocos reais (MoodPanel, EntityDetail e GraphCanvas)
 * para que o conteúdo não pule quando chegar.
 */

import { StyleSheet, View } from 'react-native';

import { baseColors, radius, spacing } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

/** Altura do gráfico do MoodPanel (mesma do componente real). */
const CHART_HEIGHT = 168;
/** Altura da área do mapa (GraphCanvas usa o espaço inteiro, fixamos em 420). */
const GRAPH_HEIGHT = 420;

/** Pontos fixos do traço fantasma no gráfico de humor. */
const GHOST_DOTS = [
  { left: '12%', top: 96 },
  { left: '30%', top: 68 },
  { left: '48%', top: 112 },
  { left: '66%', top: 62 },
  { left: '82%', top: 90 },
] as const;

/** Posições e diâmetros fixos das bolas fantasmas do mapa. */
const GHOST_BALLS = [
  { left: '44%', top: 176, size: 34 },
  { left: '68%', top: 100, size: 22 },
  { left: '18%', top: 264, size: 18 },
  { left: '26%', top: 82, size: 14 },
  { left: '58%', top: 292, size: 26 },
  { left: '78%', top: 196, size: 16 },
] as const;

// ---------------------------------------------------------------------------
// MoodSkeleton — espelha MoodPanel.tsx
// ---------------------------------------------------------------------------

export function MoodSkeleton() {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.wrap} accessibilityLabel="Carregando" accessibilityRole="progressbar">
      {/* linha de resumo: número grande + duas linhas curtas */}
      <View style={styles.summary}>
        <View style={styles.averageBlock} />
        <View style={styles.summaryLines}>
          <View style={styles.titleLine} />
          <View style={styles.metaLine} />
        </View>
      </View>

      {/* área do gráfico de 168 px, com traço fantasma */}
      <View style={styles.chart}>
        <View style={styles.ghostBaseline} />
        {GHOST_DOTS.map((dot, index) => (
          <View key={index} style={[styles.ghostDot, { left: dot.left, top: dot.top }]} />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// DetailSkeleton — espelha EntityDetail.tsx
// ---------------------------------------------------------------------------

export function DetailSkeleton() {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.detailWrap} accessibilityLabel="Carregando" accessibilityRole="progressbar">
      {/* 3 caixas de estatística lado a lado */}
      <View style={styles.stats}>
        <View style={styles.statBox} />
        <View style={styles.statBox} />
        <View style={styles.statBox} />
      </View>

      {/* linha curta: "Visto em" */}
      <View style={styles.seenLine} />

      {/* 2 pílulas de ações */}
      <View style={styles.actions}>
        <View style={styles.pill} />
        <View style={styles.pill} />
      </View>

      {/* rótulo de seção */}
      <View style={styles.sectionLabelBlock} />

      {/* 2 grupos: título + 2 linhas cada */}
      <View style={styles.group}>
        <View style={styles.groupTitleLine} />
        <View style={styles.excerptLine} />
        <View style={styles.excerptLineShort} />
      </View>

      <View style={styles.group}>
        <View style={styles.groupTitleLine} />
        <View style={styles.excerptLine} />
        <View style={styles.excerptLineShort} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// GraphSkeleton — espelha a área do GraphCanvas (420 px de altura)
// ---------------------------------------------------------------------------

export function GraphSkeleton() {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.graphWrap} accessibilityLabel="Carregando" accessibilityRole="progressbar">
      {GHOST_BALLS.map((ball, index) => (
        <View
          key={index}
          style={[
            styles.ghostBall,
            {
              left: ball.left,
              top: ball.top,
              width: ball.size,
              height: ball.size,
              borderRadius: ball.size / 2,
            },
          ]}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const baseStyles = defineStyles({
  // --- mood ---
  wrap: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  averageBlock: {
    width: 104,
    height: 76,
    borderRadius: radius.sm,
    backgroundColor: baseColors.neutralSoft,
  },
  summaryLines: { flex: 1, gap: 6 },
  titleLine: { height: 18, width: '72%', borderRadius: radius.sm, backgroundColor: baseColors.neutralSoft },
  metaLine: { height: 16, width: '54%', borderRadius: radius.sm, backgroundColor: baseColors.border },
  chart: { height: CHART_HEIGHT, width: '100%', position: 'relative' },
  ghostBaseline: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: CHART_HEIGHT / 2,
    height: StyleSheet.hairlineWidth,
    backgroundColor: baseColors.border,
  },
  ghostDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: baseColors.border },

  // --- detail ---
  detailWrap: { paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxxl },
  stats: { flexDirection: 'row', gap: spacing.sm },
  statBox: { flex: 1, height: 48, borderRadius: radius.md, backgroundColor: baseColors.surface },
  seenLine: { height: 14, width: 96, borderRadius: radius.sm, backgroundColor: baseColors.border },
  actions: { flexDirection: 'row', gap: spacing.xs },
  pill: { height: 28, width: 96, borderRadius: radius.pill, backgroundColor: baseColors.neutralSoft },
  sectionLabelBlock: {
    height: 12,
    width: 72,
    borderRadius: radius.sm,
    backgroundColor: baseColors.border,
    marginTop: spacing.xs,
  },
  group: {
    gap: 6,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  groupTitleLine: { height: 18, borderRadius: radius.sm, backgroundColor: baseColors.neutralSoft },
  excerptLine: { height: 20, borderRadius: radius.sm, backgroundColor: baseColors.border },
  excerptLineShort: { height: 20, width: '62%', borderRadius: radius.sm, backgroundColor: baseColors.border },

  // --- graph ---
  graphWrap: { height: GRAPH_HEIGHT, width: '100%', position: 'relative' },
  ghostBall: { position: 'absolute', backgroundColor: baseColors.border },
});
