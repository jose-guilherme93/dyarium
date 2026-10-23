import { Ionicons } from '@expo/vector-icons';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Press } from '@/components/Press';

import { Card } from '@/components/Card';
import {
  ANALYSIS_MODELS,
  analysisModelById,
  modelFitsDevice,
  recommendAnalysisModel,
} from '@/core/analysisModels';
import { analysisNoteContent } from '@/core/analysisPrompt';
import { localAnalysisEnabled } from '@/core/features';
import { formatBytes } from '@/core/format';
import type { Recording } from '@/core/types';
import {
  deleteAnalysisModel,
  downloadAnalysisModel,
  installedAnalysisModels,
  installedAnalysisModelsBytes,
} from '@/services/analysisModels';
import {
  analyzeRecording,
  loadAnalysisContext,
  localAnalysisAvailable,
  releaseAnalysisContext,
} from '@/services/localAnalysis';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

const BENCHMARK_NOTES = 3;

interface BenchmarkRow {
  title: string;
  wallMs: number;
  valid: boolean;
  reading: string;
  promptPerSecond: number;
  predictedPerSecond: number;
  raw: string;
}

function useBatteryLabel(): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    let alive = true;
    Battery.getPowerStateAsync()
      .then((state) => {
        if (!alive) return;
        const level =
          state.batteryLevel >= 0 ? `${Math.round(state.batteryLevel * 100)}%` : 'indisponível';
        setLabel(
          `${level}${state.batteryState === Battery.BatteryState.CHARGING ? ' (carregando)' : ''}`,
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return label;
}

/**
 * Modelos de analise local e um benchmark de desenvolvimento. O download e
 * "baixar e usar": ao terminar, o modelo fica selecionado. Nada roda sozinho.
 */
/**
 * A analise local ainda esta em desenvolvimento. O recurso fica desligado por
 * padrao e so aparece com EXPO_PUBLIC_LOCAL_ANALYSIS=1 (ver docs/analise-local).
 */
export function AnalysisModelsSection() {
  if (!localAnalysisEnabled()) {
    return (
      <>
        <Text style={styles.sectionLabel}>Análise de sentimentos</Text>
        <Card style={styles.notice}>
          <Ionicons name="flask-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.noticeText}>
            Análise local em desenvolvimento. Recurso desligado nesta versão.
          </Text>
        </Card>
      </>
    );
  }
  return <EnabledAnalysisModelsSection />;
}

function EnabledAnalysisModelsSection() {
  const { analysisModel, setAnalysisModel } = useSettings();
  const {
    recordings,
  } = useLibrary();
  const battery = useBatteryLabel();
  const available = localAnalysisAvailable();
  const showBenchmark = __DEV__ || process.env.EXPO_PUBLIC_ANALYSIS_BENCHMARK === '1';
  const recommended = recommendAnalysisModel(Device.totalMemory);
  const [installed, setInstalled] = useState<string[]>(() =>
    installedAnalysisModels().map((model) => model.id),
  );
  const [bytes, setBytes] = useState(() => installedAnalysisModelsBytes());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => analysisModelById(analysisModel) ?? recommended ?? ANALYSIS_MODELS[0],
    [analysisModel, recommended],
  );

  const refresh = () => {
    setInstalled(installedAnalysisModels().map((model) => model.id));
    setBytes(installedAnalysisModelsBytes());
  };

  const handleDownload = async (id: string) => {
    setError(null);
    setDownloading(id);
    setProgress(0);
    try {
      await downloadAnalysisModel(id, { onProgress: setProgress });
      refresh();
      await setAnalysisModel(id);
    } catch {
      setError('Não foi possível baixar o modelo. Verifique a conexão e o espaço.');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (id: string) => {
    await releaseAnalysisContext();
    deleteAnalysisModel(id);
    refresh();
    if (id === analysisModel) {
      const next = installed.find((item) => item !== id) ?? recommended?.id ?? ANALYSIS_MODELS[0]?.id;
      if (next) await setAnalysisModel(next);
    }
  };

  return (
    <>
      <Text style={styles.sectionLabel}>Análise de sentimentos</Text>
      <Text style={styles.cardHint}>
        {Device.totalMemory
          ? `Este aparelho tem ${formatBytes(Device.totalMemory)} de RAM.`
          : 'Não foi possível ler a RAM do aparelho.'}
        {battery ? ` Bateria em ${battery}.` : ''}
      </Text>

      {!available ? (
        <Card style={styles.notice}>
          <Ionicons name="construct-outline" size={18} color={colors.warning} />
          <Text style={styles.noticeText}>
            Disponível depois do próximo build: este APK ainda não tem o módulo de análise local.
            Você já pode baixar o modelo; a análise começa a funcionar no novo build.
          </Text>
        </Card>
      ) : null}

      {!recommended ? (
        <Card style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
          <Text style={styles.noticeText}>
            Este aparelho tem pouca RAM para análise local. A análise continua disponível pelo
            servidor.
          </Text>
        </Card>
      ) : null}

      {ANALYSIS_MODELS.map((model) => {
        const isInstalled = installed.includes(model.id);
        const isSelected = selected?.id === model.id;
        const isDownloading = downloading === model.id;
        return (
          <Card key={model.id} style={styles.modelCard}>
            <Press
              style={styles.modelMain}
              onPress={() => isInstalled && void setAnalysisModel(model.id)}
              disabled={!isInstalled}
              accessibilityLabel={model.label}
            >
              <Ionicons
                name={isSelected && isInstalled ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={isSelected && isInstalled ? colors.accent : colors.textTertiary}
              />
              <View style={styles.rowText}>
                <View style={styles.modelTitleRow}>
                  <Text style={styles.cardTitle}>{model.label}</Text>
                  {recommended?.id === model.id ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Recomendado</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardHint}>
                  {model.fileName.replace('.gguf', '')} · {formatBytes(model.sizeBytes)} ·{' '}
                  {formatBytes(model.minRamBytes)} de RAM
                  {isInstalled ? ' · baixado' : ''}
                </Text>
                {modelFitsDevice(model, Device.totalMemory) === false ? (
                  <Text style={styles.ramWarning}>
                    Este aparelho tem {formatBytes(Device.totalMemory ?? 0)}; o modelo pode ser
                    encerrado pelo sistema.
                  </Text>
                ) : null}
              </View>
            </Press>

            {isDownloading ? (
              <View style={styles.progressWrap}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <Text style={styles.cardHint}>{Math.round(progress * 100)}%</Text>
              </View>
            ) : isInstalled ? (
              <View style={styles.modelActions}>
                {!isSelected ? (
                  <Press
                    style={styles.useButton}
                    onPress={() => void setAnalysisModel(model.id)}
                    accessibilityLabel={`Usar ${model.label}`}
                  >
                    <Text style={styles.useText}>Usar</Text>
                  </Press>
                ) : null}
                <Press
                  onPress={() => void handleDelete(model.id)}
                  accessibilityLabel={`Apagar ${model.label}`}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Press>
              </View>
            ) : (
              <Press
                style={styles.downloadButton}
                onPress={() => void handleDownload(model.id)}
                accessibilityLabel={`Baixar e usar ${model.label}`}
              >
                <Ionicons name="download-outline" size={16} color={colors.text} />
                <Text style={styles.downloadText}>Baixar e usar</Text>
              </Press>
            )}
          </Card>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.cardHint}>
        {bytes > 0 ? `Usando ${formatBytes(bytes)} no aparelho.` : 'Nenhum modelo de análise baixado.'}
      </Text>

      {showBenchmark ? (
        <BenchmarkPanel
          modelId={selected?.id}
          installed={Boolean(selected && installed.includes(selected.id))}
          recordings={recordings}
        />
      ) : null}
    </>
  );
}

function BenchmarkPanel({
  modelId,
  installed,
  recordings,
}: {
  modelId: string | undefined;
  installed: boolean;
  recordings: Recording[];
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const model = analysisModelById(modelId);
  const available = localAnalysisAvailable();
  const sample = useMemo(
    () =>
      recordings
        .filter((recording) => analysisNoteContent(recording).text.length > 0)
        .slice(0, BENCHMARK_NOTES),
    [recordings],
  );

  const run = async () => {
    if (!model || !installed || sample.length === 0) return;
    setRunning(true);
    setRows([]);
    setError(null);
    setLoadMs(null);
    try {
      setProgress('carregando modelo');
      const loadStart = Date.now();
      await loadAnalysisContext(model);
      setLoadMs(Date.now() - loadStart);

      const out: BenchmarkRow[] = [];
      for (let index = 0; index < sample.length; index += 1) {
        const recording = sample[index];
        setProgress(`analisando ${index + 1} de ${sample.length}`);
        const result = await analyzeRecording(recording, model);
        out.push({
          title: recording.title || 'Nota',
          wallMs: result.run.wallMs,
          valid: result.parsed !== null,
          reading: result.parsed?.reading ?? '',
          promptPerSecond: result.run.timings?.promptPerSecond ?? 0,
          predictedPerSecond: result.run.timings?.predictedPerSecond ?? 0,
          raw: result.run.text,
        });
        setRows([...out]);
      }
      setProgress('concluído');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[analysis] benchmark failed', message);
      setError(
        `A análise falhou (${model?.id ?? 'sem modelo'}): ${message || 'erro desconhecido'}.`,
      );
      setProgress('');
    } finally {
      setRunning(false);
    }
  };

  const release = async () => {
    await releaseAnalysisContext();
    setProgress('modelo liberado');
    setLoadMs(null);
  };

  return (
    <>
      <Text style={styles.sectionLabel}>Benchmark (dev)</Text>
      <Card style={styles.card}>
        <Text style={styles.cardHint}>
          Roda nas {BENCHMARK_NOTES} notas mais recentes com texto ou transcrição. O tempo de
          carregar o modelo aparece separado.
        </Text>
        <View style={styles.benchmarkActions}>
          <Press
            style={[styles.downloadButton, (!available || !installed || running) && styles.disabled]}
            onPress={() => void run()}
            disabled={!available || !installed || running}
            accessibilityLabel="Rodar benchmark"
          >
            {running ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name="flask-outline" size={16} color={colors.text} />
            )}
            <Text style={styles.downloadText}>{running ? progress : 'Rodar benchmark'}</Text>
          </Press>
          <Press
            style={styles.useButton}
            onPress={() => void release()}
            accessibilityLabel="Liberar modelo"
          >
            <Text style={styles.useText}>Liberar modelo</Text>
          </Press>
        </View>
        {loadMs !== null ? (
          <Text style={styles.cardHint}>Carga do modelo: {(loadMs / 1000).toFixed(1)} s</Text>
        ) : null}
        {rows.map((row, index) => (
          <View key={`${row.title}-${index}`} style={styles.benchmarkRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {row.title}
            </Text>
            <Text style={styles.cardHint}>
              {(row.wallMs / 1000).toFixed(1)} s · {row.valid ? 'JSON válido' : 'JSON inválido'} ·{' '}
              {row.promptPerSecond.toFixed(0)} tok/s prompt · {row.predictedPerSecond.toFixed(1)}{' '}
              tok/s geração
            </Text>
            {row.reading ? <Text style={styles.reading}>{row.reading}</Text> : null}
            <Text style={styles.raw} numberOfLines={8} selectable>
              {row.raw}
            </Text>
          </View>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
  },
  card: { gap: spacing.sm },
  cardTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  cardHint: { color: colors.textSecondary, fontSize: fontSize.sm },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  noticeText: { flex: 1, color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  rowText: { flex: 1, gap: 2 },
  modelCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modelActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  downloadText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  useButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  useText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  progressWrap: { alignItems: 'flex-end', gap: 4, width: 72 },
  progressTrack: {
    width: 72,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
  ramWarning: { color: colors.warning, fontSize: fontSize.xs, lineHeight: 17 },
  error: { color: colors.danger, fontSize: fontSize.sm },
  benchmarkActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  disabled: { opacity: 0.5 },
  benchmarkRow: {
    gap: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingTop: spacing.sm,
  },
  reading: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
  raw: { color: colors.textTertiary, fontSize: fontSize.xs, lineHeight: 16 },
});
