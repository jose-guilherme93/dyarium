import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Switch,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { Screen } from '@/components/Screen';
import type { NoteAnalysisView } from '@/core/analysis';
import { stageLabel, type AnalysisStage } from '@/core/analysisStages';
import { formatDuration, titleFontSize } from '@/core/format';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export interface AnalysisViewProps {
  visible: boolean;
  title: string;
  /** Analise ja produzida; `undefined` = ainda lendo o cache. */
  analysis?: NoteAnalysisView | null;
  analysisOrigin?: string;
  analysisEnabled?: boolean;
  analysisServerEnabled?: boolean;
  analysisLoading?: boolean;
  analysisReady?: boolean;
  analysisBusy?: boolean;
  analysisServerBusy?: boolean;
  analysisServerPending?: boolean;
  analysisServerInfo?: string | null;
  analysisProgress?: { read: number; total: number } | null;
  analysisStage?: AnalysisStage | null;
  /** Inicio do pedido ao servidor; o relogio conta a partir daqui. */
  serverStartedAt?: number | null;
  analysisStale?: boolean;
  analysisSimplified?: boolean;
  analysisLowPower?: boolean;
  onChangeAnalysisLowPower?(next: boolean): void;
  analysisModelLabel?: string;
  analysisLive?: { elapsedMs: number; tokens: number; battery: number | null } | null;
  /** Inicio da passada; o relogio da tela conta a partir daqui. */
  analysisStartedAt?: number | null;
  analysisLast?: {
    elapsedMs: number;
    tokensPerSecond: number;
    batteryDelta: number | null;
    threads: number;
  } | null;
  analysisError?: string | null;
  onAnalyzeLocal?(): void;
  onAnalyzeServer?(): void;
  onStopAnalysis?(): void;
  onChangeAnalysisModel?(): void;
  /** Fecha a analise e abre os interruptores de processamento. */
  onOpenProcessing?(): void;
  onClose(): void;
}

/** Conteudo da analise: metricas e listas, secao por secao. */
function AnalysisContent({ analysis }: { analysis: NoteAnalysisView }) {
  const styles = useThemedStyles(baseStyles);

  return (
    <View style={styles.analysis}>
      {analysis.coverage && analysis.coverage.blocksTotal > 0 ? (
        <View
          style={styles.coverage}
          accessibilityLabel={
            analysis.coverage.partial
              ? `Análise parcial: ${analysis.coverage.blocksRead} de ${analysis.coverage.blocksTotal} blocos lidos.`
              : `Análise completa: ${analysis.coverage.blocksTotal} de ${analysis.coverage.blocksTotal} blocos lidos.`
          }
        >
          <View style={styles.coverageTrack}>
            <View
              style={[
                styles.coverageFill,
                analysis.coverage.partial && styles.coverageFillPartial,
                {
                  width: `${Math.max(
                    2,
                    Math.round(
                      (analysis.coverage.blocksRead /
                        Math.max(1, analysis.coverage.blocksTotal)) *
                        100,
                    ),
                  )}%`,
                },
              ]}
            />
          </View>
          <Text style={styles.coverageText}>
            {analysis.coverage.blocksRead}/{analysis.coverage.blocksTotal} blocos
          </Text>
        </View>
      ) : null}

      {analysis.sentimentLabel ? (
        <View style={styles.analysisSentiment}>
          <Text style={styles.analysisSentimentLabel}>{analysis.sentimentLabel}</Text>
          {analysis.sentiment !== null ? (
            <Text style={styles.analysisScore}>{analysis.sentiment.toFixed(2)}</Text>
          ) : null}
        </View>
      ) : null}

      {analysis.reading || analysis.summary ? (
        <Text style={styles.analysisSummary}>{analysis.reading || analysis.summary}</Text>
      ) : null}
      {analysis.sentenceSource === 'derived' ? (
        <Text
          style={styles.analysisMeta}
          accessibilityLabel="A frase foi derivada dos campos pelo aplicativo, sem geracao de texto pelo modelo."
        >
          frase derivada
        </Text>
      ) : null}

      {analysis.comprehension !== null ? (
        <Text
          style={styles.analysisMeta}
          accessibilityLabel={
            analysis.comprehensionSource === 'review'
              ? `Compreensão lógica estimada do texto revisado: ${analysis.comprehension} de 100.`
              : `Compreensão lógica estimada pelo modelo sobre o texto lido: ${analysis.comprehension} de 100. A transcrição não foi revisada.`
          }
        >
          Compreensão {analysis.comprehension}/100
          {analysis.comprehensionSource === 'analysis' ? ' · sem revisão' : ''}
        </Text>
      ) : null}
      {analysis.stutterRate > 0 || analysis.hesitationRate > 0 ? (
        <Text
          style={styles.analysisMeta}
          accessibilityLabel={`Gagueira e hesitação por 100 palavras do texto cru do áudio: ${analysis.stutterRate.toFixed(1)} e ${analysis.hesitationRate.toFixed(1)}.`}
        >
          Gagueira {analysis.stutterRate.toFixed(1)} · Hesitação{' '}
          {analysis.hesitationRate.toFixed(1)}
        </Text>
      ) : null}

      {analysis.emotions.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Emoções</Text>
          <View style={styles.chips}>
            {analysis.emotions.map((emotion) => (
              <Text key={emotion.name} style={styles.chip}>
                {emotion.name} {emotion.intensity.toFixed(2)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {analysis.themes.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Temas</Text>
          <View style={styles.chips}>
            {analysis.themes.map((theme, index) => (
              <Text key={`${theme}-${index}`} style={styles.chip}>
                {theme}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {analysis.peopleDetail.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Pessoas</Text>
          <View style={styles.chips}>
            {analysis.peopleDetail.map((person) => (
              <Text
                key={person.name}
                style={styles.chip}
                accessibilityLabel={`${person.name}, ${person.count} ${
                  person.count === 1 ? 'menção' : 'menções'
                }.`}
              >
                {person.name} {person.count}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {analysis.placesDetail.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Lugares</Text>
          <View style={styles.chips}>
            {analysis.placesDetail.map((place) => (
              <Text
                key={place.name}
                style={styles.chip}
                accessibilityLabel={`${place.name}, ${place.count} ${
                  place.count === 1 ? 'menção' : 'menções'
                }.`}
              >
                {place.name} {place.count}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {analysis.moments.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Momentos</Text>
          {analysis.moments.map((moment, index) => (
            <Text key={`${moment.startMs}-${index}`} style={styles.analysisMoment}>
              <Text style={styles.analysisTime}>{formatDuration(moment.startMs)}</Text>{' '}
              {moment.text}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.events.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Eventos</Text>
          <View style={styles.chips}>
            {analysis.events.map((event, index) => (
              <Text key={`${event}-${index}`} style={styles.chip}>
                {event}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {analysis.questions.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Perguntas</Text>
          {analysis.questions.map((question, index) => (
            <Text key={`${question}-${index}`} style={styles.analysisMoment}>
              - {question}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.decisions.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Decisões</Text>
          {analysis.decisions.map((decision, index) => (
            <Text key={`${decision}-${index}`} style={styles.analysisMoment}>
              - {decision}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.tasks.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Tarefas</Text>
          {analysis.tasks.map((task, index) => (
            <Text key={`${task}-${index}`} style={styles.analysisMoment}>
              - {task}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.ideas.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Ideias</Text>
          {analysis.ideas.map((idea, index) => (
            <Text key={`${idea}-${index}`} style={styles.analysisMoment}>
              - {idea}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.epiphanies.length > 0 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Epifanias</Text>
          {analysis.epiphanies.map((epiphany, index) => (
            <Text key={`${epiphany}-${index}`} style={styles.analysisMoment}>
              - {epiphany}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.sections.length > 1 ? (
        <View style={styles.analysisBlock}>
          <Text style={styles.analysisBlockTitle}>Seções</Text>
          {analysis.sections.map((section, index) => (
            <View key={`${section.heading}-${index}`} style={styles.analysisSection}>
              <Text style={styles.analysisSectionTitle}>
                {section.heading || 'Nota'}
                {section.sentimentLabel ? ` · ${section.sentimentLabel}` : ''}
              </Text>
              {section.reading || section.summary ? (
                <Text style={styles.analysisMeta}>{section.reading || section.summary}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AnalysisSkeleton() {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Carregando análise">
      <View style={[styles.skeletonLine, { width: '34%' }]} />
      <View style={[styles.skeletonLine, { width: '94%' }]} />
      <View style={[styles.skeletonLine, { width: '72%' }]} />
      <View style={[styles.skeletonLine, { width: '48%' }]} />
    </View>
  );
}

/**
 * Tela da analise: tudo o que e IA da nota vive aqui, longe das configuracoes.
 * E uma tela inteira, com cabecalho e rolagem propria.
 */
export function AnalysisView({
  visible,
  title,
  analysis,
  analysisOrigin,
  analysisEnabled = false,
  analysisServerEnabled = false,
  analysisLoading = false,
  analysisReady = false,
  analysisBusy = false,
  analysisServerBusy = false,
  analysisServerPending = false,
  analysisServerInfo = null,
  analysisProgress = null,
  analysisStage = null,
  serverStartedAt = null,
  analysisStale = false,
  analysisSimplified = false,
  analysisLowPower = false,
  onChangeAnalysisLowPower,
  analysisModelLabel = '',
  analysisLive = null,
  analysisStartedAt = null,
  analysisLast = null,
  analysisError = null,
  onAnalyzeLocal,
  onAnalyzeServer,
  onStopAnalysis,
  onChangeAnalysisModel,
  onOpenProcessing,
  onClose,
}: AnalysisViewProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const shown = title.trim() || 'Nota sem título';

  // O relogio vive aqui, nao na tela da nota: com a analise em segundo plano o
  // editor nao pode re-renderizar a cada segundo enquanto o usuario digita.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible || (!analysisBusy && !analysisServerPending)) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, analysisBusy, analysisServerPending]);
  const elapsedMs =
    analysisStartedAt !== null && analysisBusy
      ? Math.max(0, now - analysisStartedAt)
      : (analysisLive?.elapsedMs ?? 0);
  const serverElapsedMs = serverStartedAt !== null ? Math.max(0, now - serverStartedAt) : 0;
  // Tom e frase podem existir sem nenhum item: o modelo respondeu, mas nao
  // reconheceu pessoas, emocoes, temas nem frases. Melhor dizer isso do que
  // deixar a tela parecer quebrada.
  const emptyAnalysis =
    analysis !== null &&
    analysis !== undefined &&
    analysis.emotions.length === 0 &&
    analysis.themes.length === 0 &&
    analysis.peopleDetail.length === 0 &&
    analysis.placesDetail.length === 0 &&
    analysis.moments.length === 0 &&
    analysis.events.length === 0 &&
    analysis.questions.length === 0 &&
    analysis.decisions.length === 0 &&
    analysis.tasks.length === 0 &&
    analysis.ideas.length === 0 &&
    analysis.epiphanies.length === 0 &&
    !analysis.coverage?.partial;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Screen>
        <View style={styles.header}>
          <Press
            style={styles.iconButton}
            onPress={onClose}
            accessibilityLabel="Fechar análise"
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Press>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Análise</Text>
            <Text
              style={styles.headerSubtitle}
              numberOfLines={1}
              accessibilityLabel={`Nota ${shown}`}
            >
              {shown}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.analysisHead}>
            {analysisOrigin ? (
              <Text style={styles.analysisOrigin}>{analysisOrigin}</Text>
            ) : null}
            {analysisLoading ? (
              <ActivityIndicator size="small" color={colors.textTertiary} />
            ) : null}
            {analysis?.coverage ? (
              <Text style={styles.analysisMeta}>
                {analysis.coverage.blocksRead}/{analysis.coverage.blocksTotal} blocos
              </Text>
            ) : null}
          </View>

          {analysisStale && analysis ? (
            <Text style={styles.analyzeWarning}>
              Análise de uma versão anterior. Toque em Analisar nota para atualizar.
            </Text>
          ) : null}
          {analysis?.coverage?.partial && !analysisBusy && !analysisServerBusy ? (
            <Text style={styles.analyzeWarning}>
              Análise parcial: {analysis.coverage.blocksRead} de {analysis.coverage.blocksTotal}{' '}
              blocos. Toque em Analisar nota para terminar.
            </Text>
          ) : null}
          {analysisSimplified && analysis ? (
            <Text style={styles.analyzeWarning}>
              Leitura simplificada: o modelo não respondeu; o tom foi estimado pelas palavras.
            </Text>
          ) : null}
          {emptyAnalysis && !analysisBusy ? (
            <Text style={styles.analyzeWarning}>
              Nada reconhecido. Tente a versão de qualidade ou um modelo maior.
            </Text>
          ) : null}

          {analysisLoading && !analysis ? (
            <AnalysisSkeleton />
          ) : analysis ? (
            <AnalysisContent analysis={analysis} />
          ) : (
            <Text style={styles.muted}>Sem análise para esta nota.</Text>
          )}

          {analysisEnabled ? (
            <>
              <View style={styles.analysisActions}>
                <Press
                  style={[styles.analyzeButton, analysisBusy && styles.analyzeButtonDisabled]}
                  onPress={onAnalyzeLocal}
                  disabled={analysisBusy}
                  accessibilityLabel="Analisar nota no aparelho"
                >
                  {analysisBusy ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <>
                      <Ionicons name="phone-portrait-outline" size={17} color={colors.text} />
                      <Text style={styles.analyzeText}>Analisar nota</Text>
                    </>
                  )}
                </Press>
                {analysisBusy && onStopAnalysis ? (
                  <Press onPress={onStopAnalysis} accessibilityLabel="Parar análise">
                    <Text style={styles.analyzeStop}>Parar</Text>
                  </Press>
                ) : null}
              </View>
              {!analysisReady && !analysisBusy ? (
                <Text style={styles.analyzeWarning}>
                  Nenhum modelo pronto. Escolha um modelo para analisar no aparelho.
                </Text>
              ) : null}
              {analysisModelLabel && onChangeAnalysisModel ? (
                <Press
                  style={styles.modelRow}
                  onPress={onChangeAnalysisModel}
                  accessibilityLabel="Trocar o modelo de análise"
                >
                  <Text style={styles.analyzePrivacy}>Modelo: {analysisModelLabel}</Text>
                  <Text style={styles.modelChange}>Trocar modelo</Text>
                </Press>
              ) : null}
              {analysisBusy ? (
                <View style={styles.stageRow}>
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                  <Text style={styles.stageText} numberOfLines={2}>
                    {stageLabel({
                      stage: analysisStage,
                      read: analysisProgress?.read ?? 0,
                      total: analysisProgress?.total ?? 0,
                    })}
                  </Text>
                </View>
              ) : null}
              {analysisBusy && analysisLive ? (
                <Text style={styles.analyzeStats}>
                  {formatDuration(elapsedMs)} ·{' '}
                  {(
                    analysisLive.tokens / Math.max(1, elapsedMs / 1000)
                  ).toFixed(1)}{' '}
                  tok/s · CPU {analysisLowPower ? 1 : 2} threads
                  {analysisLive.battery !== null
                    ? ` · bateria ${Math.round(analysisLive.battery * 100)}%`
                    : ''}
                </Text>
              ) : null}
              {!analysisBusy && analysisLast ? (
                <Text style={styles.analyzeStats}>
                  Última análise: {formatDuration(analysisLast.elapsedMs)} ·{' '}
                  {analysisLast.tokensPerSecond.toFixed(1)} tok/s · CPU{' '}
                  {analysisLast.threads} threads
                  {analysisLast.batteryDelta !== null
                    ? ` · bateria ${analysisLast.batteryDelta > 0 ? '+' : ''}${analysisLast.batteryDelta.toFixed(0)}%`
                    : ''}
                </Text>
              ) : null}
              <View style={styles.lowPowerRow}>
                <View style={styles.lowPowerText}>
                  <Text style={styles.lowPowerTitle}>Menos CPU</Text>
                  <Text style={styles.analyzePrivacy}>
                    1 thread em vez de 2. A análise demora mais e gasta menos bateria.
                  </Text>
                </View>
                <Switch
                  value={analysisLowPower}
                  onValueChange={onChangeAnalysisLowPower}
                  trackColor={{ false: colors.surfaceElevated, true: colors.accent }}
                  thumbColor={colors.text}
                />
              </View>
              <Text style={styles.analyzePrivacy}>
                Roda no aparelho. Lê o texto e a transcrição; fotos não são interpretadas.
              </Text>
            </>
          ) : null}

          {analysisServerEnabled ? (
            <>
              <View style={styles.analysisActions}>
                <Press
                  style={[
                    styles.analyzeButton,
                    (analysisServerBusy || analysisServerPending) && styles.analyzeButtonDisabled,
                  ]}
                  onPress={onAnalyzeServer}
                  disabled={analysisServerBusy || analysisServerPending}
                  accessibilityLabel="Analisar esta nota no servidor"
                >
                  {analysisServerBusy || analysisServerPending ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={17} color={colors.text} />
                      <Text style={styles.analyzeText}>Analisar no servidor</Text>
                    </>
                  )}
                </Press>
              </View>
              {analysisServerPending ? (
                <View style={styles.stageRow}>
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                  <Text style={styles.stageText} numberOfLines={2}>
                    {stageLabel({ stage: null, serverElapsedMs })}
                  </Text>
                  <Text style={styles.stageTime}>{formatDuration(serverElapsedMs)}</Text>
                </View>
              ) : null}
              {analysisServerInfo ? (
                <Text style={styles.analyzePrivacy}>{analysisServerInfo}</Text>
              ) : null}
              <Text style={styles.analyzePrivacy}>
                A nota já está no servidor; a análise roda lá e chega sozinha.
              </Text>
            </>
          ) : null}

          {analysisError ? <Text style={styles.analyzeError}>{analysisError}</Text> : null}

          <Press
            style={styles.processingRow}
            onPress={onOpenProcessing}
            accessibilityLabel="Abrir processamento da nota"
          >
            <View style={styles.lowPowerText}>
              <Text style={styles.lowPowerTitle}>Processamento</Text>
              <Text style={styles.analyzePrivacy}>
                Onde transcrever e analisar; servidor e modelos.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Press>
        </ScrollView>
      </Screen>
    </Modal>
  );
}

const baseStyles = defineStyles({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  headerTitle: { color: baseColors.text, fontWeight: '700', fontSize: titleFontSize('Análise', 22, 15) },
  headerSubtitle: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  scroll: { flex: 1 },
  content: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  analysisHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  analysisOrigin: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  muted: { color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  analysisActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: baseColors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
  },
  analyzeButtonDisabled: { opacity: 0.45 },
  analyzeText: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  analyzeStop: { color: baseColors.accentStrong, fontSize: fontSize.sm, fontWeight: '600' },
  analyzeWarning: { color: baseColors.warning, fontSize: fontSize.xs, lineHeight: 17 },
  analyzeError: { color: baseColors.danger, fontSize: fontSize.xs, lineHeight: 17 },
  analyzeStats: {
    color: baseColors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  lowPowerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
  lowPowerText: { flex: 1, gap: 2 },
  lowPowerTitle: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  analyzePrivacy: { color: baseColors.textTertiary, fontSize: fontSize.xs, lineHeight: 17 },
  analysis: { gap: spacing.sm, paddingTop: spacing.xs },
  skeleton: { gap: spacing.sm, paddingVertical: spacing.xs },
  skeletonLine: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: baseColors.surfaceElevated,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modelChange: { color: baseColors.accentStrong, fontSize: fontSize.xs, fontWeight: '600' },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stageText: {
    flexShrink: 1,
    color: baseColors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 17,
  },
  stageTime: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
  coverage: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  coverageTrack: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: baseColors.surfaceElevated,
    overflow: 'hidden',
  },
  coverageFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: baseColors.accentStrong,
  },
  coverageFillPartial: { backgroundColor: baseColors.warning },
  coverageText: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  analysisSentiment: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  analysisSentimentLabel: {
    color: baseColors.accentStrong,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  analysisScore: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  analysisSection: { gap: 2, marginBottom: spacing.xs },
  analysisSectionTitle: { fontSize: fontSize.sm, fontWeight: '600', color: baseColors.text },
  analysisSummary: { color: baseColors.text, fontSize: fontSize.md, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    color: baseColors.textSecondary,
    fontSize: fontSize.xs,
    backgroundColor: baseColors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  analysisMeta: { color: baseColors.textSecondary, fontSize: fontSize.xs, lineHeight: 18 },
  analysisBlock: { gap: 3 },
  analysisBlockTitle: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  analysisMoment: { color: baseColors.textSecondary, fontSize: fontSize.xs, lineHeight: 18 },
  analysisTime: { color: baseColors.textTertiary, fontVariant: ['tabular-nums'] },
});
