import { Pressable, StyleSheet, Text } from 'react-native';

import type { LogItem } from '@/core/projetoLog';
import { designControl, designRow, designSpace, designTree } from '@/theme/design';

import { useDesign } from '../useDesign';
import { typeStyles } from './texts';

/**
 * Linha de item da superficie Projetos: kind em mono neutro (kind nao tem
 * cor), titulo e commit. A acao de abrir vem de quem desenha a linha.
 */
export interface ItemLineProps {
  item: LogItem;
  onOpen: () => void;
}

export function ItemLine({ item, onOpen }: ItemLineProps) {
  const colors = useDesign();
  return (
    <Pressable
      testID={`item-row-${item.title}`}
      style={[styles.row, { borderBottomColor: colors.line }]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${item.kind} ${item.title}`}
      hitSlop={designSpace.s2}
    >
      <Text style={[typeStyles.mono, styles.kind, { color: colors.textMuted }]} numberOfLines={1}>
        {item.kind}
      </Text>
      <Text style={[typeStyles.body, styles.title, { color: colors.text }]} numberOfLines={1}>
        {item.title}
      </Text>
      {item.commit ? (
        <Text style={[typeStyles.mono, styles.commit, { color: colors.textMuted }]} numberOfLines={1}>
          {item.commit}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s8,
    minHeight: designRow.dense,
    paddingVertical: designSpace.s2,
    borderBottomWidth: designTree.guide,
  },
  kind: { width: designControl.lg + designControl.md, flexGrow: 0, flexShrink: 0 },
  title: { flex: 1 },
  commit: { maxWidth: designControl.lg * 3 },
});
