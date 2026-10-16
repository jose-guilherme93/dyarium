import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { formatBytes } from '@/core/format';
import { storageUsage } from '@/core/storage';
import { useLibrary } from '@/state/LibraryContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function StorageScreen() {
  const { recordings, freeSyncedAudio } = useLibrary();
  const [busy, setBusy] = useState(false);
  const usage = storageUsage(recordings);

  const handleFree = () => {
    if (usage.syncedWithAudio === 0) return;
    Alert.alert(
      'Liberar espaço',
      'Remove o áudio local das notas já sincronizadas. O áudio continua guardado no servidor; só deixa de tocar offline no aparelho.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Liberar',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void freeSyncedAudio()
              .catch(() => undefined)
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Armazenamento</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Row label="Notas" value={String(usage.noteCount)} />
          <Row label="Com áudio local" value={String(usage.withAudio)} />
          <Row label="Sincronizadas com áudio local" value={String(usage.syncedWithAudio)} />
          <Row label="Espaço de áudio" value={formatBytes(usage.audioBytes)} />
        </View>

        <Text style={styles.hint}>
          Todo o áudio e as notas ficam guardados no aparelho (nada é apagado sozinho). Se
          precisar de espaço, dá para remover o áudio local das notas já sincronizadas.
        </Text>

        <Button
          label={
            usage.syncedWithAudio > 0
              ? `Liberar espaço (${usage.syncedWithAudio})`
              : 'Nada a liberar'
          }
          variant="secondary"
          onPress={handleFree}
          disabled={usage.syncedWithAudio === 0 || busy}
          loading={busy}
        />
      </ScrollView>
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
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: colors.textSecondary, fontSize: fontSize.md },
  rowValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
});
