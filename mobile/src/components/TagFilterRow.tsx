import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '@/components/Press';

import { TagChip } from '@/components/TagChip';
import { TagStrip } from '@/components/TagStrip';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface TagFilterRowProps {
  tags: { name: string; count: number }[];
  selected: string[];
  onToggle(name: string): void;
  onClear(): void;
  onManage(): void;
}

export function TagFilterRow({ tags, selected, onToggle, onClear, onManage }: TagFilterRowProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <TagStrip>
        <Press
          onPress={onClear}
          accessibilityRole="button"
          accessibilityState={{ selected: selected.length === 0 }}
          style={[styles.all, selected.length === 0 ? styles.allOn : null]}
        >
          <Text style={[styles.allText, selected.length === 0 ? styles.allTextOn : null]}>
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
          style={styles.manage}
        >
          <Ionicons name="pricetags-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.manageText}>{tags.length > 0 ? 'Tags' : 'Gerenciar tags'}</Text>
        </Press>
      </TagStrip>
    </View>
  );
}

const baseStyles = defineStyles({
  row: { marginBottom: spacing.xs },
  all: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    backgroundColor: baseColors.surface,
  },
  allOn: { backgroundColor: baseColors.text, borderColor: baseColors.text },
  allText: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '700' },
  allTextOn: { color: baseColors.bg },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  manageText: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
});
