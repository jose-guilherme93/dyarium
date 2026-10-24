import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '@/components/Press';

import { tagColor, withAlpha } from '@/core/tags';
import { fontSize, radius, spacing } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

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
 * Chip pastel de tag. Sem selecao fica um tom translucido com o texto na cor
 * suave; selecionado, o fundo sobe e o texto fica escuro, para o estado ser
 * visivel sem competir com o resto da interface.
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
  const styles = useThemedStyles(baseStyles);

  const color = tagColor(name, storedColor);
  const body = (
    <View
      style={[
        styles.chip,
        size === 'sm' ? styles.chipSm : null,
        {
          backgroundColor: withAlpha(color, selected ? 0.88 : 0.16),
          borderColor: withAlpha(color, selected ? 0.95 : 0.28),
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          size === 'sm' ? styles.labelSm : null,
          { color: selected ? '#141416' : color },
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>
      {typeof count === 'number' ? (
        <Text style={[styles.count, { color: selected ? '#2C2C2E' : withAlpha(color, 0.75) }]}>
          {count}
        </Text>
      ) : null}
      {onRemove ? (
        <Ionicons name="close" size={12} color={selected ? '#141416' : color} />
      ) : null}
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

const baseStyles = defineStyles({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    maxWidth: 180,
  },
  chipSm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    gap: 3,
  },
  label: { fontSize: fontSize.xs, fontWeight: '600' },
  labelSm: { fontSize: 10, fontWeight: '600' },
  count: { fontSize: 10, fontVariant: ['tabular-nums'] },
});
