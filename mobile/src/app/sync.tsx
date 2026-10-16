import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { STATUS_META } from '@/components/StatusChip';
import { isUploadable, needsNoteSync, type Recording } from '@/core/types';
import { useLibrary } from '@/state/LibraryContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

export default function SyncScreen() {
  const { recordings, retry, kick } = useLibrary();

  const pending = recordings.filter((r) => isUploadable(r) || needsNoteSync(r));
  const failed = recordings.filter((r) => r.status === 'failed').length;
  const completed = recordings.filter((r) => r.status === 'completed').length;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Sincronização</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <Ionicons
            name={failed > 0 ? 'cloud-offline-outline' : pending.length > 0 ? 'cloud-upload-outline' : 'cloud-done-outline'}
            size={26}
            color={failed > 0 ? colors.danger : pending.length > 0 ? colors.textSecondary : colors.success}
          />
          <View style={styles.summaryText}>
            <Text style={styles.summaryTitle}>
              {failed > 0
                ? `${failed} nota(s) falharam`
                : pending.length > 0
                  ? `${pending.length} na fila`
                  : 'Tudo sincronizado'}
            </Text>
            <Text style={styles.summarySub}>{completed} enviada(s) no total</Text>
          </View>
        </View>

        <Text style={styles.hint}>
          O envio continua em segundo plano quando o app fica em segundo plano ou é fechado. Toque
          em Enviar agora para forçar.
        </Text>

        {pending.length > 0 ? (
          <Button label="Enviar agora" onPress={kick} />
        ) : null}

        {pending.length > 0 ? (
          <View style={styles.list}>
            {pending.map((item) => (
              <SyncRow key={item.id} recording={item} onRetry={() => void retry(item.id)} />
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle" size={32} color={colors.success} />
            <Text style={styles.emptyText}>Nenhuma nota pendente.</Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function SyncRow({ recording, onRetry }: { recording: Recording; onRetry: () => void }) {
  const meta = STATUS_META[recording.status];
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {recording.title}
        </Text>
        <Text style={styles.rowSub}>{needsNoteSync(recording) ? 'Aguardando envio' : meta.label}</Text>
      </View>
      {recording.status === 'failed' ? (
        <Pressable onPress={onRetry} accessibilityLabel="Reenviar" hitSlop={8}>
          <Ionicons name="refresh" size={20} color={colors.warning} />
        </Pressable>
      ) : null}
    </View>
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
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.lg },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  summaryText: { flex: 1, gap: 2 },
  summaryTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  summarySub: { color: colors.textSecondary, fontSize: fontSize.sm },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs },
  empty: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.sm },
});
