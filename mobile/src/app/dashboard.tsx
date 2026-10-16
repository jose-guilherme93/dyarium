import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { formatBytes, formatDuration } from '@/core/format';
import { summarize, type RankedItem } from '@/core/dashboard';
import { loadDashboard, type DashboardData } from '@/services/dashboard';
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

export default function DashboardScreen() {
  const { config } = useSettings();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadDashboard();
      setData(result);
    } catch {
      setError('Nao foi possivel carregar o painel. Verifique o servidor e a rede.');
    } finally {
      setLoading(false);
    }
  }, []);

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

      {!config ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>Configure o servidor para ver as metricas.</Text>
          <Button label="Configurar servidor" variant="secondary" onPress={() => router.push('/server')} />
        </View>
      ) : loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.textSecondary} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {summary ? (
            <>
              <View style={styles.metricsRow}>
                <Metric label="Notas" value={String(summary.total)} />
                <Metric label="Transcritas" value={String(summary.transcribed)} />
                <Metric label="Analisadas" value={String(summary.analyzed)} />
              </View>
              <View style={styles.metricsRow}>
                <Metric label="Duracao total" value={formatDuration(summary.totalDurationSeconds * 1000)} />
                <Metric label="Tamanho" value={formatBytes(summary.totalSizeBytes)} />
                <Metric label="Falharam" value={String(summary.failed)} />
              </View>

              {summary.averageSentiment !== null ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Humor</Text>
                  <Text style={styles.sentiment}>
                    Sentimento medio {summary.averageSentiment.toFixed(2)} (
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
                <Text style={styles.muted}>Sem analises de sentimento ainda.</Text>
              )}

              <RankedList title="Emocoes" items={summary.emotions} />
              <RankedList title="Pessoas" items={summary.people} />
              <RankedList title="Lugares" items={summary.places} />

              {data && data.tags.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Tags</Text>
                  <View style={styles.chips}>
                    {data.tags.map((tag) => (
                      <View key={tag.id} style={styles.chip}>
                        <Text style={styles.chipText}>
                          {tag.name} · {tag.entry_count}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Status</Text>
                <View style={styles.chips}>
                  {summary.statusCounts.map((item) => (
                    <View key={item.label} style={styles.chip}>
                      <Text style={styles.chipText}>
                        {item.label} · {item.value}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.md, textAlign: 'center' },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  error: { color: colors.danger, fontSize: fontSize.sm },
  muted: { color: colors.textSecondary, fontSize: fontSize.sm },
  metricsRow: { flexDirection: 'row', gap: spacing.md },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  metricValue: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700' },
  metricLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
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
