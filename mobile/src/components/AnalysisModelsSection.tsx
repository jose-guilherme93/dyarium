import { Ionicons } from '@expo/vector-icons';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { Card } from '@/components/Card';
import {
  ANALYSIS_MODEL_FAMILIES,
  ANALYSIS_MODELS,
  analysisModelById,
  analysisVariantFor,
  modelFitsDevice,
  recommendAnalysisModel,
  type AnalysisModelVariant,
} from '@/core/analysisModels';
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
  analyzeNote,
  loadAnalysisContext,
  localAnalysisAvailable,
  releaseAnalysisContext,
} from '@/services/localAnalysis';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const BENCHMARK_NOTES = 3;

interface BenchmarkRow {
  title: string;
  wallMs: number;
  valid: boolean;
  blocks: number;
  read: number;
  rejected: number;
  dropped: number;
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
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

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
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

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
  // Quant escolhida em cada familia: a tela mostra uma linha por modelo, com o
  // interruptor rapida/qualidade no lugar de duas entradas na lista.
  const [variants, setVariants] = useState<Record<string, AnalysisModelVariant>>({});

  const selected = useMemo(
    () => analysisModelById(analysisModel) ?? recommended ?? ANALYSIS_MODELS[0],
    [analysisModel, recommended],
  );

  // Um id antigo (modelo que saiu do catalogo) nao pode continuar salvo: a
  // tela mostraria o recomendado como se estivesse em uso e o botao da nota
  // diria que nao ha modelo. Migra para o recomendado ou o primeiro da lista.
  useEffect(() => {
    if (analysisModelById(analysisModel)) return;
    const next = recommended ?? ANALYSIS_MODELS[0];
    if (next) void setAnalysisModel(next.id).catch(() => undefined);
  }, [analysisModel, recommended, setAnalysisModel]);

  const variantFor = (familyId: string): AnalysisModelVariant => {
    const family = ANALYSIS_MODEL_FAMILIES.find((item) => item.id === familyId);
    if (!family) return 'quality';
    return variants[familyId] ?? analysisVariantFor(family, analysisModel);
  };

  const refresh = () => {
    setInstalled(installedAnalysisModels().map((model) => model.id));
    setBytes(installedAnalysisModelsBytes());
  };

  const handleDownload = async (id: string) => {
    // Um download por vez: dois arquivos grandes concorrendo no mesmo link
    // enchem o buffer e ainda disputam a RAM com o app.
    if (downloading) return;
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
    // Lista fresca: a copia de `installed` deste render ainda tem o arquivo
    // apagado e poderia escolher ele como proximo modelo.
    const remaining = installedAnalysisModels().map((model) => model.id);
    refresh();
    if (id === analysisModel) {
      const next = remaining[0] ?? recommended?.id ?? ANALYSIS_MODELS[0]?.id;
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

      {ANALYSIS_MODEL_FAMILIES.map((family) => {
        const variant = variantFor(family.id);
        const model = family[variant];
        const isInstalled = installed.includes(model.id);
        const isSelected = selected?.id === model.id;
        const isDownloading = downloading === model.id;
        return (
          <Card key={family.id} style={styles.modelCard}>
            <Press
              style={styles.modelMain}
              onPress={() => isInstalled && void setAnalysisModel(model.id)}
              disabled={!isInstalled}
              accessibilityLabel={`${family.label}, ${variant === 'fast' ? 'rápida' : 'qualidade'}`}
            >
              <Ionicons
                name={isSelected && isInstalled ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={isSelected && isInstalled ? colors.accent : colors.textTertiary}
              />
              <View style={styles.rowText}>
                <View style={styles.modelTitleRow}>
                  <Text style={styles.cardTitle}>{family.label}</Text>
                  {recommended?.family === family.id ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Recomendado</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardHint}>
                  {formatBytes(model.sizeBytes)} · {formatBytes(model.minRamBytes)} de RAM ·{' '}
                  {model.license}
                  {isInstalled ? ' · baixado' : ''}
                </Text>
                {modelFitsDevice(model, Device.totalMemory) === false ? (
                  <Text style={styles.ramWarning}>
                    Este aparelho tem {formatBytes(Device.totalMemory ?? 0)}; esta versão pode ser
                    encerrada pelo sistema.
                  </Text>
                ) : null}
                {family.id === 'lfm2.5-230m' && variant === 'fast' ? (
                  <Text style={styles.cardHint}>Último recurso: reconhece menos itens.</Text>
                ) : null}
              </View>
            </Press>

            <View style={styles.variantRow}>
              {(['fast', 'quality'] as const).map((option) => {
                const active = option === variant;
                const installedOption = installed.includes(family[option].id);
                return (
                  <Press
                    key={option}
                    style={[
                      styles.variantItem,
                      active && styles.variantItemActive,
                      downloading !== null && styles.variantItemDisabled,
                    ]}
                    onPress={() =>
                      setVariants((current) => ({ ...current, [family.id]: option }))
                    }
                    disabled={downloading !== null}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: downloading !== null }}
                    accessibilityLabel={`${family.label}, ${option === 'fast' ? 'rápida' : 'qualidade'}${installedOption ? ', baixada' : ''}`}
                  >
                    <Text style={[styles.variantText, active && styles.variantTextActive]}>
                      {option === 'fast' ? 'Rápida' : 'Qualidade'}
                    </Text>
                    {installedOption ? <View style={styles.variantDot} /> : null}
                  </Press>
                );
              })}
            </View>

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
                    accessibilityLabel={`Usar ${family.label}, ${variant === 'fast' ? 'rápida' : 'qualidade'}`}
                  >
                    <Text style={styles.useText}>Usar</Text>
                  </Press>
                ) : (
                  <Text style={styles.useText}>Em uso</Text>
                )}
                <Press
                  onPress={() => void handleDelete(model.id)}
                  accessibilityLabel={`Apagar ${family.label}, ${variant === 'fast' ? 'rápida' : 'qualidade'}`}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Press>
              </View>
            ) : (
              <Press
                style={styles.downloadButton}
                onPress={() => void handleDownload(model.id)}
                accessibilityLabel={`Baixar e usar ${family.label}, ${variant === 'fast' ? 'rápida' : 'qualidade'}`}
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
        {bytes > 0 ? `Usando ${formatBytes(bytes)} no aparelho. ` : 'Nenhum modelo de análise baixado. '}
        LFM2.5 usa a LFM Open License v1.0; Qwen3.5 usa Apache-2.0.
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
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

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
        .filter(
          (recording) =>
            (recording.text ?? '').trim().length > 0 || (recording.transcript ?? '').trim().length > 0,
        )
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
        const result = await analyzeNote(
          {
            id: recording.id,
            text: recording.text ?? '',
            transcript: recording.transcript ?? '',
            transcriptSegments: recording.transcriptSegments,
            author: recording.author,
          },
          model,
          {
            entryKey: `bench:${recording.id}`,
            title: recording.title || 'Nota',
            persist: false,
          },
        );
        out.push({
          title: recording.title || 'Nota',
          wallMs: result.wallMs,
          valid: result.doc.blocksRead > 0,
          blocks: result.doc.blocksTotal,
          read: result.doc.blocksRead,
          rejected: result.rejected,
          dropped: result.droppedItems,
          reading: result.doc.sentence,
          promptPerSecond:
            result.promptTokens > 0 && result.wallMs > 0
              ? (result.promptTokens * 1000) / result.wallMs
              : 0,
          predictedPerSecond: result.predictedPerSecond,
          raw: `${result.doc.toneLabel} (${result.doc.tone}) · ${result.doc.people.length} pessoas · ${result.doc.places.length} lugares · ${result.doc.events.length} eventos · ${result.doc.themes.length} temas · ${result.doc.decisions.length} decisões · ${result.doc.tasks.length} tarefas · ${result.doc.ideas.length} ideias · ${result.doc.moments.length} momentos`,
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
              {(row.wallMs / 1000).toFixed(1)} s · {row.valid ? `${row.read}/${row.blocks} blocos` : 'nada lido'}
              {row.rejected > 0 ? ` · ${row.rejected} recusados` : ''}
              {row.dropped > 0 ? ` · ${row.dropped} descartados` : ''} ·{' '}
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

const baseStyles = defineStyles({
  sectionLabel: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
  },
  card: { gap: spacing.sm },
  cardTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  cardHint: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  noticeText: { flex: 1, color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  rowText: { flex: 1, gap: 2 },
  modelCard: { gap: spacing.sm },
  modelMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modelActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md },
  variantRow: {
    flexDirection: 'row',
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.sm,
    padding: 2,
    gap: 2,
  },
  variantItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
  },
  variantItemActive: { backgroundColor: baseColors.surfaceElevated },
  variantItemDisabled: { opacity: 0.5 },
  variantText: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  variantTextActive: { color: baseColors.text },
  variantDot: { width: 5, height: 5, borderRadius: radius.pill, backgroundColor: baseColors.accent },
  badge: {
    backgroundColor: baseColors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { color: baseColors.accent, fontSize: fontSize.xs, fontWeight: '700' },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 4,
    backgroundColor: baseColors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  downloadText: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  useButton: {
    backgroundColor: baseColors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  useText: { color: baseColors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  progressWrap: { gap: 4 },
  progressTrack: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: baseColors.surfaceElevated,
    overflow: 'hidden',
  },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: baseColors.accent },
  ramWarning: { color: baseColors.warning, fontSize: fontSize.xs, lineHeight: 17 },
  error: { color: baseColors.danger, fontSize: fontSize.sm },
  benchmarkActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  disabled: { opacity: 0.5 },
  benchmarkRow: {
    gap: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
    paddingTop: spacing.sm,
  },
  reading: { color: baseColors.text, fontSize: fontSize.sm, lineHeight: 20 },
  raw: { color: baseColors.textTertiary, fontSize: fontSize.xs, lineHeight: 16 },
});
