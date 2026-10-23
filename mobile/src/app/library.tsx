import { Ionicons } from '@expo/vector-icons';
import { back, push } from '@/services/appNavigation';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { formatBytes } from '@/core/format';
import { useLibrary } from '@/state/LibraryContext';
import { colors, fontSize, spacing } from '@/theme/tokens';

export default function LibraryScreen() {
  const { recordings } = useLibrary();
  const total = recordings.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0);

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => back()} style={styles.back} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Minhas gravações</Text>
          <Text style={styles.subtitle}>
            {recordings.length === 0
              ? 'Nada por aqui ainda'
              : `${recordings.length} no aparelho - ${formatBytes(total)}`}
          </Text>
        </View>
        <View style={styles.back} />
      </View>

      <FlatList
        data={recordings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <RecordingCard
            recording={item}
            onOpen={(id) => push({ pathname: '/note/[id]', params: { id } })}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="mic-outline" size={32} color={colors.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>Sem gravações</Text>
            <Text style={styles.emptyText}>
              Toque no botão na tela inicial para gravar sua primeira nota.
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { alignItems: 'center' },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  subtitle: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: 2 },
  list: { padding: spacing.xl, paddingTop: spacing.sm },
  separator: { height: spacing.md },
  empty: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxxl },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: {
    color: colors.textTertiary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },
});
