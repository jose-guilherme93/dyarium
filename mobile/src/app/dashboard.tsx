import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { summarize, type RankedItem } from '@/core/dashboard';
import { formatBytes, formatDateTime, formatDuration } from '@/core/format';
import { analyzeWriting, type WritingMetrics } from '@/core/writing';
import { loadDashboard, type DashboardData } from '@/services/dashboard';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings } from '@/state/SettingsContext';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

function sentimentLabel(value: number): string {
  if (value > 0.15) return 'positivo';
  if (value < -0.15) return 'negativo';
  return 'neutro';
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function RankedList({ title, items }: { title: string; items: RankedItem[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.chips}>
        {items.map((item) => (
          <View key={item.label} style={styles.chip}>
            <Text style={styles.chipText}>
              {item.label} · {item.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Insights({ metrics }: { metrics: WritingMetrics }) {
  if (metrics.insights.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Insights</Text>
      <View style={styles.insights}>
        {metrics.insights.map((text) => (
          <View key={text} style={styles.insight}>
            <Ionicons name="sparkles-outline" size={15} color={colors.accent} />
            <Text style={styles.insightText}>{text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function WritingSection({ metrics }: { metrics: WritingMetrics }) {
  const number = (value: number) => value.toLocaleString('pt-BR');
  return (
    <>
      <Text style={styles.blockTitle}>Escrita</Text>
      <Insights metrics={metrics} />

      <View style={styles.metricsRow}>
        <Metric label="Palavras" value={number(metrics.words)} />
        <Metric label="Notas" value={number(metrics.notes)} />
        <Metric label="Com texto" value={number(metrics.withText)} />
      </View>
      <View style={styles.metricsRow}>
        <Metric label="Caracteres" value={number(metrics.chars)} />
        <Metric label="Frases" value={number(metrics.sentences)} />
        <Metric label="Parágrafos" value={number(metrics.paragraphs)} />
      </View>
      <View style={styles.metricsRow}>
        <Metric label="Vocabulário" value={number(metrics.uniqueWords)} />
        <Metric label="Riqueza" value={`${Math.round(metrics.lexicalRichness * 100)}%`} />
        <Metric label="Palavras/nota" value={String(metrics.averageWordsPerNote)} />
      </View>
      <View style={styles.metricsRow}>
        <Metric label="Palavras/frase" value={String(metrics.averageSentenceWords)} />
        <Metric label="Letras/palavra" value={String(metrics.averageWordLength)} />
        <Metric label="Palavras longas" value={number(metrics.longestWords.length)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Marcadores</Text>
        <View style={styles.chips}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Perguntas · {metrics.questions}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Exclamações · {metrics.exclamations}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Links · {metrics.links}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Imagens · {metrics.images}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Itens de lista · {metrics.listItems}</Text>
          </View>
        </View>
      </View>

      <RankedList title="Palavras mais usadas" items={metrics.topWords} />
      <RankedList title="Palavras mais longas" items={metrics.longestWords} />

      <View style={styles.metricsRow}>
        <Metric label="Dias com nota" value={number(metrics.activeDays)} />
        <Metric label="Sequência" value={`${metrics.currentStreak}/${metrics.longestStreak}`} />
        <Metric
          label="Notas/dia"
          value={String(metrics.averageNotesPerActiveDay)}
        />
      </View>
      {metrics.topWeekday && metrics.topHour ? (
        <View style={styles.metricsRow}>
          <Metric label="Dia que mais escreve" value={metrics.topWeekday.label} />
          <Metric label="Período" value={metrics.topHour.label} />
          <Metric label="Palavras faladas" value={number(metrics.transcriptWords)} />
        </View>
      ) : null}

      {metrics.longestNote && metrics.longestNote.words > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Destaques</Text>
          <View style={styles.row}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {metrics.longestNote.title}
            </Text>
            <Text style={styles.rowValue}>{number(metrics.longestNote.words)} palavras</Text>
          </View>
          {metrics.firstAt && metrics.lastAt ? (
            <Text style={styles.muted}>
              Do primeiro registro em {formatDateTime(metrics.firstAt)} até {formatDateTime(metrics.lastAt)}.
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

export default function DashboardScreen() {
  const { config } = useSettings();
  const { recordings } = useLibrary();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writing = useMemo(() => analyzeWriting(recordings, new Date()), [recordings]);

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadDashboard();
      setData(result);
    } catch {
      setError('Nao foi possivel carregar o painel do servidor. Verifique a rede.');
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const summary = data ? summarize(data.entries, data.analyses.map((item) => item.analysis)) : null;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Painel</Text>
        <Pressable onPress={() => void load()} style={styles.iconButton} accessibilityLabel="Atualizar">
          <Ionicons name="refresh" size={20} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.textSecondary} />
        }
      >
        {writing.notes === 0 ? (
          <Text style={styles.muted}>
            Escreva sua primeira nota e o painel mostra as métricas da sua escrita.
          </Text>
        ) : (
          <WritingSection metrics={writing} />
        )}

        <Text style={styles.blockTitle}>Servidor</Text>
        {!config ? (
          <View style={styles.section}>
            <Text style={styles.muted}>
              Humor, emoções, pessoas e lugares são analisados pelo servidor. Configure para ver.
            </Text>
            <Button label="Configurar servidor" variant="secondary" onPress={() => router.push('/server')} />
          </View>
        ) : loading && !data ? (
          <ActivityIndicator size="large" color={colors.textSecondary} />
        ) : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {summary ? (
              <>
                <View style={styles.metricsRow}>
                  <Metric label="Notas" value={String(summary.total)} />
                  <Metric label="Transcritas" value={String(summary.transcribed)} />
                  <Metric label="Analisadas" value={String(summary.analyzed)} />
                </View>
                <View style={styles.metricsRow}>
                  <Metric label="Duração total" value={formatDuration(summary.totalDurationSeconds * 1000)} />
                  <Metric label="Tamanho" value={formatBytes(summary.totalSizeBytes)} />
                  <Metric label="Falharam" value={String(summary.failed)} />
                </View>

                {summary.averageSentiment !== null ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Humor</Text>
                    <Text style={styles.sentiment}>
                      Sentimento médio {summary.averageSentiment.toFixed(2)} (
                      {sentimentLabel(summary.averageSentiment)})
                    </Text>
                    {data?.analyses.slice(0, 10).map((item) => (
                      <View key={item.entry.id} style={styles.row}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {item.entry.title || item.entry.original_filename}
                        </Text>
                        <Text style={styles.rowValue}>{item.analysis.sentiment.toFixed(2)}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.muted}>Sem análises de sentimento ainda.</Text>
                )}

                <RankedList title="Emoções" items={summary.emotions} />
                <RankedList title="Pessoas" items={summary.people} />
                <RankedList title="Lugares" items={summary.places} />
                <RankedList
                  title="Tags"
                  items={data?.tags.map((tag) => ({ label: tag.name, value: tag.entry_count })) ?? []}
                />
                <RankedList title="Status" items={summary.statusCounts} />
              </>
            ) : null}
          </>
        )}
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
  blockTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  error: { color: colors.danger, fontSize: fontSize.sm },
  muted: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  metricsRow: { flexDirection: 'row', gap: spacing.md },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  metricValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  metricLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  insights: { gap: spacing.sm },
  insight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  insightText: { flex: 1, color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
  sentiment: { color: colors.text, fontSize: fontSize.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowTitle: { flex: 1, color: colors.text, fontSize: fontSize.sm },
  rowValue: { color: colors.textSecondary, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: { color: colors.text, fontSize: fontSize.sm },
});
