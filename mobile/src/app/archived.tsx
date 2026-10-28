import { Ionicons } from '@expo/vector-icons';
import { back, push } from '@/services/appNavigation';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { Screen } from '@/components/Screen';
import { TagChip } from '@/components/TagChip';
import { formatStamp, noteDateIso } from '@/core/format';
import { recordingNotebookId } from '@/core/notebookFilter';
import { sortByCreation } from '@/core/noteOrder';
import { displayTitle } from '@/core/title';
import type { Recording } from '@/core/types';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface Group {
  id: string;
  name: string;
  color: string;
  notes: Recording[];
}

/**
 * Notas arquivadas, separadas por caderno.
 *
 * Arquivar e a mesma coisa que "feito" no caderno de Tarefas e ideias, mas vale
 * para qualquer nota: o que sai da lista fica aqui, recuperavel com um toque.
 */
export default function ArchivedScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const { recordings, notebooks, ready, unarchiveNote } = useLibrary();
  const { noteOrder } = useSettings();

  const groups = useMemo<Group[]>(() => {
    const byNotebook = new Map<string, Recording[]>();
    for (const recording of recordings) {
      if (!recording.archived || recording.deletedAt) continue;
      const id = recordingNotebookId(recording);
      const list = byNotebook.get(id);
      if (list) list.push(recording);
      else byNotebook.set(id, [recording]);
    }
    // A ordem dos cadernos e a que o usuario ve na tela de cadernos; notas
    // dentro de cada um seguem a ordem escolhida na lista.
    const order = new Map(notebooks.map((notebook, index) => [notebook.id, index]));
    const defaultNotebook = notebooks.find((notebook) => notebook.isDefault);
    return [...byNotebook.entries()]
      .map(([id, notes]) => {
        const notebook = notebooks.find((item) => item.id === id);
        return {
          id,
          name: notebook?.name ?? defaultNotebook?.name ?? 'Notas ao acaso',
          color: notebook?.color || colors.textTertiary,
          notes: sortByCreation(notes, noteOrder),
        };
      })
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }, [colors.textTertiary, noteOrder, notebooks, recordings]);

  const total = groups.reduce((sum, group) => sum + group.notes.length, 0);

  return (
    <Screen>
      <View style={styles.header}>
        <Press onPress={() => back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Arquivadas</Text>
        <Text style={styles.headerCount}>{total}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {ready && total === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="file-tray-outline" size={34} color={colors.textTertiary} />
            <Text style={styles.emptyCount}>0</Text>
          </View>
        ) : null}

        {groups.map((group) => (
          <View key={group.id} style={styles.group}>
            <View style={styles.groupHead}>
              <View style={[styles.dot, { backgroundColor: group.color }]} />
              <Text style={styles.groupName} numberOfLines={1}>
                {group.name}
              </Text>
              <Text style={styles.groupCount}>{group.notes.length}</Text>
            </View>

            <View style={styles.card}>
              {group.notes.map((note) => {
                const tags = (note.tags ?? []).slice(0, 2);
                return (
                  <View key={note.id} style={styles.row}>
                    <Press
                      style={styles.rowMain}
                      onPress={() => push({ pathname: '/note/[id]', params: { id: note.id } })}
                      accessibilityRole="button"
                      accessibilityLabel={displayTitle(note)}
                    >
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {displayTitle(note)}
                      </Text>
                      <View style={styles.rowMeta}>
                        <Text style={styles.rowDate}>{formatStamp(noteDateIso(note))}</Text>
                        {tags.map((tag) => (
                          <TagChip key={tag.toLowerCase()} name={tag} size="sm" />
                        ))}
                      </View>
                    </Press>
                    <Press
                      style={styles.restore}
                      onPress={() => void unarchiveNote(note.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Desarquivar ${displayTitle(note)}`}
                      hitSlop={6}
                    >
                      <Ionicons name="arrow-undo-outline" size={18} color={colors.textSecondary} />
                    </Press>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const baseStyles = defineStyles({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  headerCount: {
    color: baseColors.textTertiary,
    fontSize: fontSize.md,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'right',
  },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl },
  empty: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  emptyCount: { color: baseColors.textTertiary, fontSize: fontSize.lg, fontWeight: '700' },
  group: { gap: spacing.sm },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  groupName: {
    flex: 1,
    color: baseColors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  groupCount: { color: baseColors.textTertiary, fontSize: fontSize.sm, fontWeight: '700' },
  card: {
    backgroundColor: baseColors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 3,
  },
  rowTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowDate: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  restore: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
});
