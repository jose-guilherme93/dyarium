import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { back, push } from '@/services/appNavigation';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Press } from '@/components/Press';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { formatBytes } from '@/core/format';
import type {
  NoteStorageUsage,
  StorageCategoryId,
  StorageReport,
} from '@/core/storage';
import { clearAllStorageCaches, scanStorage } from '@/services/storageScan';
import { useLibrary } from '@/state/LibraryContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

const CATEGORY_META: Record<StorageCategoryId, { label: string; color: string }> = {
  audio: { label: 'Áudio', color: colors.accent },
  images: { label: 'Imagens', color: colors.info },
  'models-transcription': { label: 'Modelos de transcrição', color: colors.warning },
  'models-analysis': { label: 'Modelos de análise', color: colors.success },
  cache: { label: 'Cache', color: colors.textTertiary },
  database: { label: 'Banco de dados', color: colors.accentStrong },
  other: { label: 'Outros', color: colors.textSecondary },
};

const NOTE_PREVIEW = 20;

function categoryBytes(report: StorageReport, id: StorageCategoryId): number {
  return report.categories.find((category) => category.id === id)?.bytes ?? 0;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{children}</Text>
    </View>
  );
}

function StorageBar({ report }: { report: StorageReport }) {
  const visible = report.categories.filter((category) => category.bytes > 0);
  if (visible.length === 0) return <View style={styles.bar} />;
  return (
    <View style={styles.bar}>
      {visible.map((category) => (
        <View
          key={category.id}
          style={{
            flex: category.bytes,
            backgroundColor: CATEGORY_META[category.id].color,
          }}
        />
      ))}
    </View>
  );
}

function NoteRow({
  note,
  busy,
  onFree,
}: {
  note: NoteStorageUsage;
  busy: boolean;
  onFree(): void;
}) {
  const parts: string[] = [];
  if (note.audioBytes > 0) parts.push(`Áudio ${formatBytes(note.audioBytes)}`);
  if (note.imageBytes > 0) parts.push(`Imagens ${formatBytes(note.imageBytes)}`);
  if (note.otherBytes > 0) parts.push(`Outros ${formatBytes(note.otherBytes)}`);

  return (
    <View style={styles.noteRow}>
      <View style={styles.noteMain}>
        <View style={styles.noteTitleRow}>
          <Text style={styles.noteTitle} numberOfLines={1}>
            {note.title}
          </Text>
          {note.archived ? <Badge>Arquivada</Badge> : null}
          {!note.synced ? <Badge>Só no aparelho</Badge> : null}
        </View>
        <Text style={styles.noteMeta}>{parts.join(' · ')}</Text>
      </View>
      {note.canFreeAudio ? (
        <Press
          style={styles.rowAction}
          onPress={onFree}
          disabled={busy}
          accessibilityLabel={`Liberar áudio de ${note.title}`}
        >
          <Text style={styles.rowActionText}>Liberar áudio</Text>
        </Press>
      ) : null}
    </View>
  );
}

export default function StorageScreen() {
  const { recordings, freeSyncedAudio, freeAudioForNote } = useLibrary();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [scanning, setScanning] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const scanId = scanIdRef.current + 1;
    scanIdRef.current = scanId;
    setScanning(true);
    setError(null);
    try {
      const next = await scanStorage(recordings);
      if (scanId === scanIdRef.current) setReport(next);
    } catch {
      if (scanId === scanIdRef.current) {
        setError('Não foi possível ler o armazenamento do aparelho.');
      }
    } finally {
      if (scanId === scanIdRef.current) {
        setScanning(false);
        setLoaded(true);
      }
    }
  }, [recordings]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => {
      setLoaded(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [loaded]);

  const notes = useMemo(() => report?.notes ?? [], [report]);
  const visibleNotes = useMemo(
    () => (showAll ? notes : notes.slice(0, NOTE_PREVIEW)),
    [notes, showAll],
  );

  const cacheBytes = report
    ? report.caches.reduce((sum, cache) => sum + cache.bytes, 0)
    : 0;
  const modelBytes = report
    ? report.models.transcriptionBytes + report.models.analysisBytes
    : 0;

  const handleFreeAll = () => {
    if (!report || report.syncedWithAudio === 0) return;
    const audioBytes = categoryBytes(report, 'audio');
    Alert.alert(
      'Liberar áudio',
      `Remove o áudio local de ${report.syncedWithAudio} nota(s) já sincronizada(s), cerca de ${formatBytes(audioBytes)}. Imagens, transcrições e o áudio no servidor continuam intactos.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Liberar',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void freeSyncedAudio()
              .then((result) => {
                if (result.notes > 0) {
                  Alert.alert(
                    'Espaço liberado',
                    `${result.notes} nota(s), ${formatBytes(result.bytes)} liberados.`,
                  );
                }
              })
              .catch(() => {
                Alert.alert('Não foi possível liberar', 'Tente novamente.');
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  const handleFreeNote = (note: NoteStorageUsage) => {
    Alert.alert(
      'Liberar áudio',
      `Remove o áudio local de “${note.title}” (${formatBytes(note.audioBytes)}). Imagens e transcrição ficam. O áudio continua no servidor.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Liberar',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void freeAudioForNote(note.id)
              .then((bytes) => {
                if (bytes > 0) {
                  Alert.alert('Espaço liberado', `${formatBytes(bytes)} liberados.`);
                }
              })
              .catch(() => {
                Alert.alert('Não foi possível liberar', 'Tente novamente.');
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  const handleClearCache = () => {
    if (!report || cacheBytes === 0) return;
    Alert.alert(
      'Limpar cache',
      `Remove ${formatBytes(cacheBytes)} de caches regeneráveis, como anexos baixados e WAV temporário. Modelos, notas e banco de dados ficam. Imagens do servidor podem precisar baixar de novo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            try {
              const freed = clearAllStorageCaches();
              Alert.alert('Cache limpo', `${formatBytes(freed)} liberados.`);
              void refresh();
            } catch {
              Alert.alert('Não foi possível limpar', 'Tente novamente.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Press onPress={() => back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Armazenamento</Text>
        <Press onPress={() => void refresh()} style={styles.iconButton} accessibilityLabel="Atualizar">
          {scanning ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Ionicons name="refresh" size={20} color={colors.text} />
          )}
        </Press>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={scanning || !loaded}
            onRefresh={() => void refresh()}
            tintColor={colors.textSecondary}
          />
        }
      >
        {!report && loaded ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.textSecondary} />
          </View>
        ) : null}

        {error ? (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
            <Button label="Tentar de novo" variant="secondary" onPress={() => void refresh()} />
          </View>
        ) : null}

        {report ? (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Armazenamento do app</Text>
              <Text style={styles.summaryValue}>{formatBytes(report.appBytes)}</Text>
              {report.freeBytes !== null ? (
                <Text style={styles.summaryHint}>
                  {formatBytes(report.freeBytes)} livres
                  {report.totalBytes !== null ? ` de ${formatBytes(report.totalBytes)}` : ''} no aparelho
                </Text>
              ) : null}
              <StorageBar report={report} />
              <View style={styles.legend}>
                {report.categories
                  .filter((category) => category.bytes > 0)
                  .map((category) => (
                    <View key={category.id} style={styles.legendRow}>
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: CATEGORY_META[category.id].color },
                        ]}
                      />
                      <Text style={styles.legendLabel}>{CATEGORY_META[category.id].label}</Text>
                      <Text style={styles.legendValue}>{formatBytes(category.bytes)}</Text>
                    </View>
                  ))}
              </View>
            </View>

            {report.lowSpace ? (
              <View style={styles.warning}>
                <Ionicons name="warning-outline" size={18} color={colors.warning} />
                <Text style={styles.warningText}>
                  Espaço livre baixo no aparelho. Libere áudio ou cache para continuar gravando.
                </Text>
              </View>
            ) : null}

            <View style={styles.metrics}>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{report.noteCount}</Text>
                <Text style={styles.metricLabel}>Notas</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{report.withAudio}</Text>
                <Text style={styles.metricLabel}>Com áudio</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{report.syncedWithAudio}</Text>
                <Text style={styles.metricLabel}>Podem liberar</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{report.protectedNotes}</Text>
                <Text style={styles.metricLabel}>Só no aparelho</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Row label="Áudio" value={formatBytes(categoryBytes(report, 'audio'))} />
              <Row label="Imagens" value={formatBytes(categoryBytes(report, 'images'))} />
              <Row label="Banco de dados" value={formatBytes(categoryBytes(report, 'database'))} />
              <Row label="Outros arquivos" value={formatBytes(categoryBytes(report, 'other'))} />
            </View>

            <Text style={styles.sectionLabel}>Cache</Text>
            <View style={styles.card}>
              {report.caches.map((cache) => (
                <Row key={cache.id} label={cache.label} value={formatBytes(cache.bytes)} />
              ))}
            </View>

            <Text style={styles.sectionLabel}>Modelos</Text>
            <Press onPress={() => push('/transcription')}>
              <View style={styles.card}>
                <View style={styles.linkRow}>
                  <View style={styles.linkText}>
                    <Text style={styles.linkTitle}>Gerenciar modelos</Text>
                    <Text style={styles.linkHint}>
                      Transcrição {formatBytes(report.models.transcriptionBytes)} · Análise{' '}
                      {formatBytes(report.models.analysisBytes)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </View>
              </View>
            </Press>

            <Text style={styles.sectionLabel}>Ações</Text>
            <View style={styles.actions}>
              <Button
                label={
                  report.syncedWithAudio > 0
                    ? `Liberar áudio sincronizado (${report.syncedWithAudio})`
                    : 'Nenhum áudio sincronizado'
                }
                variant="secondary"
                onPress={handleFreeAll}
                disabled={report.syncedWithAudio === 0 || busy}
                loading={busy}
              />
              <Button
                label={cacheBytes > 0 ? `Limpar cache (${formatBytes(cacheBytes)})` : 'Sem cache'}
                variant="secondary"
                onPress={handleClearCache}
                disabled={cacheBytes === 0 || busy}
              />
            </View>

            <Text style={styles.sectionLabel}>Notas com arquivos locais</Text>
            {notes.length === 0 ? (
              <Text style={styles.hint}>
                Nenhuma nota com áudio ou imagem local. O texto das notas fica no banco de dados.
              </Text>
            ) : (
              <View style={styles.card}>
                {visibleNotes.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    busy={busy}
                    onFree={() => handleFreeNote(note)}
                  />
                ))}
              </View>
            )}

            {notes.length > NOTE_PREVIEW ? (
              <Press onPress={() => setShowAll((value) => !value)} style={styles.showAll}>
                <Text style={styles.showAllText}>
                  {showAll ? 'Mostrar menos' : `Mostrar todas (${notes.length})`}
                </Text>
                <Ionicons
                  name={showAll ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.accent}
                />
              </Press>
            ) : null}

            <Text style={styles.hint}>
              Liberar áudio remove apenas os arquivos de áudio das notas já sincronizadas. Imagens,
              transcrições e o áudio no servidor continuam intactos. Modelos: {formatBytes(modelBytes)}.
            </Text>
          </>
        ) : null}
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
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  summaryLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  summaryValue: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '700' },
  summaryHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  bar: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  legend: { gap: spacing.xs, marginTop: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm },
  legendValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warningText: { flex: 1, color: colors.warning, fontSize: fontSize.sm, lineHeight: 20 },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  metricValue: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: { color: colors.textTertiary, fontSize: fontSize.xs, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: colors.textSecondary, fontSize: fontSize.md },
  rowValue: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  linkText: { flex: 1, gap: 2 },
  linkTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  linkHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  actions: { gap: spacing.sm },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  noteMain: { flex: 1, gap: 3 },
  noteTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  noteTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 },
  noteMeta: { color: colors.textSecondary, fontSize: fontSize.sm },
  badge: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  rowAction: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowActionText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  showAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  showAllText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
