import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '@/components/Press';

import { BottomSheet } from '@/components/BottomSheet';
import type { Notebook } from '@/core/notebooks';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface NotebookPickerProps {
  visible: boolean;
  notebooks: Notebook[];
  currentId?: string;
  title?: string;
  /** Marca "Páginas recentes" como o escopo atual da home. */
  recentSelected?: boolean;
  onSelectRecent?(): void;
  /** Abre a tela de cadernos para criar, renomear ou excluir. */
  onManage?(): void;
  onClose(): void;
  onSelect(id: string): void;
}

export function NotebookPicker({
  visible,
  notebooks,
  currentId,
  title = 'Mover para caderno',
  recentSelected = false,
  onSelectRecent,
  onManage,
  onClose,
  onSelect,
}: NotebookPickerProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose} cardStyle={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <ScrollView
        style={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {onSelectRecent ? (
          <Press
            style={[styles.row, recentSelected ? styles.rowOn : null]}
            onPress={onSelectRecent}
            accessibilityRole="button"
            accessibilityState={{ selected: recentSelected }}
          >
            <View style={styles.iconSlot}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
            </View>
            <Text style={styles.name} numberOfLines={1}>
              Páginas recentes
            </Text>
            {recentSelected ? (
              <Ionicons name="checkmark" size={18} color={colors.accent} />
            ) : null}
          </Press>
        ) : null}
        {notebooks.map((notebook) => {
          const active = notebook.id === currentId;
          return (
            <Press
              key={notebook.id}
              style={[styles.row, active ? styles.rowOn : null]}
              onPress={() => onSelect(notebook.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View
                style={[
                  styles.dot,
                  { backgroundColor: notebook.color || colors.textTertiary },
                ]}
              />
              <Text style={styles.name} numberOfLines={1}>
                {notebook.name}
              </Text>
              {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
            </Press>
          );
        })}
      </ScrollView>
      {onManage ? (
        <Press style={styles.manage} onPress={onManage} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
          <Text style={styles.manageText}>Novo ou gerenciar cadernos</Text>
        </Press>
      ) : null}
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  card: {
    padding: spacing.xl,
    maxHeight: '70%',
    gap: spacing.md,
  },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  list: { flexGrow: 0, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  rowOn: { backgroundColor: baseColors.surface },
  iconSlot: { width: 10, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, color: baseColors.text, fontSize: fontSize.md },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  manageText: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '600' },
});
