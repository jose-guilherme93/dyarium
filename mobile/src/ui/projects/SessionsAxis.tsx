import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  designChart,
  designMark,
  designRadius,
  designSpace,
  designTree,
} from '@/theme/design';

import { useDesign } from '../useDesign';
import { dayNumber, itensLabel, shortDate } from './format';
import { typeStyles } from './texts';

/** Uma sessao posicionada no eixo de tempo real da pasta. */
export interface SessionAxisBar {
  id: string;
  label: string;
  /** Dia do primeiro registro da sessao (AAAA-MM-DD). */
  from: string;
  /** Dia do ultimo registro da sessao (AAAA-MM-DD). */
  to: string;
  items: number;
  /** Aberta ou interrompida aparece contornada; fechada, preenchida. */
  open: boolean;
}

export interface SessionsAxisProps {
  bars: SessionAxisBar[];
  testIdPrefix?: string;
}

const DAY_MS = 864e5;

function dayOfIndex(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Coluna por sessao no eixo de tempo de verdade: a barra cobre os dias em que
 * a sessao trabalhou e a altura e o numero de itens. Sessao que ainda nao
 * fechou (aberta ou interrompida) vem contornada; fechada, preenchida. Sem
 * eixo y; rotulos curtos nas pontas do intervalo e um numero sobre cada barra.
 * Um toque escolhe a sessao para a leitura abaixo do grafico.
 */
export function SessionsAxis({ bars, testIdPrefix = 'axis' }: SessionsAxisProps) {
  const colors = useDesign();
  const [selected, setSelected] = useState<string | null>(null);

  if (bars.length === 0) return null;

  const days = bars.flatMap((bar) => [dayNumber(bar.from), dayNumber(bar.to)]);
  const min = Math.min(...days);
  const max = Math.max(...days);
  const span = Math.max(1, max - min);
  const yMax = Math.max(1, ...bars.map((bar) => bar.items));
  const plotH = designChart.base - designChart.top;

  const byId = new Map(bars.map((bar) => [bar.id, bar]));
  const lastBar = bars[bars.length - 1];
  const readBar = (selected ? byId.get(selected) : undefined) ?? lastBar;

  // Sessoes que se sobrepoem no tempo ganham faixas: cada uma usa a primeira
  // faixa cujo ultimo dia ficou antes do seu primeiro dia. Sem sobreposicao,
  // tudo segue na faixa de baixo, colada na linha de base.
  const laneStep = designChart.sessionBarMin + designSpace.s2;
  const laneEnds: number[] = [];
  const laneOf = bars.map((bar) => {
    const a = dayNumber(bar.from);
    const b = Math.max(dayNumber(bar.to), a);
    let lane = laneEnds.findIndex((end) => end < a);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(b);
    } else {
      laneEnds[lane] = b;
    }
    return lane;
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.plot}>
        {bars.map((bar, index) => {
          const a = dayNumber(bar.from);
          const b = dayNumber(bar.to);
          if (Number.isNaN(a) || Number.isNaN(b)) return null;
          const lane = laneOf[index];
          const leftPct = ((a - min) / span) * 100;
          const widthPct = ((b + 1 - a) / span) * 100;
          const availH = plotH - lane * laneStep;
          const barH = Math.min(
            Math.max(designChart.sessionBarMin, (bar.items / yMax) * plotH),
            availH,
          );
          const isSelected = bar.id === readBar.id;
          return (
            <Pressable
              key={bar.id}
              testID={`${testIdPrefix}-bar-${bar.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${bar.label} · ${itensLabel(bar.items)}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => setSelected(bar.id)}
              style={[
                styles.barColumn,
                {
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  bottom: designChart.height - designChart.base + lane * laneStep,
                },
              ]}
            >
              <Text style={[typeStyles.mono, styles.barNumber, { color: colors.textMuted }]}>
                {bar.items}
              </Text>
              <View
                style={[
                  styles.barBox,
                  { height: barH },
                  bar.open
                    ? { borderWidth: designMark.stroke, borderColor: colors.primary }
                    : { backgroundColor: colors.primary },
                ]}
              />
            </Pressable>
          );
        })}
        <View style={[styles.baseline, { backgroundColor: colors.line }]} />
        <View style={styles.labels}>
          <Text style={[typeStyles.mono, styles.label, { color: colors.textMuted }]}>
            {shortDate(dayOfIndex(min))}
          </Text>
          {span > 1 ? (
            <Text
              style={[typeStyles.mono, styles.label, styles.labelEnd, { color: colors.textMuted }]}
            >
              {shortDate(dayOfIndex(max))}
            </Text>
          ) : null}
        </View>
      </View>
      <Text
        testID={`${testIdPrefix}-read`}
        style={[typeStyles.mono, styles.read, { color: colors.textMuted }]}
        numberOfLines={1}
      >
        {`${readBar.label} · ${itensLabel(readBar.items)}`}
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
  barColumn: {
    position: 'absolute',
    top: designChart.top,
    marginHorizontal: designSpace.s2,
    justifyContent: 'flex-end',
    alignItems: 'center',
    minWidth: designChart.sessionMin,
  },
  barNumber: {
    marginBottom: designSpace.s2,
  },
  barBox: {
    width: '100%',
    borderRadius: designRadius.control,
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
    justifyContent: 'space-between',
  },
  label: {
    flexShrink: 1,
  },
  labelEnd: {
    textAlign: 'right',
  },
  read: {
    textAlign: 'left',
  },
});
