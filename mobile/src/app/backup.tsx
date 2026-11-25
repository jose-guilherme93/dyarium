import { Ionicons } from '@expo/vector-icons';
import { back } from '@/services/appNavigation';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { Button } from '@/components/Button';
import { BottomSheet } from '@/components/BottomSheet';
import { Screen } from '@/components/Screen';
import { formatBytes, formatStamp } from '@/core/format';
import {
  backupFrequencyLabel,
  type BackupFrequency,
} from '@/core/backupSchedule';
import {
  cancelActivity,
  failActivity,
  finishActivity,
  startActivity,
  updateActivity,
} from '@/services/activity';
import {
  BackupError,
  pickBackupFolder,
  readManifestSummary,
  runBackup,
  runRestore,
  type BackupInfo,
  type BackupSummary,
} from '@/services/backup';
import { listRecordings } from '@/services/db';
import { reassertNotesOnServer } from '@/services/reassert';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const BACKUP_ACTIVITY = 'backup:local';
const RESTORE_ACTIVITY = 'restore:local';

type Tone = 'neutral' | 'success' | 'warning' | 'running';
type ErrorScope = 'folder' | 'backup' | 'restore';

interface ScreenError {
  scope: ErrorScope;
  message: string;
}

interface RunProgress {
  done: number;
  total: number;
}

const CADENCE_OPTIONS = [
  { freq: 'daily', icon: 'sunny-outline', label: 'Diário' },
  { freq: 'weekly', icon: 'calendar-outline', label: 'Semanal' },
  { freq: 'monthly', icon: 'calendar-number-outline', label: 'Mensal' },
] as const;

const INFO_ROWS = [
  { icon: 'document-text-outline', label: 'Notas', included: true },
  { icon: 'mic-outline', label: 'Áudio', included: true },
  { icon: 'image-outline', label: 'Imagens', included: true },
  { icon: 'analytics-outline', label: 'Análises', included: true },
  { icon: 'cloud-outline', label: 'Entidades', included: true },
  { icon: 'options-outline', label: 'Preferências', included: true },
  { icon: 'close-circle-outline', label: 'Cache', included: false },
] as const;

/** Dias depois dos quais o backup da pasta conta como desatualizado. */
function staleAfterDays(frequency: BackupFrequency): number {
  switch (frequency) {
    case 'daily':
      return 2;
    case 'monthly':
      return 32;
    default:
      return 8;
  }
}

function backupIsStale(info: BackupInfo, frequency: BackupFrequency): boolean {
  const createdAt = Date.parse(info.createdAt);
  if (Number.isNaN(createdAt)) return false;
  return Date.now() - createdAt > staleAfterDays(frequency) * 24 * 60 * 60 * 1000;
}

function copyDetail(done: number, total: number): string {
  return total > 0 ? `Copiando notas · ${done} de ${total}` : 'Copiando notas';
}

function restoreDetail(done: number, total: number): string {
  return total > 0 ? `Restaurando notas · ${done} de ${total}` : 'Restaurando notas';
}

function ratio(done: number, total: number): number | null {
  return total > 0 ? (done / total) * 100 : null;
}

/** Mostra a parte final do caminho (o resto nao informa nada). */
function shortFolder(uri: string): string {
  const clean = decodeURIComponent(uri.replace(/^content:\/\//, '').replace(/^file:\/\//, ''));
  const parts = clean.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? clean;
  // A arvore do SAF vem como "primary:Download": o que nomeia a pasta e o
  // que vem depois dos dois pontos.
  const name = last.includes(':') ? last.slice(last.indexOf(':') + 1) : last;
  return name || clean;
}

function summaryLine(summary: BackupSummary): string {
  const notes = `${summary.notes} nota${summary.notes === 1 ? '' : 's'}`;
  const files = `${summary.files} arquivo${summary.files === 1 ? '' : 's'}`;
  const analyses =
    summary.analyses && summary.analyses > 0
      ? `, ${summary.analyses} análise${summary.analyses === 1 ? '' : 's'}`
      : '';
  return `${notes}, ${files}${analyses} (${formatBytes(summary.bytes)})`;
}

function messageFor(error: unknown): string {
  const code = error instanceof BackupError ? error.code : undefined;
  switch (code) {
    case 'manifest_missing':
      return 'Não encontrei um backup nessa pasta.';
    case 'manifest_invalid':
      return 'O backup nessa pasta é inválido ou de outra versão.';
    case 'corrupt':
      return 'O backup está corrompido ou incompleto; a restauração foi interrompida.';
    case 'hash_failed':
      return 'Não foi possível conferir um arquivo do backup.';
    default:
      return 'Não foi possível concluir. Confira se a pasta ainda está acessível.';
  }
}

export default function BackupScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const { backupFolder, setBackupFolder, backupFrequency, setBackupFrequency } = useSettings();
  const { refresh } = useLibrary();
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<ScreenError | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ folder: string; info: BackupInfo | null } | null>(null);
  const [reload, setReload] = useState(0);
  // Pedido de parada do centro de atividade. O produtor confere entre notas.
  const stopRequested = useRef(false);
  // Ultima rotina diferente de "off", para o interruptor voltar a ela.
  const lastActiveFrequency = useRef<BackupFrequency>(
    backupFrequency === 'off' ? 'weekly' : backupFrequency,
  );

  useEffect(() => {
    if (backupFrequency !== 'off') lastActiveFrequency.current = backupFrequency;
  }, [backupFrequency]);

  useEffect(() => {
    if (!backupFolder) return undefined;
    let alive = true;
    readManifestSummary(backupFolder)
      .then((value) => {
        if (alive) setLoaded({ folder: backupFolder, info: value });
      })
      .catch(() => {
        if (alive) setLoaded({ folder: backupFolder, info: null });
      });
    return () => {
      alive = false;
    };
  }, [backupFolder, reload]);

  // So vale para a pasta atual (evita mostrar o resumo de uma pasta antiga).
  const info = loaded && loaded.folder === backupFolder ? loaded.info : null;

  const handlePick = async () => {
    setError(null);
    try {
      const uri = await pickBackupFolder(backupFolder);
      if (uri) await setBackupFolder(uri);
    } catch {
      setError({ scope: 'folder', message: 'Não foi possível abrir a pasta.' });
    }
  };

  const handleBackup = async () => {
    if (!backupFolder || busy) return;
    setBusy('backup');
    setError(null);
    setProgress(null);
    stopRequested.current = false;
    startActivity({
      id: BACKUP_ACTIVITY,
      kind: 'backup',
      title: 'Backup local',
      detail: 'Preparando cópia',
      progress: 0,
      action: { label: 'Tentar de novo', run: () => handleBackup() },
      stop: {
        label: 'Parar',
        run: () => {
          stopRequested.current = true;
          updateActivity(BACKUP_ACTIVITY, { detail: 'Parando após a nota atual' });
        },
      },
    });
    try {
      const summary = await runBackup(
        backupFolder,
        (done, total) => {
          setProgress({ done, total });
          updateActivity(BACKUP_ACTIVITY, {
            detail: copyDetail(done, total),
            progress: ratio(done, total),
          });
        },
        { shouldStop: () => stopRequested.current },
      );
      finishActivity(BACKUP_ACTIVITY, summaryLine(summary));
      setReload((n) => n + 1);
    } catch (err) {
      if (stopRequested.current) {
        cancelActivity(BACKUP_ACTIVITY, 'Backup interrompido');
      } else {
        failActivity(BACKUP_ACTIVITY, 'Não foi possível concluir o backup');
        setError({ scope: 'backup', message: messageFor(err) });
      }
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const handleRestore = () => {
    if (!backupFolder || !info || busy) return;
    Alert.alert(
      'Restaurar backup',
      'Traz as notas da pasta escolhida para este aparelho, com áudio, imagens, transcrição, análises e mapa. Cada arquivo é conferido antes de entrar. Notas com o mesmo identificador são atualizadas; as demais são mantidas. Se uma nota tinha sido apagada, ela volta também no servidor.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          style: 'destructive',
          onPress: () => {
            setBusy('restore');
            setError(null);
            setProgress(null);
            stopRequested.current = false;
            startActivity({
              id: RESTORE_ACTIVITY,
              kind: 'restore',
              title: 'Restauração',
              detail: 'Conferindo backup',
              progress: 0,
              action: { label: 'Tentar de novo', run: () => handleRestore() },
              stop: {
                label: 'Parar',
                run: () => {
                  stopRequested.current = true;
                  updateActivity(RESTORE_ACTIVITY, { detail: 'Parando após a nota atual' });
                },
              },
            });
            void runRestore(
              backupFolder,
              (done, total) => {
                setProgress({ done, total });
                updateActivity(RESTORE_ACTIVITY, {
                  detail: restoreDetail(done, total),
                  progress: ratio(done, total),
                });
              },
              { shouldStop: () => stopRequested.current },
            )
              .then(async (summary) => {
                // Reafirma as notas no servidor ANTES de sincronizar: uma nota
                // apagada e trazida de volta pelo backup nao pode ser apagada de
                // novo pelo servidor.
                setProgress(null);
                updateActivity(RESTORE_ACTIVITY, {
                  detail: 'Sincronizando notas restauradas',
                  progress: 100,
                });
                const restoredNotes = await listRecordings();
                await reassertNotesOnServer(restoredNotes).catch(() => null);
                finishActivity(RESTORE_ACTIVITY, summaryLine(summary));
                await refresh();
              })
              .catch((err) => {
                if (stopRequested.current) {
                  cancelActivity(RESTORE_ACTIVITY, 'Restauração interrompida');
                } else {
                  failActivity(RESTORE_ACTIVITY, 'Não foi possível restaurar o backup');
                  setError({ scope: 'restore', message: messageFor(err) });
                }
              })
              .finally(() => {
                setBusy(null);
                setProgress(null);
              });
          },
        },
      ],
    );
  };

  const toggleAutomatic = () => {
    if (backupFrequency === 'off') {
      void setBackupFrequency(lastActiveFrequency.current);
      return;
    }
    lastActiveFrequency.current = backupFrequency;
    void setBackupFrequency('off');
  };

  const chooseFrequency = (frequency: BackupFrequency) => {
    lastActiveFrequency.current = frequency;
    void setBackupFrequency(frequency);
  };

  const automatic = backupFrequency !== 'off';
  const stale = info ? backupIsStale(info, backupFrequency) : false;
  const tone: Tone = error
    ? 'warning'
    : busy
      ? 'running'
      : !backupFolder
        ? 'neutral'
        : info
          ? stale
            ? 'warning'
            : 'success'
          : 'neutral';

  const toneColor =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'running'
          ? colors.accent
          : colors.textTertiary;
  const toneSoft =
    tone === 'success'
      ? colors.successSoft
      : tone === 'warning'
        ? colors.warningSoft
        : tone === 'running'
          ? colors.accentSoft
          : 'transparent';
  const badgeIcon =
    tone === 'success'
      ? 'checkmark-circle-outline'
      : tone === 'warning'
        ? 'alert-circle-outline'
        : tone === 'running'
          ? 'sync-outline'
          : 'folder-outline';

  const notesCount = info?.notes ?? 0;
  const progressPercent =
    progress && progress.total > 0
      ? Math.min(100, Math.max(0, Math.round((progress.done / progress.total) * 100)))
      : 0;
  const meterPercent =
    tone === 'running' ? Math.max(12, progressPercent) : tone === 'success' ? 100 : tone === 'warning' ? 40 : 0;

  let heroDetail = 'sem pasta';
  if (backupFolder) {
    const analyses =
      info && info.analyses && info.analyses > 0
        ? ` · ${info.analyses} análise${info.analyses === 1 ? '' : 's'}`
        : '';
    heroDetail = info
      ? `${formatStamp(info.createdAt)} · ${info.files} arquivo${info.files === 1 ? '' : 's'}${analyses} · ${formatBytes(info.bytes)}`
      : 'sem backup';
  }

  const canRestore = Boolean(backupFolder && info) && busy === null;

  return (
    <Screen>
      <View style={styles.header}>
        <Press onPress={() => back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Backup</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroMain}>
            <View
              style={[
                styles.badge,
                { backgroundColor: toneSoft, borderColor: toneColor },
                tone === 'neutral' && styles.badgeNeutral,
              ]}
            >
              <Ionicons name={badgeIcon} size={30} color={toneColor} />
            </View>
            <View style={styles.heroText}>
              <View style={styles.bigRow}>
                <Text style={styles.bigNumber}>{notesCount}</Text>
                <Text style={styles.bigUnit}>notas</Text>
              </View>
              <View style={styles.heroSub}>
                <Ionicons
                  name={info ? 'time-outline' : 'folder-outline'}
                  size={13}
                  color={colors.textTertiary}
                />
                <Text style={styles.heroSubText} numberOfLines={1}>
                  {heroDetail}
                </Text>
              </View>
            </View>
            <Press
              onPress={() => setHelpOpen(true)}
              style={styles.heroInfo}
              accessibilityRole="button"
              accessibilityLabel="O que entra no backup"
            >
              <Ionicons name="information-circle-outline" size={22} color={colors.textSecondary} />
            </Press>
          </View>
          <View
            style={[
              styles.meter,
              { backgroundColor: colors.surfaceElevated },
              tone === 'neutral' && [
                styles.meterNeutral,
                { borderColor: colors.borderStrong },
              ],
            ]}
          >
            {tone !== 'neutral' ? (
              <View
                style={[
                  styles.meterFill,
                  {
                    width: `${meterPercent}%` as `${number}%`,
                    backgroundColor: toneColor,
                  },
                ]}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.grid}>
          <View style={[styles.cell, styles.cellFolder]}>
            <Text style={styles.cap}>Pasta</Text>
            <View style={styles.cellRow}>
              <Text style={styles.cellValue} numberOfLines={1}>
                {backupFolder ? shortFolder(backupFolder) : '—'}
              </Text>
              <Press
                onPress={() => void handlePick()}
                style={styles.pencil}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityLabel={backupFolder ? 'Trocar pasta' : 'Escolher pasta'}
              >
                <Ionicons name="pencil-outline" size={17} color={colors.textSecondary} />
              </Press>
            </View>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cap}>Rotina</Text>
            <View style={styles.cellRow}>
              <Text style={styles.cellValue} numberOfLines={1}>
                {backupFrequency === 'off' ? 'Desligada' : backupFrequencyLabel(backupFrequency)}
              </Text>
            </View>
          </View>
        </View>

        {error?.scope === 'folder' ? <Text style={styles.errorText}>{error.message}</Text> : null}

        <View style={styles.rows}>
          <Press
            style={styles.switchRow}
            onPress={toggleAutomatic}
            accessibilityRole="switch"
            accessibilityState={{ checked: automatic }}
            accessibilityLabel="Backup automático"
          >
            <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.switchLabel}>Backup automático</Text>
            <View
              style={[
                styles.track,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                automatic && [styles.trackOn, { backgroundColor: colors.accent, borderColor: colors.accent }],
              ]}
            >
              <View
                style={[
                  styles.knob,
                  { backgroundColor: colors.textTertiary },
                  automatic && [styles.knobOn, { backgroundColor: colors.onAccent }],
                ]}
              />
            </View>
          </Press>

          <View style={styles.cadence}>
            {CADENCE_OPTIONS.map((option) => {
              const selected = backupFrequency === option.freq;
              return (
                <Press
                  key={option.freq}
                  onPress={() => chooseFrequency(option.freq)}
                  disabled={!automatic}
                  style={[
                    styles.cadenceButton,
                    { backgroundColor: colors.surfaceElevated, borderColor: 'transparent' },
                    selected && {
                      backgroundColor: colors.accent,
                      borderColor: colors.accent,
                    },
                    !automatic && [
                      styles.cadenceDisabled,
                      { backgroundColor: 'transparent', borderColor: colors.border },
                    ],
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected, disabled: !automatic }}
                >
                  <Ionicons
                    name={option.icon}
                    size={19}
                    color={selected ? colors.onAccent : colors.textSecondary}
                  />
                  <Text style={[styles.cadenceLabel, selected && { color: colors.onAccent }]}>
                    {option.label}
                  </Text>
                </Press>
              );
            })}
          </View>
        </View>

        <View style={styles.dock}>
          {busy === 'backup' ? (
            <View style={styles.progressBlock}>
              <View style={styles.progressTop}>
                <Ionicons name="sync-outline" size={17} color={colors.accent} />
                <Text style={styles.progressCount}>
                  {progress ? `${progress.done}/${progress.total}` : '—'}
                </Text>
                <Press
                  onPress={() => {
                    stopRequested.current = true;
                    updateActivity(BACKUP_ACTIVITY, { detail: 'Parando após a nota atual' });
                  }}
                  style={styles.stopButton}
                  accessibilityRole="button"
                  accessibilityLabel="Parar backup"
                >
                  <Ionicons name="stop" size={14} color={colors.text} />
                  <Text style={styles.stopLabel}>Parar</Text>
                </Press>
              </View>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressPercent}%` as `${number}%`,
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
              </View>
            </View>
          ) : (
            <Press
              onPress={() => void handleBackup()}
              disabled={!backupFolder || busy !== null}
              style={[
                styles.runButton,
                { backgroundColor: colors.accent },
                !backupFolder && [
                  styles.runButtonDisabled,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ],
              ]}
              accessibilityRole="button"
              accessibilityLabel="Fazer backup agora"
              accessibilityState={{ disabled: !backupFolder || busy !== null }}
            >
              <Ionicons
                name="play"
                size={17}
                color={backupFolder ? colors.onAccent : colors.textSecondary}
              />
              <Text
                style={[
                  styles.runLabel,
                  { color: colors.onAccent },
                  !backupFolder && { color: colors.textSecondary },
                ]}
              >
                Fazer backup agora
              </Text>
            </Press>
          )}

          {error?.scope === 'backup' ? (
            <Text style={styles.errorText}>{error.message}</Text>
          ) : null}

          {busy === 'restore' ? (
            <View style={styles.restoreProgress}>
              <View style={styles.progressTop}>
                <Ionicons name="sync-outline" size={17} color={colors.accent} />
                <Text style={styles.progressCount}>
                  {progress ? `${progress.done}/${progress.total}` : '—'}
                </Text>
              </View>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressPercent}%` as `${number}%`,
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
              </View>
            </View>
          ) : (
            <Press
              onPress={handleRestore}
              disabled={!canRestore}
              style={styles.restoreRow}
              accessibilityRole="button"
              accessibilityLabel="Restaurar backup"
              accessibilityState={{ disabled: !canRestore }}
            >
              <Ionicons
                name="arrow-undo-outline"
                size={17}
                color={canRestore ? colors.danger : colors.textTertiary}
              />
              <Text
                style={[
                  styles.restoreLabel,
                  { color: canRestore ? colors.text : colors.textTertiary },
                ]}
              >
                Restaurar backup
              </Text>
            </Press>
          )}

          {error?.scope === 'restore' ? (
            <Text style={styles.errorText}>{error.message}</Text>
          ) : null}
        </View>
      </ScrollView>

      <BottomSheet
        visible={helpOpen}
        onClose={() => setHelpOpen(false)}
        cardStyle={styles.helpSheet}
      >
        <Text style={styles.sheetTitle}>No backup</Text>
        {INFO_ROWS.map((row) => (
          <View key={row.label} style={styles.infoRow}>
            <Ionicons
              name={row.icon}
              size={18}
              color={row.included ? colors.textSecondary : colors.textTertiary}
            />
            <Text style={[styles.infoLabel, !row.included && styles.infoLabelOff]}>
              {row.label}
            </Text>
          </View>
        ))}
        <Button label="Fechar" onPress={() => setHelpOpen(false)} style={styles.sheetButton} />
      </BottomSheet>
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
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  hero: { position: 'relative', gap: spacing.xs },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  badge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeNeutral: { borderWidth: 1.5, borderStyle: 'dashed' },
  heroText: { flex: 1, minWidth: 0, gap: spacing.xs },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  bigNumber: {
    color: baseColors.text,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  bigUnit: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  heroSub: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroSubText: {
    flex: 1,
    color: baseColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  heroInfo: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  meter: { height: 4, borderRadius: 2, marginTop: spacing.md, overflow: 'hidden' },
  meterNeutral: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed' },
  meterFill: { height: '100%', borderRadius: 2 },
  grid: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: baseColors.surface,
    borderColor: baseColors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    gap: 2,
  },
  cellFolder: { flex: 1.6 },
  cellRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 0 },
  cap: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cellValue: { flex: 1, color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  pencil: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: baseColors.border,
  },
  switchLabel: { flex: 1, color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  track: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1,
    padding: 3,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  trackOn: { alignItems: 'flex-end' },
  knob: { width: 20, height: 20, borderRadius: 10 },
  knobOn: {},
  cadence: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.md },
  cadenceButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  cadenceDisabled: {},
  cadenceLabel: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  dock: { gap: spacing.sm },
  runButton: {
    minHeight: 52,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  runButtonDisabled: { borderWidth: 1 },
  runLabel: { fontSize: fontSize.md, fontWeight: '600', letterSpacing: 0.2 },
  progressBlock: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: baseColors.surface,
    borderColor: baseColors.border,
    padding: spacing.md,
    gap: spacing.md,
    justifyContent: 'center',
  },
  progressTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressCount: {
    flex: 1,
    color: baseColors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  stopButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: baseColors.surfaceElevated,
  },
  stopLabel: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  progressBar: {
    height: 2,
    borderRadius: 1,
    backgroundColor: baseColors.surfaceElevated,
    overflow: 'hidden',
  },
  progressFill: { height: 2, borderRadius: 1 },
  restoreRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  restoreLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  restoreProgress: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: baseColors.surface,
    borderColor: baseColors.border,
    padding: spacing.md,
    gap: spacing.md,
    justifyContent: 'center',
  },
  errorText: {
    color: baseColors.warning,
    fontSize: fontSize.xs,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
  helpSheet: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  sheetTitle: {
    color: baseColors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
  },
  infoLabel: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '500' },
  infoLabelOff: { color: baseColors.textTertiary },
  sheetButton: { marginTop: spacing.md },
});
