import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import type { NoteOrder } from '@/core/noteOrder';
import { TagChip } from '@/components/TagChip';
import { TagStrip } from '@/components/TagStrip';
import { designRadius, designSpace, designType } from '@/theme/design';

import { Icon } from '@/ui/icons';
import { useDesign } from '@/ui/useDesign';

interface TagFilterRowProps {
  tags: { name: string; count: number }[];
  selected: string[];
  onToggle(name: string): void;
  onClear(): void;
  onManage(): void;
  /** Ordem atual da lista (data de criacao da nota). */
  order: NoteOrder;
  onPressOrder(): void;
}

/**
 * Filtros da home: todas, tags com contagem, atalho de gerenciar e a ordem da
 * lista. O chip e o mesmo do resto do sistema; o gerenciar e o ordenar ficam
 * no fim da faixa, como estavam.
 */
export function TagFilterRow({
  tags,
  selected,
  onToggle,
  onClear,
  onManage,
  order,
  onPressOrder,
}: TagFilterRowProps) {
  const colors = useDesign();
  const all = selected.length === 0;

  return (
    <View style={styles.row}>
      <TagStrip style={styles.strip}>
        <Press
          onPress={onClear}
          accessibilityRole="button"
          accessibilityState={{ selected: all }}
          style={[
            styles.all,
            {
              borderColor: all ? colors.primary : colors.line,
              backgroundColor: all ? colors.primarySoft : 'transparent',
            },
          ]}
        >
          <Text style={[styles.allText, { color: all ? colors.text : colors.textMuted }]}>
            Todas
          </Text>
        </Press>
        {tags.map((tag) => (
          <TagChip
            key={tag.name.toLowerCase()}
            name={tag.name}
            count={tag.count}
            selected={selected.some((item) => item.toLowerCase() === tag.name.toLowerCase())}
            onPress={() => onToggle(tag.name)}
          />
        ))}
        <Press
          onPress={onManage}
          accessibilityRole="button"
          accessibilityLabel="Gerenciar tags"
          style={[styles.manage, { borderColor: colors.line }]}
        >
          <Icon name="tag" size={12} color={colors.textMuted} />
          <Text style={[styles.manageText, { color: colors.textMuted }]}>
            {tags.length > 0 ? 'Tags' : 'Gerenciar tags'}
          </Text>
        </Press>
      </TagStrip>
      <Press
        onPress={onPressOrder}
        style={styles.order}
        accessibilityRole="button"
        accessibilityLabel={
          order === 'oldest' ? 'Ordenar notas: mais antigas primeiro' : 'Ordenar notas: mais recentes primeiro'
        }
        hitSlop={8}
      >
        <Icon name="sort" size={16} color={colors.textMuted} />
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: designSpace.s4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s4,
    paddingHorizontal: designSpace.s4,
  },
  strip: { flex: 1 },
  all: {
    height: designType.label.size + 16,
    borderRadius: designRadius.control,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: designSpace.s8,
  },
  allText: {
    fontSize: designType.label.size,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s4,
    height: designType.label.size + 16,
    borderRadius: designRadius.control,
    borderWidth: 1,
    paddingHorizontal: designSpace.s6,
  },
  manageText: {
    fontSize: designType.label.size,
    fontWeight: '500',
    letterSpacing: 0.8,
  },
  order: {
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
