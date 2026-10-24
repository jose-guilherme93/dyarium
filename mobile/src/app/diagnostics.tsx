import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';
import { useFocusEffect } from 'expo-router';
import { back } from '@/services/appNavigation';
import * as Sharing from 'expo-sharing';
import { useCallback, useMemo, useState } from 'react';
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
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import {
  summarizeAnalysisRuns,
  type AnalysisRun,
  type AnalysisRunSummary,
} from '@/core/analysisRuns';
import { DyariumApi, type FetchLike, type ServerAnalysisRunsSummary } from '@/core/api';
import { formatBytes, formatDuration } from '@/core/format';
import { buildMetricsReport, type AnalysisFact } from '@/core/metrics';
import { buildMetricsSnapshot } from '@/core/metricsSnapshot';
import { installedAnalysisModels } from '@/services/analysisModels';
import {
  listAnalysisRuns,
  listCachedAnalyses,
  type CachedAnalysis,
} from '@/services/db';
import { scanImageBytes } from '@/services/storageScan';
import { installedModels } from '@/services/transcriptionModels';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const doFetch = globalThis.fetch as unknown as FetchLike;
const ANALYSIS_DAYS = 30;

function Row({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(baseStyles);

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function toFacts(items: CachedAnalysis[]): AnalysisFact[] {
  return items.map((item) => ({
    entryId: item.entryId,
    origin: item.origin ?? 'server',
    contentHash: item.contentHash,
    model: item.analysis.model,
    sentiment: item.analysis.sentiment,
    sentimentLabel: item.analysis.sentiment_label,
    emotions: item.analysis.emotions,
    themes: (item.analysis.themes ?? []).map((theme) => theme.name),
    people: item.analysis.people ?? undefined,
    places: item.analysis.places ?? undefined,
  }));
}

function SummaryCard({ summary }: { summary: AnalysisRunSummary }) {
  const styles = useThemedStyles(baseStyles);

  const healthy = summary.runs > 0 && summary.successRate >= 0.8;
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Saúde da análise</Text>
      <Text style={[styles.health, healthy ? styles.healthOk : styles.healthWarn]}>
        {summary.runs === 0
          ? 'Sem execuções registradas.'
          : `${percent(summary.successRate)} de sucesso em ${summary.runs} execuções nos últimos ${ANALYSIS_DAYS} dias.`}
      </Text>
      <Row label="Sucesso" value={percent(summary.successRate)} />
      <Row label="Simplificadas" value={percent(summary.simplifiedRate)} />
      <Row label="Tempo médio" value={formatDuration(summary.avgDurationMs)} />
      <Row label="Tokens/s" value={summary.tokensPerSecond.toFixed(1)} />
      <Row
        label="Bateria por análise"
        value={
          summary.avgBatteryDeltaPct === null
            ? 'sem medição'
            : `${summary.avgBatteryDeltaPct.toFixed(1)}%`
        }
      />
    </Card>
  );
}

function ModelsCard({ summary }: { summary: AnalysisRunSummary }) {
  const styles = useThemedStyles(baseStyles);

  if (summary.models.length === 0) return null;
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Por modelo</Text>
      {summary.models.map((model) => (
        <View key={`${model.runtime}-${model.provider}-${model.model}`} style={styles.modelRow}>
          <View style={styles.modelMain}>
            <Text style={styles.modelName} numberOfLines={1}>
              {model.model}
            </Text>
            <Text style={styles.modelMeta}>
              {model.runtime === 'local' ? 'aparelho' : 'servidor'} · {model.provider} ·{' '}
              {model.runs} execuções
            </Text>
          </View>
          <View style={styles.modelStats}>
            <Text style={styles.modelValue}>{percent(model.successRate)}</Text>
            <Text style={styles.modelMeta}>
              {formatDuration(model.avgDurationMs)} · {model.tokensPerSecond.toFixed(1)} tok/s
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

function ServerCard({
  summary,
  configured,
}: {
  summary: ServerAnalysisRunsSummary | null;
  configured: boolean;
}) {
  const styles = useThemedStyles(baseStyles);

  if (!summary) {
    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Servidor</Text>
        <Text style={styles.muted}>
          {configured
            ? 'Não foi possível ler o diagnóstico do servidor agora.'
            : 'Configure o servidor para ver as execuções do worker.'}
        </Text>
      </Card>
    );
  }
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Servidor</Text>
      <Row label="Execuções" value={String(summary.totals.runs)} />
      <Row label="Sucesso" value={percent(summary.totals.success_rate)} />
      <Row label="Simplificadas" value={percent(summary.totals.simplified_rate)} />
      <Row label="Tempo médio" value={formatDuration(summary.totals.avg_duration_ms)} />
      <Row label="Tokens/s" value={summary.totals.tokens_per_second.toFixed(1)} />
      {summary.models.length > 0 ? (
        <View style={styles.serverModels}>
          {summary.models.map((model) => (
            <Text key={`${model.runtime}-${model.provider}-${model.model}`} style={styles.modelMeta}>
              {model.model} · {percent(model.success_rate)} · {model.runs} execuções
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export default function DiagnosticsScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const { recordings } = useLibrary();
  const { config, analysisLowPower } = useSettings();
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [analyses, setAnalyses] = useState<CachedAnalysis[]>([]);
  const [server, setServer] = useState<ServerAnalysisRunsSummary | null>(null);
  const [since, setSince] = useState(0);
  const [analysisModels, setAnalysisModels] = useState<ReturnType<typeof installedAnalysisModels>>([]);
  const [transcriptionBytes, setTranscriptionBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSince(Date.now() - ANALYSIS_DAYS * 24 * 60 * 60 * 1000);
    try {
      const [localRuns, cached] = await Promise.all([
        listAnalysisRuns(),
        listCachedAnalyses().catch(() => []),
      ]);
      setRuns(localRuns);
      setAnalyses(cached);
      setAnalysisModels(installedAnalysisModels());
      setTranscriptionBytes(installedModels().reduce((sum, model) => sum + model.bytes, 0));
      if (config) {
        try {
          const api = new DyariumApi(config, doFetch);
          setServer(await api.analysisRunsSummary(ANALYSIS_DAYS));
        } catch {
          setServer(null);
        }
      } else {
        setServer(null);
      }
    } catch {
      setError('Não foi possível ler o diagnóstico local.');
    } finally {
      setLoading(false);
    }
  }, [config]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const local = useMemo(
    () => summarizeAnalysisRuns(runs, since > 0 ? since : undefined),
    [runs, since],
  );
  const facts = useMemo(() => toFacts(analyses), [analyses]);
  const coverage = useMemo(
    () => buildMetricsReport({ recordings, analyses: facts }).windows['30d'].analysis,
    [recordings, facts],
  );
  const analysisBytes = analysisModels.reduce((sum, model) => sum + model.bytes, 0);

  const exportJson = useCallback(async () => {
    setExporting(true);
    try {
      const now = new Date();
      const document = {
        generated_at: now.toISOString(),
        diagnostics: {
          local: summarizeAnalysisRuns(runs, now.getTime() - ANALYSIS_DAYS * 24 * 60 * 60 * 1000),
          server,
        },
        snapshot: buildMetricsSnapshot(
          recordings,
          now,
          toFacts(analyses),
          scanImageBytes(recordings),
        ),
      };
      const name = `dyarium-metricas-${now.toISOString().replace(/[:.]/g, '-')}.json`;
      const file = new File(Paths.cache, name);
      await Legacy.writeAsStringAsync(file.uri, JSON.stringify(document, null, 2));
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Exportar', 'Compartilhamento indisponível neste aparelho.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Exportar métricas',
      });
    } catch {
      Alert.alert('Exportar', 'Não foi possível gerar o arquivo de métricas.');
    } finally {
      setExporting(false);
    }
  }, [analyses, recordings, runs, server]);

  return (
    <Screen>
      <View style={styles.header}>
        <Press
          onPress={() => back()}
          style={styles.iconButton}
          accessibilityLabel="Voltar"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.headerTitle}>Diagnóstico</Text>
        <Press
          onPress={() => void load()}
          style={styles.iconButton}
          accessibilityLabel="Atualizar"
        >
          <Ionicons name="refresh" size={20} color={colors.text} />
        </Press>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading && runs.length > 0}
            onRefresh={load}
            tintColor={colors.textSecondary}
          />
        }
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SummaryCard summary={local} />
        <ModelsCard summary={local} />

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Cobertura da análise</Text>
          <Row
            label="Notas analisadas"
            value={`${coverage.notesAnalyzed} de ${coverage.notesWithContent} (${percent(coverage.coverage)})`}
          />
          <Row label="Desatualizadas" value={String(coverage.stale)} />
          <Row label="Simplificadas" value={String(coverage.simplified)} />
        </Card>

        <ServerCard summary={server} configured={Boolean(config)} />

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Modelos no aparelho</Text>
          <Row label="Transcrição" value={formatBytes(transcriptionBytes)} />
          <Row label="Análise" value={formatBytes(analysisBytes)} />
          {analysisModels.map((model) => (
            <Row key={model.id} label={model.id} value={formatBytes(model.bytes)} />
          ))}
          <Row label="Modo menos CPU" value={analysisLowPower ? 'ligado' : 'desligado'} />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Exportar</Text>
          <Text style={styles.muted}>
            Gera um JSON com o snapshot e o diagnóstico, sem texto, transcrição ou áudio.
          </Text>
          <Button
            label={exporting ? 'Gerando...' : 'Exportar métricas em JSON'}
            variant="secondary"
            loading={exporting}
            disabled={exporting}
            onPress={() => void exportJson()}
          />
        </Card>

        {loading && runs.length === 0 ? <ActivityIndicator color={colors.textSecondary} /> : null}
      </ScrollView>
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
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  card: { gap: spacing.sm },
  cardTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  muted: { color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  health: { fontSize: fontSize.md, fontWeight: '600' },
  healthOk: { color: baseColors.success },
  healthWarn: { color: baseColors.warning },
  error: { color: baseColors.danger, fontSize: fontSize.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  rowValue: { color: baseColors.text, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.border,
  },
  modelMain: { flex: 1, gap: 2 },
  modelName: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  modelMeta: { color: baseColors.textSecondary, fontSize: fontSize.xs },
  modelStats: { alignItems: 'flex-end', gap: 2 },
  modelValue: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '700' },
  serverModels: { gap: 4, marginTop: spacing.sm },
});
