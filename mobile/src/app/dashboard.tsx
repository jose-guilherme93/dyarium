import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { summarize, toAnalysisInsights, type AnalysisInsight, type RankedItem } from '@/core/dashboard';
import { formatBytes, formatDateTime, formatDuration } from '@/core/format';
import { analyzeWriting, writingHistory, CONSISTENCY_WINDOW_DAYS, type ConsistencyMetrics, type DayCell, type MonthlyPoint, type SentimentMetrics, type WritingHistory, type WritingMetrics } from '@/core/writing';
import { loadDashboard, type DashboardData } from '@/services/dashboard';
import { listCachedAnalyses, type CachedAnalysis } from '@/services/db';
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

/** Cores do mapa de calor (0 = sem escrita, 4 = muito). */
const HEAT = ['#2C2C2E', 'rgba(10,132,255,0.28)', 'rgba(10,132,255,0.5)', 'rgba(10,132,255,0.75)', '#0A84FF'];

/** Grafico de linha com react-native-svg. Desligado ate o build com o modulo. */
const SVG_ENABLED = false;
const HOUR_LABELS = ['0h', '3h', '6h', '9h', '12h', '15h', '18h', '21h'];
const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function heatColor(cell: DayCell, max: number): string {
  if (cell.key === null) return 'transparent';
  if (cell.words === 0) return HEAT[cell.notes > 0 ? 1 : 0];
  const level = Math.min(4, Math.max(1, Math.ceil((cell.words / Math.max(1, max)) * 4)));
  return HEAT[level];
}

function levelColor(value: number, max: number): string {
  if (value <= 0) return HEAT[0];
  return HEAT[Math.min(4, Math.max(1, Math.ceil((value / Math.max(1, max)) * 4)))];
}

function BarChart({
  title,
  points,
  labelEvery = 3,
  caption,
}: {
  title: string;
  points: { label: string; value: number }[];
  labelEvery?: number;
  caption?: string;
}) {
  const max = Math.max(1, ...points.map((point) => point.value));
  // Rotulos por posicao absoluta: com `flex: 1` cada rotulo tinha a largura de
  // UMA barra e "DD/MM" era cortado. Aqui o rotulo pode ser mais largo que a
  // barra e continua centralizado nela.
  const [labelRowWidth, setLabelRowWidth] = useState(0);
  const gap = 4;
  const slot = labelRowWidth > 0 && points.length > 0 ? (labelRowWidth - gap * (points.length - 1)) / points.length : 0;
  const every = Math.max(1, labelEvery);
  const labelWidth = slot > 0 ? Math.min(72, Math.max(40, slot * every)) : 0;
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {caption ? <Text style={styles.muted}>{caption}</Text> : null}
      <View style={styles.bars}>
        {points.map((point, index) => (
          <View key={index} style={styles.barSlot}>
            <View
              style={[
                styles.bar,
                { height: point.value > 0 ? Math.max(3, Math.round((point.value / max) * 84)) : 2 },
              ]}
            />
          </View>
        ))}
      </View>
      {labelEvery > 0 ? (
        <View
          style={styles.barLabels}
          onLayout={(event) => setLabelRowWidth(event.nativeEvent.layout.width)}
        >
          {slot > 0
            ? points.map((point, index) => {
                if (index % every !== 0) {
                  return null;
                }
                const center = index * (slot + gap) + slot / 2;
                return (
                  <Text
                    key={index}
                    style={[styles.barLabel, { position: 'absolute', left: center - labelWidth / 2, width: labelWidth }]}
                    numberOfLines={1}
                  >
                    {point.label}
                  </Text>
                );
              })
            : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Grafico de linha (SVG). O `require` fica tardio de proposito: enquanto
 * `SVG_ENABLED` for false, o modulo nativo nem e carregado (o dev build atual
 * nao tem react-native-svg). Vira true depois do build.
 */
function LineChart({
  title,
  points,
  caption,
  labelEvery = 3,
}: {
  title: string;
  points: { label: string; value: number }[];
  caption?: string;
  labelEvery?: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: Svg, Polyline, Circle } = require('react-native-svg') as typeof import('react-native-svg');
  const width = 300;
  const height = 88;
  const max = Math.max(1, ...points.map((point) => point.value));
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const y = (value: number) => Math.round(height - (value / max) * height);
  const line = points.map((point, index) => `${Math.round(index * step)},${y(point.value)}`).join(' ');
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {caption ? <Text style={styles.muted}>{caption}</Text> : null}
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Polyline points={line} fill="none" stroke={colors.accent} strokeWidth={2} />
        {points.map((point, index) => (
          <Circle key={index} cx={index * step} cy={y(point.value)} r={2.5} fill={colors.accent} />
        ))}
      </Svg>
      {labelEvery > 0 ? (
        <View style={styles.lineLabels}>
          {points.map((point, index) => (
            <Text key={index} style={styles.lineLabel}>
              {index % labelEvery === 0 ? point.label : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Uma serie no formato que o build suportar: linha (react-native-svg) quando o
 * modulo nativo existe, senao barras. Enquanto `SVG_ENABLED` for false, tudo sai
 * em barras; virar true e so trocar a constante depois do build.
 */
function SeriesChart({
  title,
  points,
  caption,
  labelEvery,
}: {
  title: string;
  points: { label: string; value: number }[];
  caption?: string;
  labelEvery?: number;
}) {
  if (SVG_ENABLED) {
    return <LineChart title={title} points={points} caption={caption} labelEvery={labelEvery} />;
  }
  return <BarChart title={title} points={points} caption={caption} labelEvery={labelEvery} />;
}

/** Palavras por dia (janela recente): mostra tambem os dias sem escrita. */
function DailyChart({ consistency }: { consistency: ConsistencyMetrics }) {
  const points = consistency.days.map((day) => ({
    label: shortDay(day.key),
    value: day.words,
  }));
  const percent = Math.round(consistency.rate * 100);
  const first = points[0]?.label;
  const last = points[points.length - 1]?.label;
  const range = first && last ? `${first} a ${last} · ` : '';
  const caption = `${range}escrita em ${consistency.writtenDays} de ${consistency.trackedDays} dias (${percent}%)`;
  // Sem rotulo por barra: sao muitos dias e o texto nao cabe embaixo de cada um.
  return <SeriesChart title="Palavras por dia" points={points} caption={caption} labelEvery={0} />;
}

/** dd/mm a partir da chave do dia (YYYY-MM-DD). */
function shortDay(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

function WeeklyChart({ points }: { points: { label: string; value: number }[] }) {
  return <SeriesChart title="Palavras por semana" points={points} />;
}

function Heatmap({ history }: { history: WritingHistory }) {
  const [width, setWidth] = useState(0);
  const gap = 3;
  const columns = history.calendar.length;
  const cellSize =
    width > 0 && columns > 0 ? Math.max(6, Math.floor((width - gap * (columns - 1)) / columns)) : 12;
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>Histórico de escrita</Text>
      <View style={styles.heatmap} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {history.calendar.map((column, columnIndex) => (
          <View key={columnIndex} style={styles.heatColumn}>
            {column.map((cell, dayIndex) => (
              <View
                key={dayIndex}
                style={[
                  styles.heatCellFill,
                  {
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: heatColor(cell, history.maxDaily),
                  },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>menos</Text>
        {HEAT.map((color, level) => (
          <View key={level} style={[styles.heatCell, { backgroundColor: color }]} />
        ))}
        <Text style={styles.legendText}>mais</Text>
      </View>
    </View>
  );
}

function MonthlyChart({ points, comparisonPct }: { points: MonthlyPoint[]; comparisonPct: number | null }) {
  const comparison =
    comparisonPct === null
      ? null
      : comparisonPct > 5
        ? `Você escreveu ${comparisonPct}% mais que no mês passado.`
        : comparisonPct < -5
          ? `Você escreveu ${Math.abs(comparisonPct)}% menos que no mês passado.`
          : 'Seu ritmo está parecido com o do mês passado.';
  return (
    <>
      <SeriesChart
        title="Palavras por mês"
        points={points.map((month) => ({ label: month.label, value: month.words }))}
        labelEvery={points.length > 8 ? 2 : 1}
      />
      {comparison ? <Text style={styles.muted}>{comparison}</Text> : null}
    </>
  );
}

function HourHeatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  const [width, setWidth] = useState(0);
  const gap = 3;
  const columns = HOUR_LABELS.length;
  const cellSize =
    width > 0 && columns > 0 ? Math.max(6, Math.floor((width - gap * (columns - 1)) / columns)) : 12;
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>Quando você escreve (dia × hora)</Text>
      <View style={styles.hourGrid}>
        <View style={styles.hourLabelsColumn}>
          {WEEKDAY_INITIALS.map((initial, index) => (
            <Text
              key={index}
              style={[styles.hourRowLabel, { height: cellSize, lineHeight: cellSize }]}
            >
              {initial}
            </Text>
          ))}
        </View>
        <View style={styles.hourRows} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {grid.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.hourRow}>
              {row.map((value, columnIndex) => (
                <View
                  key={columnIndex}
                  style={[
                    styles.hourCellFill,
                    {
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: levelColor(value, max),
                    },
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>
      <View style={styles.hourTicks}>
        {HOUR_LABELS.map((label) => (
          <Text key={label} style={[styles.hourLabel, { width: cellSize }]}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Humor({ sentiment }: { sentiment: SentimentMetrics }) {
  if (sentiment.analyzed === 0) return null;
  const tone = sentiment.average > 0.15 ? 'positivo' : sentiment.average < -0.15 ? 'negativo' : 'neutro';
  const percent = (value: number) => `${Math.round((value / sentiment.analyzed) * 100)}%`;
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>Humor dos textos</Text>
      <Text style={styles.sentiment}>
        Tom {tone} ({sentiment.average.toFixed(2)})
      </Text>
      <View style={styles.chips}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Positivos · {percent(sentiment.positive)}</Text>
        </View>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Neutros · {percent(sentiment.neutral)}</Text>
        </View>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Negativos · {percent(sentiment.negative)}</Text>
        </View>
      </View>
      {sentiment.topPositive ? (
        <View style={styles.row}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {sentiment.topPositive.title}
          </Text>
          <Text style={styles.rowValue}>+{sentiment.topPositive.score.toFixed(2)}</Text>
        </View>
      ) : null}
      {sentiment.topNegative ? (
        <View style={styles.row}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {sentiment.topNegative.title}
          </Text>
          <Text style={styles.rowValue}>{sentiment.topNegative.score.toFixed(2)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Goals({
  history,
  metrics,
  goal,
  onGoal,
  reminders,
  onReminders,
  hour,
  onHour,
}: {
  history: WritingHistory;
  metrics: WritingMetrics;
  goal: number;
  onGoal: (value: number) => void;
  reminders: boolean;
  onReminders: (value: boolean) => void;
  hour: number;
  onHour: (value: number) => void;
}) {
  const weekWords = history.weekly[history.weekly.length - 1]?.words ?? 0;
  const progress = goal > 0 ? Math.min(1, weekWords / goal) : 0;
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>Meta da semana</Text>
      <View style={styles.goalRow}>
        <Text style={styles.goalValue}>
          {weekWords.toLocaleString('pt-BR')} / {goal.toLocaleString('pt-BR')} palavras
        </Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => onGoal(Math.max(0, goal - 250))}
            accessibilityLabel="Diminuir meta"
            hitSlop={6}
          >
            <Text style={styles.step}>−</Text>
          </Pressable>
          <Pressable onPress={() => onGoal(goal + 250)} accessibilityLabel="Aumentar meta" hitSlop={6}>
            <Text style={styles.step}>+</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      {metrics.currentStreak > 0 && !metrics.wroteToday ? (
        <Text style={styles.warn}>
          Sequência de {metrics.currentStreak} dia{metrics.currentStreak === 1 ? '' : 's'} em risco:
          ainda não escreveu hoje.
        </Text>
      ) : metrics.wroteToday ? (
        <Text style={styles.ok}>Você escreveu hoje. Sequência: {metrics.currentStreak}.</Text>
      ) : null}

      <View style={styles.goalRow}>
        <Text style={styles.goalLabel}>Lembretes de escrita</Text>
        <Switch
          value={reminders}
          onValueChange={onReminders}
          trackColor={{ false: colors.surfaceElevated, true: colors.accent }}
          thumbColor="#FFFFFF"
        />
      </View>
      {reminders ? (
        <View style={styles.goalRow}>
          <Text style={styles.goalLabel}>Horário do lembrete</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => onHour(Math.max(6, hour - 1))}
              accessibilityLabel="Mais cedo"
              hitSlop={6}
            >
              <Text style={styles.step}>−</Text>
            </Pressable>
            <Text style={styles.goalValue}>{hour}h</Text>
            <Pressable
              onPress={() => onHour(Math.min(23, hour + 1))}
              accessibilityLabel="Mais tarde"
              hitSlop={6}
            >
              <Text style={styles.step}>+</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
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

function AnalysisInsights({ items }: { items: AnalysisInsight[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Insights das notas</Text>
      <View style={styles.analysisList}>
        {items.map((item) => (
          <View key={item.entryId} style={styles.analysisCard}>
            <Text style={styles.analysisMeta} numberOfLines={1}>
              {formatDateTime(item.recordedAt)} · {item.title}
            </Text>
            {item.summary ? <Text style={styles.analysisText}>{item.summary}</Text> : null}
            {item.themes.length > 0 ? (
              <Text style={styles.analysisThemes}>{item.themes.join(' · ')}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function WritingSection({
  metrics,
  history,
  analysisInsights,
  goal,
  onGoal,
  reminders,
  onReminders,
  hour,
  onHour,
}: {
  metrics: WritingMetrics;
  history: WritingHistory;
  analysisInsights: AnalysisInsight[];
  goal: number;
  onGoal: (value: number) => void;
  reminders: boolean;
  onReminders: (value: boolean) => void;
  hour: number;
  onHour: (value: number) => void;
}) {
  const number = (value: number) => value.toLocaleString('pt-BR');
  return (
    <>
      <Text style={styles.blockTitle}>Escrita</Text>
      <Insights metrics={metrics} />
      <AnalysisInsights items={analysisInsights} />
      <WeeklyChart
        points={history.weekly.map((week) => ({ label: week.label, value: week.words }))}
      />
      <DailyChart consistency={metrics.consistency} />
      <BarChart
        title="Notas por semana"
        points={history.weekly.map((week) => ({ label: week.label, value: week.notes }))}
      />
      <Heatmap history={history} />
      <MonthlyChart points={metrics.monthly} comparisonPct={metrics.monthComparisonPct} />
      <HourHeatmap grid={metrics.weekdayHour} />
      <Humor sentiment={metrics.sentiment} />
      <Goals
        history={history}
        metrics={metrics}
        goal={goal}
        onGoal={onGoal}
        reminders={reminders}
        onReminders={onReminders}
        hour={hour}
        onHour={onHour}
      />

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
      <View style={styles.metricsRow}>
        <Metric label="Constância" value={`${Math.round(metrics.consistency.rate * 100)}%`} />
        <Metric
          label="Dias escritos"
          value={`${metrics.consistency.writtenDays}/${metrics.consistency.trackedDays}`}
        />
        <Metric
          label={`Melhor em ${CONSISTENCY_WINDOW_DAYS} dias`}
          value={`${metrics.consistency.longestRun} dia${metrics.consistency.longestRun === 1 ? '' : 's'}`}
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
  const { config, weeklyWordGoal, setWeeklyWordGoal, writingReminders, setWritingReminders, reminderHour, setReminderHour } =
    useSettings();
  const { recordings } = useLibrary();
  const [data, setData] = useState<DashboardData | null>(null);
  const [cachedAnalyses, setCachedAnalyses] = useState<CachedAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writing = useMemo(() => analyzeWriting(recordings, new Date()), [recordings]);
  const history = useMemo(() => writingHistory(recordings, new Date()), [recordings]);

  const load = useCallback(async () => {
    // Analises ja feitas no servidor ficam guardadas no aparelho: mostra antes
    // da rede (ou sem ela) e sem refazer a analise.
    const cached = await listCachedAnalyses().catch(() => []);
    setCachedAnalyses(cached);
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

  const analysisInsights = useMemo(() => {
    const live =
      data?.analyses.map(({ entry, analysis }) => ({
        entryId: entry.id,
        title: entry.title || entry.original_filename,
        recordedAt: entry.recorded_at ?? entry.created_at,
        origin: 'server' as const,
        analysis,
      })) ?? [];
    // Local-first: a analise feita no aparelho vence a do servidor e continua
    // no painel mesmo quando a nota ainda nao subiu.
    const merged = new Map<string, CachedAnalysis>();
    for (const item of cachedAnalyses) merged.set(item.entryId, item);
    for (const item of live) {
      if (merged.get(item.entryId)?.origin !== 'local') merged.set(item.entryId, item);
    }
    return toAnalysisInsights([...merged.values()]);
  }, [data, cachedAnalyses]);

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
          <RefreshControl
            refreshing={loading && data !== null}
            onRefresh={load}
            tintColor={colors.textSecondary}
          />
        }
      >
        {writing.notes === 0 ? (
          <Text style={styles.muted}>
            Escreva sua primeira nota e o painel mostra as métricas da sua escrita.
          </Text>
        ) : (
          <WritingSection
            metrics={writing}
            history={history}
            analysisInsights={analysisInsights}
            goal={weeklyWordGoal}
            onGoal={(value) => void setWeeklyWordGoal(value)}
            reminders={writingReminders}
            onReminders={(value) => void setWritingReminders(value)}
            hour={reminderHour}
            onHour={(value) => void setReminderHour(value)}
          />
        )}

        <Text style={styles.blockTitle}>Servidor</Text>
        {!config ? (
          <View style={styles.section}>
            <Text style={styles.muted}>
              Humor, emoções, pessoas e lugares são analisados pelo servidor. Configure para ver.
            </Text>
            <Button label="Configurar servidor" variant="secondary" onPress={() => router.push('/server')} />
          </View>
        ) : loading && !data ? null : (
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
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 88, gap: 4 },
  barSlot: { flex: 1, justifyContent: 'flex-end' },
  bar: { backgroundColor: colors.accent, borderRadius: 3 },
  barLabels: { height: 14, position: 'relative' },
  barLabel: { color: colors.textTertiary, fontSize: 9, textAlign: 'center' },
  lineLabels: { flexDirection: 'row', gap: 4 },
  lineLabel: { flex: 1, color: colors.textTertiary, fontSize: 9, textAlign: 'center' },
  heatmap: { flexDirection: 'row', gap: 3 },
  heatColumn: { gap: 3 },
  heatCell: { width: 12, height: 12, borderRadius: 3 },
  heatCellFill: { borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { color: colors.textTertiary, fontSize: fontSize.xs, marginHorizontal: 2 },
  hourGrid: { flexDirection: 'row', gap: spacing.sm },
  hourLabelsColumn: { gap: 3, paddingTop: 0 },
  hourRowLabel: { color: colors.textTertiary, fontSize: 9, width: 10 },
  hourRows: { flex: 1, gap: 3 },
  hourRow: { flexDirection: 'row', gap: 3 },
  hourCellFill: { borderRadius: 3 },
  hourTicks: { flexDirection: 'row', gap: 3, marginLeft: 18 },
  hourLabel: { textAlign: 'center', color: colors.textTertiary, fontSize: 8 },
  goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  goalLabel: { color: colors.text, fontSize: fontSize.md },
  stepper: { flexDirection: 'row', gap: spacing.lg },
  step: { color: colors.accent, fontSize: fontSize.xl, fontWeight: '700' },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  warn: { color: colors.warning, fontSize: fontSize.sm },
  ok: { color: colors.success, fontSize: fontSize.sm },
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
  analysisList: { gap: spacing.sm },
  analysisCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  analysisMeta: { color: colors.textSecondary, fontSize: fontSize.sm },
  analysisText: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
  analysisThemes: { color: colors.accent, fontSize: fontSize.sm },
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
