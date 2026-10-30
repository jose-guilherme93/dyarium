/** Filtros do mapa: periodo e caderno, atras de um botao do topo. */

import { ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';
import type { Notebook } from '@/core/notebooks';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export interface MapPeriod {
  key: string;
  label: string;
}

interface MapFiltersProps {
  visible: boolean;
  periods: MapPeriod[];
  period: string;
  notebookId: string;
  notebooks: Notebook[];
  onClose(): void;
  onPeriod(key: string): void;
  onNotebook(id: string): void;
}

export function MapFilters({
  visible,
  periods,
  period,
  notebookId,
  notebooks,
  onClose,
  onPeriod,
  onNotebook,
}: MapFiltersProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose} cardStyle={styles.card}>
      <Text style={styles.title}>Período</Text>
      <View style={styles.row}>
        {periods.map((item) => {
          const active = item.key === period;
          return (
            <Press
              key={item.key}
              style={[styles.chip, active ? styles.chipActive : null]}
              onPress={() => onPeriod(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                {item.label}
              </Text>
            </Press>
          );
        })}
      </View>

      <Text style={styles.title}>Caderno</Text>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        <Press
          style={[styles.notebook, !notebookId ? styles.notebookActive : null]}
          onPress={() => onNotebook('')}
          accessibilityRole="button"
          accessibilityState={{ selected: !notebookId }}
        >
          <View style={[styles.dot, { backgroundColor: colors.textTertiary }]} />
          <Text style={styles.notebookName}>Todos os cadernos</Text>
        </Press>
        {notebooks.map((notebook) => {
          const active = notebook.id === notebookId;
          return (
            <Press
              key={notebook.id}
              style={[styles.notebook, active ? styles.notebookActive : null]}
              onPress={() => onNotebook(notebook.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.dot, { backgroundColor: notebook.color }]} />
              <Text style={styles.notebookName} numberOfLines={1}>
                {notebook.name}
              </Text>
            </Press>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  card: { gap: spacing.sm, maxHeight: '78%' },
  title: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: baseColors.neutralSoft,
  },
  chipActive: { backgroundColor: baseColors.accentSoft },
  chipText: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  chipTextActive: { color: baseColors.accent },
  list: { maxHeight: 280 },
  notebook: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  notebookActive: { backgroundColor: baseColors.neutralSoft },
  dot: { width: 8, height: 8, borderRadius: 4 },
  notebookName: { flex: 1, color: baseColors.text, fontSize: fontSize.md },
});
