import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { FastModal } from '@/components/FastModal';
import type { NoteAnalysisView } from '@/core/analysis';
import { formatDuration, titleFontSize } from '@/core/format';
import {
  clampFontSize,
  type NoteFontFamily,
  type NoteFontWeight,
  type NoteTypography,
} from '@/core/typography';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

export interface NoteProperty {
  label: string;
  value: string;
}

export interface NoteMenuAnchor {
  top: number;
  right: number;
}

interface NoteMenuProps {
  visible: boolean;
  title: string;
  properties: NoteProperty[];
  /**
   * Analise ja produzida pelo servidor. `undefined` esconde a secao (nota sem
   * entrada no servidor); `null` mostra que ainda nao ha analise.
   */
  analysis?: NoteAnalysisView | null;
  /** Posicao do popover (abaixo do botao de configuracoes). */
  anchor?: NoteMenuAnchor | null;
  /** Analise local habilitada nesta build. */
  analysisEnabled?: boolean;
  /** Modelo local instalado e engine disponivel. */
  analysisReady?: boolean;
  analysisBusy?: boolean;
  analysisInput?: { body: number; transcript: number } | null;
  analysisStale?: boolean;
  analysisSimplified?: boolean;
  analysisLowPower?: boolean;
  onChangeAnalysisLowPower?(next: boolean): void;
  /** Nome do modelo escolhido, para o usuario saber o que esta testando. */
  analysisModelLabel?: string;
  analysisLive?: { elapsedMs: number; tokens: number; battery: number | null } | null;
  analysisLast?: {
    elapsedMs: number;
    tokensPerSecond: number;
    batteryDelta: number | null;
    threads: number;
  } | null;
  analysisError?: string | null;
  onAnalyzeLocal?(): void;
  onStopAnalysis?(): void;
  typography: NoteTypography;
  onChangeTypography(next: NoteTypography): void;
  onClose(): void;
  onShare(): void;
}

const FAMILY_OPTIONS: { value: NoteFontFamily; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'serif', label: 'Serifada' },
  { value: 'mono', label: 'Mono' },
];

const WEIGHT_OPTIONS: { value: NoteFontWeight; label: string }[] = [
  { value: 'light', label: 'Leve' },
  { value: 'regular', label: 'Normal' },
  { value: 'bold', label: 'Forte' },
];

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(option.value)}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Conteudo completo da analise do servidor: o que o servidor ja extraiu da
 * nota, sem cortar campos. Fica no topo do menu para nao sumir na rolagem.
 */
function AnalysisContent({ analysis }: { analysis: NoteAnalysisView }) {
  return (
    <View style={styles.analysis}>
      {analysis.sentimentLabel ? (
        <View style={styles.analysisSentiment}>
          <Text style={styles.analysisSentimentLabel}>{analysis.sentimentLabel}</Text>
          {analysis.sentiment !== null ? (
            <Text style={styles.analysisScore}>{analysis.sentiment.toFixed(2)}</Text>
          ) : null}
        </View>
      ) : null}

      {analysis.summary ? <Text style={styles.analysisSummary}>{analysis.summary}</Text> : null}

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

      {analysis.people.length > 0 ? (
        <Text style={styles.analysisMeta}>Pessoas: {analysis.people.join(', ')}</Text>
      ) : null}

      {analysis.places.length > 0 ? (
        <Text style={styles.analysisMeta}>Lugares: {analysis.places.join(', ')}</Text>
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
    </View>
  );
}

/**
 * Configuracoes da nota: um popover que abre logo abaixo do botao (tres
 * pontinhos), sem subir de baixo. Reune compartilhar, tipografia do editor e a
 * ficha de propriedades.
 */
export function NoteMenu({
  visible,
  title,
  properties,
  analysis,
  anchor,
  analysisEnabled = false,
  analysisReady = false,
  analysisBusy = false,
  analysisInput = null,
  analysisStale = false,
  analysisSimplified = false,
  analysisLowPower = false,
  onChangeAnalysisLowPower,
  analysisModelLabel = '',
  analysisLive = null,
  analysisLast = null,
  analysisError = null,
  onAnalyzeLocal,
  onStopAnalysis,
  typography,
  onChangeTypography,
  onClose,
  onShare,
}: NoteMenuProps) {
  const shown = title.trim() || 'Nota sem título';
  const { height } = useWindowDimensions();
  const placement = anchor
    ? { top: anchor.top, right: anchor.right }
    : { top: 80, right: spacing.lg };
  // O card nunca pode passar do rodape da tela; o que nao couber rola dentro.
  const available = anchor ? height - anchor.top - spacing.lg : height - 120;
  const maxHeight = Math.max(240, Math.min(600, available));
  // ScrollView so rola no Android quando tem altura maxima explicita.
  const scrollMaxHeight = Math.max(160, maxHeight - spacing.lg * 2);

  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar menu" />
        <View style={[styles.card, placement, { maxHeight }]}>
          <ScrollView
            style={[styles.scroll, { maxHeight: scrollMaxHeight }]}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.title, { fontSize: titleFontSize(shown, 20, 14) }]} numberOfLines={2}>
              {shown}
            </Text>

            <Pressable style={styles.action} onPress={onShare} accessibilityLabel="Compartilhar nota">
              <Ionicons name="share-outline" size={19} color={colors.text} />
              <Text style={styles.actionText}>Compartilhar nota</Text>
            </Pressable>

            {analysis !== undefined ? (
              <>
                <Text style={styles.sectionLabel}>Análise</Text>
                {analysisError && analysis ? (
                  <Text style={styles.analyzeError}>
                    A análise abaixo é a anterior; a nova tentativa falhou.
                  </Text>
                ) : null}
                {analysisStale && analysis ? (
                  <Text style={styles.analyzeWarning}>
                    Análise de uma versão anterior da nota. Analise de novo para atualizar.
                  </Text>
                ) : null}
                {analysisSimplified && analysis ? (
                  <Text style={styles.analyzeWarning}>
                    Análise simplificada: o modelo não respondeu; o tom foi estimado pelas
                    palavras da nota.
                  </Text>
                ) : null}
                {analysis ? (
                  <AnalysisContent analysis={analysis} />
                ) : (
                  <Text style={styles.muted}>Sem análise para esta nota.</Text>
                )}
                {analysisEnabled ? (
                  <>
                    <View style={styles.analysisActions}>
                      <Pressable
                        style={[styles.analyzeButton, analysisBusy && styles.analyzeButtonDisabled]}
                        onPress={onAnalyzeLocal}
                        disabled={analysisBusy}
                        accessibilityLabel={
                          analysis ? 'Analisar de novo no aparelho' : 'Analisar no aparelho'
                        }
                      >
                        {analysisBusy ? (
                          <ActivityIndicator size="small" color={colors.text} />
                        ) : (
                          <>
                            <Ionicons
                              name="phone-portrait-outline"
                              size={17}
                              color={colors.text}
                            />
                            <Text style={styles.analyzeText}>
                              {analysis ? 'Analisar de novo' : 'Analisar no aparelho'}
                            </Text>
                          </>
                        )}
                      </Pressable>
                      {analysisBusy && onStopAnalysis ? (
                        <Pressable onPress={onStopAnalysis} accessibilityLabel="Parar análise">
                          <Text style={styles.analyzeStop}>Parar</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {!analysisReady && !analysisBusy ? (
                      <Text style={styles.analyzeWarning}>
                        Baixe um modelo em Ajustes &gt; Transcrição e modelos.
                      </Text>
                    ) : null}
                    {analysisError ? <Text style={styles.analyzeError}>{analysisError}</Text> : null}
                    {analysisInput && !analysisBusy ? (
                      <Text style={styles.analyzePrivacy}>
                        Analisado: {analysisInput.body} caracteres de texto e{' '}
                        {analysisInput.transcript} de transcrição.
                      </Text>
                    ) : null}
                    {analysisModelLabel ? (
                      <Text style={styles.analyzePrivacy}>Modelo: {analysisModelLabel}</Text>
                    ) : null}
                    {analysisBusy && analysisLive ? (
                      <Text style={styles.analyzeStats}>
                        {formatDuration(analysisLive.elapsedMs)} ·{' '}
                        {(
                          analysisLive.tokens / Math.max(1, analysisLive.elapsedMs / 1000)
                        ).toFixed(1)}{' '}
                        tok/s · CPU {analysisLowPower ? 2 : 4} threads
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
              </>
            ) : null}

            <Text style={styles.sectionLabel}>Fonte</Text>
            <Segment
              value={typography.family}
              options={FAMILY_OPTIONS}
              onChange={(family) => onChangeTypography({ ...typography, family })}
            />

            <Text style={styles.sectionLabel}>Tamanho</Text>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepButton}
                onPress={() => onChangeTypography({ ...typography, size: clampFontSize(typography.size - 1) })}
                accessibilityLabel="Diminuir fonte"
              >
                <Text style={styles.stepText}>A-</Text>
              </Pressable>
              <Text style={styles.stepValue}>{typography.size}</Text>
              <Pressable
                style={styles.stepButton}
                onPress={() => onChangeTypography({ ...typography, size: clampFontSize(typography.size + 1) })}
                accessibilityLabel="Aumentar fonte"
              >
                <Text style={styles.stepText}>A+</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionLabel}>Peso</Text>
            <Segment
              value={typography.weight}
              options={WEIGHT_OPTIONS}
              onChange={(weight) => onChangeTypography({ ...typography, weight })}
            />

            <Text style={styles.sectionLabel}>Propriedades</Text>
            <View style={styles.props}>
              {properties.map((property) => (
                <View key={property.label} style={styles.propRow}>
                  <Text style={styles.propLabel}>{property.label}</Text>
                  <Text style={styles.propValue} numberOfLines={1}>
                    {property.value}
                  </Text>
                </View>
              ))}
            </View>

          </ScrollView>
        </View>
      </View>
    </FastModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    position: 'absolute',
    width: 300,
    maxHeight: 460,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
    zIndex: 1,
    elevation: 8,
  },
  scroll: { flexShrink: 1 },
  scrollContent: { gap: spacing.md },
  title: { color: colors.text, fontWeight: '700' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.xs,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    padding: 2,
    gap: 2,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
  },
  segmentItemActive: { backgroundColor: colors.surfaceElevated },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm },
  segmentTextActive: { color: colors.text, fontWeight: '600' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    padding: 2,
  },
  stepButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
    backgroundColor: colors.surfaceElevated,
  },
  stepText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  stepValue: {
    minWidth: 44,
    textAlign: 'center',
    color: colors.text,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  props: { gap: spacing.sm },
  propRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  propLabel: { color: colors.textSecondary, fontSize: fontSize.sm },
  propValue: { color: colors.text, fontSize: fontSize.sm, flexShrink: 1, textAlign: 'right' },
  muted: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  analysisActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  analyzeButtonDisabled: { opacity: 0.45 },
  analyzeText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  analyzeStop: { color: colors.accentStrong, fontSize: fontSize.sm, fontWeight: '600' },
  analyzeWarning: { color: colors.warning, fontSize: fontSize.xs, lineHeight: 17 },
  analyzeError: { color: colors.danger, fontSize: fontSize.xs, lineHeight: 17 },
  analyzeStats: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  lowPowerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lowPowerText: { flex: 1, gap: 2 },
  lowPowerTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  analyzePrivacy: { color: colors.textTertiary, fontSize: fontSize.xs, lineHeight: 17 },
  analysis: { gap: spacing.sm },
  analysisSentiment: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  analysisSentimentLabel: { color: colors.accentStrong, fontSize: fontSize.sm, fontWeight: '700' },
  analysisScore: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  analysisSummary: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  analysisMeta: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 18 },
  analysisBlock: { gap: 3 },
  analysisBlockTitle: {
    color: colors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  analysisMoment: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 18 },
  analysisTime: {
    color: colors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
});
