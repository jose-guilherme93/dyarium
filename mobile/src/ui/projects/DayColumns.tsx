import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DayBucket } from '@/core/projetoLog';
import {
  designChart,
  designRadius,
  designSpace,
  designTree,
} from '@/theme/design';

import { useDesign } from '../useDesign';
import { itensLabel, shortDate } from './format';
import { typeStyles } from './texts';

export interface DayColumnsProps {
  /** Serie por dia de calendario; dia sem item entra como slot vazio. */
  series: DayBucket[];
  testIdPrefix?: string;
}

/**
 * Colunas por dia de calendario, no eixo real: dia sem item continua slot
 * vazio e o grafico nao estica. Sem eixo y; rotulos so nas pontas. Um toque
 * escolhe o dia e a leitura abaixo mostra `13 nov · 3 itens`. Ocupa a largura
 * inteira, sem rolagem horizontal.
 */
export function DayColumns({ series, testIdPrefix = 'chart' }: DayColumnsProps) {
  const colors = useDesign();
  const [selected, setSelected] = useState<string | null>(null);

  if (series.length === 0) return null;

  const plotH = designChart.base - designChart.top;
  const yMax = Math.max(1, ...series.map((bucket) => bucket.items));
  const lastWithData =
    [...series].reverse().find((bucket) => bucket.items > 0) ?? series[series.length - 1];
  const readDate = selected ?? lastWithData.date;
  const readBucket = series.find((bucket) => bucket.date === readDate) ?? lastWithData;
  const midIndex = Math.floor((series.length - 1) / 2);

  return (
    <View style={styles.wrap}>
      <View style={styles.plot}>
        <View style={styles.slots}>
          {series.map((bucket) => {
            const isSelected = bucket.date === readDate;
            const barH =
              bucket.items > 0
                ? Math.max(designChart.barMin, (bucket.items / yMax) * plotH)
                : 0;
            return (
              <Pressable
                key={bucket.date}
                testID={`${testIdPrefix}-slot-${bucket.date}`}
                accessibilityRole="button"
                accessibilityLabel={`${shortDate(bucket.date)} · ${itensLabel(bucket.items)}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelected(bucket.date)}
                style={styles.slot}
              >
                {bucket.items > 0 ? (
                  <View
                    style={[styles.bar, { height: barH, backgroundColor: colors.primary }]}
                  />
                ) : (
                  <View
                    testID={`${testIdPrefix}-empty-${bucket.date}`}
                    style={[styles.bar, styles.empty, { backgroundColor: colors.surfaceAlt }]}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.baseline, { backgroundColor: colors.line }]} />
        <View style={styles.labels}>
          {series.length === 1 ? (
            <Text
              style={[typeStyles.mono, styles.labelStart, styles.labelCenter, { color: colors.textMuted }]}
            >
              {shortDate(series[0].date)}
            </Text>
          ) : (
            <>
              <Text style={[typeStyles.mono, styles.labelStart, { color: colors.textMuted }]}>
                {shortDate(series[0].date)}
              </Text>
              {series.length >= 8 ? (
                <Text
                  style={[typeStyles.mono, styles.labelMid, { color: colors.textMuted }]}
                >
                  {shortDate(series[midIndex].date)}
                </Text>
              ) : null}
              <Text style={[typeStyles.mono, styles.labelEnd, { color: colors.textMuted }]}>
                {shortDate(series[series.length - 1].date)}
              </Text>
            </>
          )}
        </View>
      </View>
      <Text
        testID={`${testIdPrefix}-read`}
        style={[typeStyles.mono, styles.read, { color: colors.textMuted }]}
        numberOfLines={1}
      >
        {`${shortDate(readBucket.date)} · ${itensLabel(readBucket.items)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: designSpace.s4,
  },
  plot: {
    height: designChart.height,
    position: 'relative',
  },
  slots: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: designChart.top,
    height: designChart.base - designChart.top,
    flexDirection: 'row',
  },
  slot: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: `${designChart.colRatio * 100}%`,
    minWidth: designChart.colMin,
    maxWidth: designChart.colMax,
    borderRadius: designRadius.control,
  },
  empty: {
    height: designChart.base - designChart.top,
  },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: designChart.base,
    height: designTree.guide,
  },
  labels: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: designChart.labels - designSpace.s12,
    flexDirection: 'row',
  },
  labelStart: {
    flex: 1,
    textAlign: 'left',
  },
  labelMid: {
    flex: 1,
    textAlign: 'center',
  },
  labelEnd: {
    flex: 1,
    textAlign: 'right',
  },
  labelCenter: {
    flex: 1,
    textAlign: 'center',
  },
  read: {
    textAlign: 'left',
  },
});
