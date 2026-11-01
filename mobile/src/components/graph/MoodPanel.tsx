/**
 * Aba Humor do mapa: a serie de tom calculada no aparelho, sem rede.
 *
 * O desenho e uma linha unica de -1 a 1 com a data nas pontas; o numero medio
 * fica grande no topo, porque e o que o usuario quer comparar. Dias sem nota
 * nao existem na serie: o eixo e o das notas, nao o do calendario.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { Text } from '@/components/AppText';
import type { MoodPoint } from '@/core/graphMood';
import { averageMood, moodTrend } from '@/core/graphMood';
import { formatNoteDate } from '@/core/graphPanel';
import type { GraphColors } from '@/theme/graph';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface MoodPanelProps {
  series: MoodPoint[];
  colors: GraphColors;
  /** Entidade da serie: o tom e sobre ela, nao sobre a biblioteca toda. */
  subject?: string | null;
}

const CHART_HEIGHT = 168;
const PADDING_X = 18;
const PADDING_Y = 20;

export function MoodPanel({ series, colors, subject }: MoodPanelProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors: theme } = useTheme();
  const [width, setWidth] = useState(0);
  const average = useMemo(() => averageMood(series), [series]);
  const trend = useMemo(() => moodTrend(series), [series]);

  const geometry = useMemo(() => {
    if (width <= 0 || series.length === 0) return null;
    const innerW = Math.max(1, width - PADDING_X * 2);
    const innerH = CHART_HEIGHT - PADDING_Y * 2;
    const xAt = (index: number) =>
      series.length === 1 ? width / 2 : PADDING_X + (index / (series.length - 1)) * innerW;
    const yAt = (value: number) => PADDING_Y + ((1 - value) / 2) * innerH;
    const line = series
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index)},${yAt(point.sentiment)}`)
      .join('');
    const area = `${line}L${xAt(series.length - 1)},${yAt(0)}L${xAt(0)},${yAt(0)}Z`;
    return { xAt, yAt, line, area };
  }, [series, width]);

  const tone = average.sentiment;
  const toneColor =
    tone > 0.15 ? colors.moodPositive : tone < -0.15 ? colors.moodNegative : colors.moodNeutral;

  if (series.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>Sem notas</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.summary}>
        <Text style={[styles.average, { color: toneColor }]}>
          {tone >= 0 ? '+' : ''}
          {tone.toFixed(2)}
        </Text>
        <View style={styles.summaryText}>
          <Text style={styles.summaryTitle} numberOfLines={1}>
            {subject ? `Tom sobre ${subject}` : 'Tom médio'}
          </Text>
          <Text style={styles.summaryMeta}>
            {series.length > 1 ? (
              <Text style={{ color: trend > 0.05 ? colors.moodPositive : trend < -0.05 ? colors.moodNegative : theme.textTertiary }}>
                {trend >= 0 ? '+' : ''}
                {trend.toFixed(2)} desde o início ·{' '}
              </Text>
            ) : null}
            {average.notes} {average.notes === 1 ? 'nota' : 'notas'} · {series.length}{' '}
            {series.length === 1 ? 'dia' : 'dias'}
          </Text>
        </View>
      </View>

      <View
        style={styles.chart}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {geometry ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Line
              x1={PADDING_X}
              x2={width - PADDING_X}
              y1={geometry.yAt(0)}
              y2={geometry.yAt(0)}
              stroke={theme.border}
              strokeWidth={StyleSheet.hairlineWidth * 2}
            />
            <Path d={geometry.area} fill={`${toneColor}22`} />
            <Path d={geometry.line} stroke={toneColor} strokeWidth={2} fill="none" />
            {series.map((point, index) => (
              <Circle
                key={point.date}
                cx={geometry.xAt(index)}
                cy={geometry.yAt(point.sentiment)}
                r={series.length > 40 ? 1.8 : 3}
                fill={toneColor}
              />
            ))}
            <SvgText
              x={PADDING_X}
              y={CHART_HEIGHT - 4}
              fill={theme.textTertiary}
              fontSize={10}
            >
              {formatNoteDate(series[0].date)}
            </SvgText>
            {series.length > 1 ? (
              <SvgText
                x={width - PADDING_X}
                y={CHART_HEIGHT - 4}
                fill={theme.textTertiary}
                fontSize={10}
                textAnchor="end"
              >
                {formatNoteDate(series[series.length - 1].date)}
              </SvgText>
            ) : null}
          </Svg>
        ) : null}
      </View>

      <View style={styles.legend}>
        <View style={[styles.dot, { backgroundColor: colors.moodPositive }]} />
        <Text style={styles.legendText}>positivo</Text>
        <View style={[styles.dot, { backgroundColor: colors.moodNeutral }]} />
        <Text style={styles.legendText}>neutro</Text>
        <View style={[styles.dot, { backgroundColor: colors.moodNegative }]} />
        <Text style={styles.legendText}>negativo</Text>
      </View>
    </View>
  );
}

const baseStyles = defineStyles({
  wrap: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  average: {
    fontSize: fontSize.display,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.5,
  },
  summaryText: { gap: 2 },
  summaryTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  summaryMeta: { color: baseColors.textTertiary, fontSize: fontSize.sm },
  chart: { height: CHART_HEIGHT, width: '100%' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4, marginLeft: spacing.sm },
  legendText: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  emptyWrap: { padding: spacing.xxxl, alignItems: 'center' },
  empty: { color: baseColors.textTertiary, fontSize: fontSize.sm },
});
