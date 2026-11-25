import { Ionicons } from '@expo/vector-icons';
import { back } from '@/services/appNavigation';
import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import { useLibrary } from '@/state/LibraryContext';
import { useDrive, type DriveStage } from '@/state/useDrive';
import { formatBytes } from '@/core/format';
import {
  designControl,
  designFont,
  designMark,
  designMeter,
  designRadius,
  designRow,
  designSpace,
  designType,
} from '@/theme/design';
import { useDesign } from '@/ui/useDesign';

const STEPS: { key: DriveStage; label: string }[] = [
  { key: 'auth', label: 'Autorizando' },
  { key: 'reading', label: 'Lendo cofre' },
  { key: 'decrypting', label: 'Decifrando' },
  { key: 'applying', label: 'Aplicando' },
  { key: 'sending', label: 'Enviando' },
];

function stageIndex(stage: DriveStage | null): number {
  if (!stage) return -1;
  return STEPS.findIndex((step) => step.key === stage);
}

function relativeShort(iso: string | undefined): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  return `há ${days} d`;
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useDesign();
  return (
    <View style={styles.stat}>
      <Text
        style={[
          styles.statValue,
          { color: colors.text, fontFamily: designFont.monoStack },
        ]}
      >
        {value}
      </Text>
      <Text
        style={[
          styles.statLabel,
          { color: colors.textMuted, fontFamily: designFont.regular },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export default function DriveScreen() {
  const colors = useDesign();
  const { recordings } = useLibrary();
  const drive = useDrive();

  const aliveCount = useMemo(
    () => recordings.filter((r) => !r.deletedAt).length,
    [recordings],
  );

  const currentIdx = stageIndex(drive.stage);
  const progressText =
    drive.progress && drive.progress.total > 0
      ? `${drive.progress.done} / ${drive.progress.total}`
      : null;

  const handleConnect = useCallback(() => {
    drive.clearError();
    void drive.connect();
  }, [drive]);

  const handleSync = useCallback(() => {
    drive.clearError();
    void drive.sync();
  }, [drive]);

  const handleDisconnect = useCallback(() => {
    void drive.disconnect();
  }, [drive]);

  const connected = drive.status === 'connected';
  const expired = drive.status === 'expired';
  const unsupported = drive.status === 'unsupported' || !drive.configured;

  return (
    <Screen>
      <View style={styles.header}>
        <Press
          onPress={() => back()}
          style={styles.back}
          accessibilityLabel="Voltar"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={[styles.title, { color: colors.text }]}>Google Drive</Text>
        <View
          style={[
            styles.chip,
            { borderColor: colors.line, backgroundColor: colors.surfaceAlt },
          ]}
        >
          <Text style={[styles.chipText, { color: colors.textMuted }]}>
            OPCIONAL
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {drive.error ? (
          <Text style={[styles.errorLine, { color: colors.danger }]}>
            {drive.error}
          </Text>
        ) : null}

        {expired ? (
          <Text style={[styles.errorLine, { color: colors.danger }]}>
            Sessão do Google vencida.
          </Text>
        ) : null}

        {unsupported && !expired ? (
          <Text style={[styles.mutedLine, { color: colors.textMuted }]}>
            Google não configurado
          </Text>
        ) : null}

        {connected ? (
          <View style={styles.statsRow}>
            <Stat label="No Drive" value={String(drive.summary?.notes ?? '—')} />
            <Stat label="Anexos" value={String(drive.summary?.attachments ?? '—')} />
            <Stat
              label="GB"
              value={drive.summary ? formatBytes(drive.summary.bytes) : '—'}
            />
          </View>
        ) : !expired ? (
          <View style={styles.statsRow}>
            <Stat label="No aparelho" value={String(aliveCount)} />
            <Stat
              label="No Drive"
              value={drive.summary ? String(drive.summary.notes) : '—'}
            />
            <Stat
              label="Conta"
              value={drive.summary ? 'Google' : '—'}
            />
          </View>
        ) : null}

        <View style={styles.lineRow}>
          <Text style={[styles.lineLabel, { color: colors.textMuted }]}>
            Pasta
          </Text>
          <Text
            style={[
              styles.lineValueMono,
              { color: colors.text, fontFamily: designFont.monoStack },
            ]}
          >
            Dyarium/
          </Text>
        </View>

        {connected && !drive.busy ? (
          <>
            <View style={styles.lineRow}>
              <Text style={[styles.lineLabel, { color: colors.textMuted }]}>
                Conta
              </Text>
              <View style={styles.inlineValue}>
                <View
                  style={[styles.dot, { backgroundColor: colors.success }]}
                />
                <Text style={[styles.lineValue, { color: colors.text }]}>
                  Google
                </Text>
              </View>
            </View>
            <View style={styles.lineRow}>
              <Text style={[styles.lineLabel, { color: colors.textMuted }]}>
                Último envio
              </Text>
              <Text style={[styles.lineValue, { color: colors.text }]}>
                {relativeShort(drive.summary?.at)}
              </Text>
            </View>
          </>
        ) : null}

        {drive.busy ? (
          <View style={styles.steps}>
            {STEPS.map((step, index) => {
              const done = index < currentIdx;
              const current = index === currentIdx;
              const showCount = current && progressText;
              const meterWidth =
                current && drive.progress && drive.progress.total > 0
                  ? `${Math.min(
                      100,
                      Math.max(0, (drive.progress.done / drive.progress.total) * 100),
                    )}%`
                  : '0%';
              return (
                <View key={step.key} style={styles.stepRow}>
                  <View
                    style={[
                      styles.marker,
                      done
                        ? { backgroundColor: colors.primary, borderColor: colors.primary }
                        : current
                          ? { backgroundColor: 'transparent', borderColor: colors.primary }
                          : { backgroundColor: 'transparent', borderColor: colors.line },
                    ]}
                  >
                    {done ? (
                      <Ionicons name="checkmark" size={11} color={colors.surface} />
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      { color: current ? colors.text : colors.textMuted },
                    ]}
                  >
                    {step.label}
                  </Text>
                  {showCount ? (
                    <Text
                      style={[
                        styles.stepCount,
                        { color: colors.textMuted, fontFamily: designFont.monoStack },
                      ]}
                    >
                      {progressText}
                    </Text>
                  ) : null}
                  {current ? (
                    <View
                      style={[
                        styles.meterTrack,
                        { backgroundColor: colors.surfaceAlt },
                      ]}
                    >
                      <View
                        style={[
                          styles.meterFill,
                          { width: meterWidth as `${number}%`, backgroundColor: colors.primary },
                        ]}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.actions}>
          {!connected ? (
            <>
              <Press
                onPress={handleConnect}
                disabled={drive.busy || unsupported}
                style={[
                  styles.button,
                  styles.buttonPrimary,
                  {
                    backgroundColor:
                      drive.busy || unsupported ? colors.primarySoft : colors.primary,
                    borderColor:
                      drive.busy || unsupported ? colors.line : colors.primary,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Entrar com Google"
                accessibilityState={{ disabled: drive.busy || unsupported, busy: drive.busy }}
              >
                <Text
                  style={[
                    styles.buttonText,
                    {
                      color:
                        drive.busy || unsupported ? colors.textMuted : colors.surface,
                    },
                  ]}
                >
                  Entrar com Google
                </Text>
              </Press>

              <Press
                onPress={handleSync}
                disabled
                style={[
                  styles.button,
                  styles.buttonSecondary,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Sincronizar agora"
                accessibilityState={{ disabled: true }}
              >
                <Text style={[styles.buttonText, { color: colors.textMuted }]}>
                  Sincronizar agora
                </Text>
              </Press>
            </>
          ) : (
            <>
              <Press
                onPress={handleSync}
                disabled={drive.busy}
                style={[
                  styles.button,
                  styles.buttonPrimary,
                  {
                    backgroundColor: drive.busy ? colors.primarySoft : colors.primary,
                    borderColor: drive.busy ? colors.line : colors.primary,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Sincronizar agora"
                accessibilityState={{ disabled: drive.busy, busy: drive.busy }}
              >
                <Text
                  style={[
                    styles.buttonText,
                    { color: drive.busy ? colors.textMuted : colors.surface },
                  ]}
                >
                  Sincronizar agora
                </Text>
              </Press>
              <Press
                onPress={handleDisconnect}
                disabled={drive.busy}
                style={[
                  styles.button,
                  styles.buttonSecondary,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Sair desta conta"
                accessibilityState={{ disabled: drive.busy }}
              >
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  Sair desta conta
                </Text>
              </Press>
            </>
          )}
        </View>

        {connected && drive.created ? (
          <Text style={[styles.warningLine, { color: colors.warning }]}>
            Cofre novo no Drive
          </Text>
        ) : null}

        {connected && drive.restored ? (
          <Text
            style={[
              styles.restoredMeta,
              { color: colors.textMuted, fontFamily: designFont.monoStack },
            ]}
          >
            {`${drive.restored.notes} notas · ${drive.restored.notebooks} cadernos`}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpace.s16,
    paddingVertical: designSpace.s6,
    gap: designSpace.s8,
  },
  back: {
    width: designRow.touch,
    height: designRow.touch,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: -designSpace.s8,
  },
  title: {
    flex: 1,
    fontFamily: designFont.semibold,
    fontSize: designType.title.size,
    lineHeight: designType.title.size * designType.title.lineHeight,
    letterSpacing: designType.title.letterSpacing,
    fontWeight: '600',
    textAlign: 'center',
  },
  chip: {
    borderWidth: 1,
    borderRadius: designRadius.control,
    paddingHorizontal: designControl.padSm,
    paddingVertical: 2,
    height: designControl.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: designFont.semibold,
    fontSize: designType.label.size,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
  },
  content: {
    paddingHorizontal: designSpace.s16,
    paddingBottom: designSpace.s16,
    gap: designSpace.s8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: designSpace.s8,
    paddingVertical: designSpace.s8,
  },
  stat: {
    flex: 1,
    gap: 2,
  },
  statLabel: {
    fontSize: designType.label.size,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: designType.display.size,
    lineHeight: designType.display.size * designType.display.lineHeight,
    letterSpacing: designType.display.letterSpacing,
    fontVariant: ['tabular-nums'],
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: designRow.dense,
    paddingVertical: designSpace.s4,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  lineLabel: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  lineValue: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  lineValueMono: {
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    letterSpacing: designType.mono.letterSpacing,
  },
  inlineValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s4,
  },
  dot: {
    width: designMark.size,
    height: designMark.size,
    borderRadius: designMark.size / 2,
  },
  errorLine: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  mutedLine: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  warningLine: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  steps: {
    gap: designSpace.s6,
    paddingVertical: designSpace.s4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpace.s6,
    minHeight: designRow.dense,
  },
  marker: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    flex: 1,
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
  },
  stepCount: {
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    letterSpacing: designType.mono.letterSpacing,
  },
  meterTrack: {
    position: 'absolute',
    left: 22,
    right: 0,
    bottom: -4,
    height: designMeter.height,
    borderRadius: 1,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 1,
  },
  actions: {
    gap: designSpace.s6,
    paddingTop: designSpace.s4,
  },
  button: {
    height: designControl.lg,
    borderRadius: designRadius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designControl.padLg,
  },
  buttonPrimary: {},
  buttonSecondary: {},
  buttonText: {
    fontFamily: designFont.semibold,
    fontSize: designType.label.size,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing,
    textTransform: 'uppercase',
  },
  restoredMeta: {
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    letterSpacing: designType.mono.letterSpacing,
  },
});
