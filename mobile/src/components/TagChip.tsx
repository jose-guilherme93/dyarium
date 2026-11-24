import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { tagColor } from '@/core/tags';
import { designRadius, designSpace, designType } from '@/theme/design';

import { Icon } from '@/ui/icons';
import { useDesign } from '@/ui/useDesign';

interface TagChipProps {
  name: string;
  count?: number;
  selected?: boolean;
  /** Mostra o "x" para remover (tela da nota). */
  onRemove?: () => void;
  onPress?: () => void;
  size?: 'sm' | 'md';
  storedColor?: string;
}

/**
 * Chip de tag. A cor da tag e dado do usuario, nao decoracao: ela vive num
 * ponto de 4px ao lado do nome. O estado vem do contorno e do degrau tonal,
 * como em todo chip do sistema.
 */
export function TagChip({
  name,
  count,
  selected = false,
  onRemove,
  onPress,
  size = 'md',
  storedColor,
}: TagChipProps) {
  const colors = useDesign();
  const color = tagColor(name, storedColor);
  const small = size === 'sm';

  const body = (
    <View
      style={[
        styles.chip,
        small ? styles.chipSm : null,
        {
          borderColor: selected ? colors.primary : colors.line,
          backgroundColor: selected ? colors.primarySoft : 'transparent',
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text
        style={[
          styles.label,
          small ? styles.labelSm : null,
          { color: selected ? colors.text : colors.textMuted },
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>
      {typeof count === 'number' ? (
        <Text style={[styles.count, { color: colors.textMuted }]}>{count}</Text>
      ) : null}
      {onRemove ? <Icon name="close" size={10} color={colors.textMuted} /> : null}
    </View>
  );

  if (onRemove) {
    return (
      <Press
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remover tag ${name}`}
        hitSlop={4}
      >
        {body}
      </Press>
    );
  }
  if (onPress) {
    return (
      <Press
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`Tag ${name}${typeof count === 'number' ? `, ${count} notas` : ''}`}
      >
        {body}
      </Press>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s6,
    height: designType.label.size + 16,
    borderRadius: designRadius.control,
    borderWidth: 1,
    paddingHorizontal: designSpace.s8,
    maxWidth: 180,
  },
  chipSm: {
    height: designType.label.size + 10,
    gap: designSpace.s4,
    paddingHorizontal: designSpace.s6,
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
  label: {
    fontSize: designType.label.size,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  labelSm: { fontSize: 9 },
  count: {
    fontSize: designType.label.size,
    fontVariant: ['tabular-nums'],
  },
});
