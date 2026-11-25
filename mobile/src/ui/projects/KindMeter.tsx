import { StyleSheet, View } from 'react-native';

import { itemKindCounts, type LogItem } from '@/core/projetoLog';
import { designMeter, designSpace, designTree } from '@/theme/design';

import { useDesign } from '../useDesign';

/** Ordem canônica dos kinds; kinds desconhecidos vem depois, em ordem de nome. */
export const KIND_ORDER = ['feat', 'fix', 'perf', 'test', 'docs', 'chore'];

export function kindSequence(counts: Record<string, number>): string[] {
  const known = KIND_ORDER.filter((kind) => (counts[kind] ?? 0) > 0);
  const extra = Object.keys(counts)
    .filter((kind) => kind !== '' && !KIND_ORDER.includes(kind) && (counts[kind] ?? 0) > 0)
    .sort();
  return [...known, ...extra];
}

export interface KindMeterProps {
  items: LogItem[];
  /** Rótulo longo para leitura assistida: monta "3 feat, 1 fix". */
  describe?: boolean;
  /** Ocupa a largura toda (agregado) em vez do medidor inline de 44. */
  stretch?: boolean;
}

/**
 * Medidor de 2px com a composicao por kind. Kind nao tem cor (regra do
 * sistema): a composicao aparece na largura dos segmentos neutros, separados
 * por uma hairline; os nomes so saem em texto curto ou no rotulo assistido.
 */
export function KindMeter({ items, describe = true, stretch = false }: KindMeterProps) {
  const colors = useDesign();
  const counts = itemKindCounts(items);
  const kinds = kindSequence(counts);
  const total = items.length;

  if (total === 0) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="sem itens"
        style={[stretch ? styles.trackStretch : styles.track, { backgroundColor: colors.line }]}
      />
    );
  }

  const label = describe
    ? kinds.map((kind) => `${counts[kind]} ${kind}`).join(' · ')
    : `${total} itens`;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.meter, stretch && styles.meterStretch]}
    >
      {kinds.map((kind, at) => (
        <View
          key={kind}
          style={[
            styles.segment,
            {
              flexGrow: counts[kind],
              backgroundColor: at === 0 ? colors.primary : colors.primarySoft,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  meter: {
    width: designMeter.compose,
    height: designMeter.height,
    flexDirection: 'row',
    gap: designTree.guide,
    flexGrow: 0,
    flexShrink: 0,
  },
  track: {
    width: designMeter.compose,
    height: designMeter.height,
    flexGrow: 0,
    flexShrink: 0,
  },
  trackStretch: {
    height: designMeter.height,
    flex: 1,
  },
  meterStretch: {
    width: '100%',
    flex: 1,
  },
  segment: {
    height: designMeter.height,
    flexBasis: 0,
    minWidth: designSpace.s2,
  },
});
