import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { RecordButton } from '@/components/RecordButton';
import { RecordingCard } from '@/components/RecordingCard';
import { Screen } from '@/components/Screen';
import { Waveform } from '@/components/Waveform';
import { formatDuration } from '@/core/format';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording } from '@/state/RecordingContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, spacing } from '@/theme/tokens';

const PENDING_STATUSES = ['recorded', 'queued', 'uploading', 'failed'];

export default function RecordScreen() {
  const { config } = useSettings();
  const { recordings, retry, remove } = useLibrary();
  const { active, elapsedMs, level, error, busy, start, stop } = useRecording();

  const recording = Boolean(active);
  const pending = recordings.filter((r) => PENDING_STATUSES.includes(r.status)).length;
  const interrupted = recordings.filter((r) => r.status === 'interrupted').length;

  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (recording) await stop();
    else await start();
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.largeTitle}>Gravacoes</Text>
          <Text style={styles.headerSub}>
            {recordings.length === 0
              ? 'Nada por aqui ainda'
              : `${recordings.length} nota${recordings.length === 1 ? '' : 's'}${
                  pending > 0 ? ` · ${pending} na fila` : ''
                }`}
          </Text>
        </View>
        <Pressable style={styles.serverPill} onPress={() => router.push('/server')}>
          <View
            style={[styles.dot, { backgroundColor: config ? colors.success : colors.warning }]}
          />
          <Text style={styles.serverText}>{config ? 'Servidor' : 'Configurar'}</Text>
        </Pressable>
      </View>

      {recording ? (
        <View style={styles.recordingView}>
          <Text style={styles.timer}>{formatDuration(elapsedMs)}</Text>
          <Waveform active level={level} height={84} color={colors.textSecondary} />
          <Text style={styles.recHint}>Gravando com a tela bloqueada</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : (
        <>
          {interrupted > 0 ? (
            <Pressable style={styles.alert} onPress={() => router.push('/recovery')}>
              <Ionicons name="warning" size={18} color={colors.warning} />
              <Text style={styles.alertText}>
                {interrupted === 1
                  ? 'Uma gravacao foi interrompida'
                  : `${interrupted} gravacoes interrompidas`}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.warning} />
            </Pressable>
          ) : null}

          <FlatList
            data={recordings}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <RecordingCard
                recording={item}
                onRetry={() => void retry(item.id)}
                onDelete={() => void remove(item.id)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="mic-outline" size={30} color={colors.textTertiary} />
                </View>
                <Text style={styles.emptyTitle}>Nenhuma gravacao</Text>
                <Text style={styles.emptyText}>
                  Toque no botao vermelho para gravar sua primeira nota.
                </Text>
              </View>
            }
          />
        </>
      )}

      <View style={styles.bottomBar}>
        <RecordButton recording={recording} busy={busy} onPress={handlePress} />
        <Text style={styles.bottomHint}>{recording ? 'Toque para parar' : 'Toque para gravar'}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  headerText: { gap: 2 },
  largeTitle: { color: colors.text, fontSize: 34, fontWeight: '700', letterSpacing: 0.3 },
  headerSub: { color: colors.textSecondary, fontSize: fontSize.sm },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  serverText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  recordingView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  timer: {
    color: colors.text,
    fontSize: fontSize.display,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  recHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  separator: { height: spacing.sm },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    backgroundColor: colors.warningSoft,
    borderRadius: 14,
    padding: spacing.md,
  },
  alertText: { flex: 1, color: colors.warning, fontSize: fontSize.sm, fontWeight: '600' },
  empty: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxxl },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },
  bottomBar: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  bottomHint: { color: colors.textTertiary, fontSize: fontSize.xs },
});
