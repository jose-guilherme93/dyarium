import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { back } from '@/services/appNavigation';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { Screen } from '@/components/Screen';
import { formatStamp } from '@/core/format';
import { displayTitle } from '@/core/title';
import { TRASH_RETENTION_DAYS, trashDaysLeft } from '@/core/trash';
import type { Recording } from '@/core/types';
import { listTrashedRecordings } from '@/services/db';
import { purgeExpiredTrash } from '@/services/trash';
import { useLibrary } from '@/state/LibraryContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

/**
 * Lixeira: tudo o que foi apagado nos ultimos 7 dias.
 *
 * A nota e o audio continuam no aparelho durante a janela; restaurar devolve
 * texto, tags, caderno e audio juntos. Depois do prazo, a limpeza do boot
 * libera os arquivos e a linha.
 */
export default function TrashScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const { restoreFromTrash } = useLibrary();
  const [notes, setNotes] = useState<Recording[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await purgeExpiredTrash();
      setNotes(await listTrashedRecordings());
      setError(null);
    } catch {
      setError('Não foi possível ler a lixeira.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const restore = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        await restoreFromTrash(id);
        await load();
      } catch {
        setError('Não foi possível restaurar esta nota.');
      } finally {
        setBusyId(null);
      }
    },
    [load, restoreFromTrash],
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Press onPress={() => back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Lixeira</Text>
        <Text style={styles.headerCount}>{notes.length}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!loaded ? (
          <ActivityIndicator color={colors.textTertiary} style={styles.loading} />
        ) : null}

        {loaded && notes.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="trash-outline" size={34} color={colors.textTertiary} />
            <Text style={styles.emptyCount}>0</Text>
            <Text style={styles.hint}>{TRASH_RETENTION_DAYS} dias</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {notes.map((note) => {
          const daysLeft = note.deletedAt ? trashDaysLeft(note.deletedAt) : 0;
          return (
            <View key={note.id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {displayTitle(note)}
                </Text>
                <Text style={styles.rowDate}>
                  {note.deletedAt ? formatStamp(note.deletedAt) : ''}
                </Text>
              </View>
              <View style={styles.days}>
                <Text style={styles.daysValue}>{daysLeft}</Text>
                <Text style={styles.daysUnit}>d</Text>
              </View>
              <Press
                style={styles.restore}
                onPress={() => void restore(note.id)}
                disabled={busyId === note.id}
                accessibilityRole="button"
                accessibilityLabel={`Restaurar ${displayTitle(note)}`}
                hitSlop={6}
              >
                {busyId === note.id ? (
                  <ActivityIndicator color={colors.textSecondary} />
                ) : (
                  <Ionicons name="arrow-undo-outline" size={18} color={colors.textSecondary} />
                )}
              </Press>
            </View>
          );
        })}
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
  content: { padding: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxl },
  loading: { paddingVertical: spacing.xl },
  empty: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  emptyCount: { color: baseColors.textTertiary, fontSize: fontSize.lg, fontWeight: '700' },
  hint: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  error: { color: baseColors.danger, fontSize: fontSize.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: baseColors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  rowMain: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: 3 },
  rowTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowDate: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  days: { flexDirection: 'row', alignItems: 'baseline', gap: 1, paddingHorizontal: spacing.sm },
  daysValue: { color: baseColors.textSecondary, fontSize: fontSize.md, fontWeight: '700' },
  daysUnit: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  restore: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
});
