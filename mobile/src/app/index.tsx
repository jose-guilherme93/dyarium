import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LevelMeter } from '@/components/LevelMeter';
import { RecordButton } from '@/components/RecordButton';
import { Screen } from '@/components/Screen';
import { formatDuration } from '@/core/format';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording } from '@/state/RecordingContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

const PENDING_STATUSES = ['recorded', 'queued', 'uploading', 'failed'];

export default function RecordScreen() {
  const { config } = useSettings();
  const { recordings } = useLibrary();
  const { active, elapsedMs, level, error, busy, start, stop } = useRecording();

  const pending = recordings.filter((r) => PENDING_STATUSES.includes(r.status)).length;
  const interrupted = recordings.filter((r) => r.status === 'interrupted').length;
  const recording = Boolean(active);

  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (recording) await stop();
    else await start();
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>dyarium</Text>
          <Text style={styles.brandSub}>notas de voz</Text>
        </View>
        <Pressable
          style={styles.serverPill}
          onPress={() => router.push('/server')}
          accessibilityLabel="Configurar servidor"
        >
          <View
            style={[
              styles.dot,
              { backgroundColor: config ? colors.success : colors.warning },
            ]}
          />
          <Text style={styles.serverText}>{config ? 'Servidor' : 'Configurar'}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </Pressable>
      </View>

      <View style={styles.center}>
        <Text style={[styles.timer, recording && styles.timerActive]}>
          {formatDuration(elapsedMs)}
        </Text>
        <LevelMeter level={level} active={recording} />
        <RecordButton recording={recording} busy={busy} level={level} onPress={handlePress} />
        <Text style={styles.hint}>{recording ? 'Toque para parar' : 'Toque para gravar'}</Text>
        {recording ? (
          <Text style={styles.subHint}>Gravando em segundo plano com a tela bloqueada</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.bottom}>
        {interrupted > 0 ? (
          <Pressable style={styles.alert} onPress={() => router.push('/recovery')}>
            <Ionicons name="warning" size={20} color={colors.warning} />
            <Text style={styles.alertText}>
              {interrupted === 1
                ? 'Uma gravacao foi interrompida'
                : `${interrupted} gravacoes foram interrompidas`}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.warning} />
          </Pressable>
        ) : null}

        <Pressable style={styles.queueCard} onPress={() => router.push('/library')}>
          <View style={styles.queueIcon}>
            <Ionicons name="albums-outline" size={22} color={colors.accent} />
          </View>
          <View style={styles.queueText}>
            <Text style={styles.queueTitle}>Minhas gravacoes</Text>
            <Text style={styles.queueSub}>
              {recordings.length === 0
                ? 'Nada por aqui ainda'
                : `${recordings.length} no aparelho${pending > 0 ? ` - ${pending} na fila` : ''}`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  brand: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700', letterSpacing: 0.2 },
  brandSub: { color: colors.textTertiary, fontSize: fontSize.xs, marginTop: 2 },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  serverText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  timer: {
    color: colors.textSecondary,
    fontSize: fontSize.xxl,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  timerActive: { color: colors.text },
  hint: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  subHint: { color: colors.textTertiary, fontSize: fontSize.xs },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  bottom: { gap: spacing.md, paddingBottom: spacing.sm },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.warningSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  alertText: { flex: 1, color: colors.warning, fontSize: fontSize.sm, fontWeight: '600' },
  queueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  queueIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueText: { flex: 1, gap: 2 },
  queueTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  queueSub: { color: colors.textTertiary, fontSize: fontSize.xs },
});
