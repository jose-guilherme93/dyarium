import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TagChip } from '@/components/TagChip';
import { TagStrip } from '@/components/TagStrip';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

interface TagFilterRowProps {
  tags: { name: string; count: number }[];
  selected: string[];
  onToggle(name: string): void;
  onClear(): void;
  onManage(): void;
}

export function TagFilterRow({ tags, selected, onToggle, onClear, onManage }: TagFilterRowProps) {
  return (
    <View style={styles.row}>
      <TagStrip>
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityState={{ selected: selected.length === 0 }}
          style={[styles.all, selected.length === 0 ? styles.allOn : null]}
        >
          <Text style={[styles.allText, selected.length === 0 ? styles.allTextOn : null]}>
            Todas
          </Text>
        </Pressable>
        {tags.map((tag) => (
          <TagChip
            key={tag.name.toLowerCase()}
            name={tag.name}
            count={tag.count}
            selected={selected.some((item) => item.toLowerCase() === tag.name.toLowerCase())}
            onPress={() => onToggle(tag.name)}
          />
        ))}
        <Pressable
          onPress={onManage}
          accessibilityRole="button"
          accessibilityLabel="Gerenciar tags"
          style={styles.manage}
        >
          <Ionicons name="pricetags-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.manageText}>{tags.length > 0 ? 'Tags' : 'Gerenciar tags'}</Text>
        </Pressable>
      </TagStrip>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: spacing.md },
  all: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    backgroundColor: colors.surface,
  },
  allOn: { backgroundColor: colors.text, borderColor: colors.text },
  allText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '700' },
  allTextOn: { color: '#141416' },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  manageText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
});
