import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '@/components/Press';

import { FastModal } from '@/components/FastModal';
import type { Notebook } from '@/core/notebooks';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

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
  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <Press style={styles.backdrop} onPress={onClose} feedback={false}>
        <Press style={styles.card} onPress={() => undefined} feedback={false}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
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
        </Press>
      </Press>
    </FastModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    maxHeight: '70%',
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  rowOn: { backgroundColor: colors.surface },
  iconSlot: { width: 10, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, color: colors.text, fontSize: fontSize.md },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  manageText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
});
