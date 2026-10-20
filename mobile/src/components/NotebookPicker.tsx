import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FastModal } from '@/components/FastModal';
import type { Notebook } from '@/core/notebooks';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

interface NotebookPickerProps {
  visible: boolean;
  notebooks: Notebook[];
  currentId?: string;
  onClose(): void;
  onSelect(id: string): void;
}

export function NotebookPicker({
  visible,
  notebooks,
  currentId,
  onClose,
  onSelect,
}: NotebookPickerProps) {
  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>Mover para caderno</Text>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {notebooks.map((notebook) => {
              const active = notebook.id === currentId;
              return (
                <Pressable
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
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
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
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, color: colors.text, fontSize: fontSize.md },
});
