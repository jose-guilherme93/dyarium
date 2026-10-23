import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Press } from '@/components/Press';

import { FastModal } from '@/components/FastModal';
import type { NoteAnalysisView } from '@/core/analysis';
import { formatDuration, titleFontSize } from '@/core/format';
import {
  clampFontSize,
  type NoteFontFamily,
  type NoteFontWeight,
  type NoteTypography,
} from '@/core/typography';
import { motionDuration } from '@/theme/motion';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

export interface NoteProperty {
  label: string;
  value: string;
}

const SHEET_MOTION = motionDuration(220);

function isVertical(gesture: { dy: number; dx: number }): boolean {
  return Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
}

/**
 * Quando o corpo da folha pode iniciar um arrasto. Recolhida, qualquer deslize
 * vertical expande. Expandida, o corpo rola; so um deslize para baixo no topo
 * recolhe (para o gesto nao roubar a rolagem da lista).
 */
export function canStartSheetDrag(
  gesture: { dy: number; dx: number },
  expanded: boolean,
  atTop: boolean,
): boolean {
  if (!isVertical(gesture)) return false;
  if (!expanded) return true;
  return atTop && gesture.dy > 0;
}

interface SheetResponderOptions {
  canStart(gesture: { dy: number; dx: number }): boolean;
  expanded: boolean;
  travel: number;
  expansion: Animated.Value;
  animateExpansion(next: boolean): void;
  onClose(): void;
}

export type SheetRelease = 'close' | 'collapse' | 'expand';

/** Decide o que um gesto solto faz, sem depender do responder. */
export function sheetReleaseAction(
  expanded: boolean,
  dy: number,
  vy: number,
): SheetRelease {
  if (expanded) {
    // Puxada longa/rapida fecha direto; uma puxada curta volta para a metade.
    if (vy > 1.1 || dy > 140) return 'close';
    if (vy > 0.4 || dy > 40) return 'collapse';
    return 'expand';
  }
  if (vy > 0.8 || dy > 55) return 'close';
  if (vy < -0.6 || dy < -30) return 'expand';
  return 'collapse';
}

/**
 * Gesto da folha. O mesmo conjunto de handlers e ligado ao corpo (so quando
 * recolhida) e ao cabecalho (sempre), para o usuario poder puxar de qualquer
 * ponto e, expandido, continuar rolando a lista.
 */
function createSheetResponder({
  canStart,
  expanded,
  travel,
  expansion,
  animateExpansion,
  onClose,
}: SheetResponderOptions) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => canStart(gesture),
    onMoveShouldSetPanResponderCapture: (_event, gesture) => canStart(gesture),
    onPanResponderGrant: () => {
      expansion.stopAnimation();
    },
    onPanResponderMove: (_event, gesture) => {
      if (travel <= 0) return;
      const base = expanded ? 1 : 0;
      const next = Math.max(0, Math.min(1, base - gesture.dy / travel));
      expansion.setValue(next);
    },
    onPanResponderRelease: (_event, gesture) => {
      const action = sheetReleaseAction(expanded, gesture.dy, gesture.vy);
      if (action === 'close') {
        onClose();
        return;
      }
      animateExpansion(action === 'expand');
    },
    onPanResponderTerminate: () => {
      animateExpansion(expanded);
    },
  });
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
          <Press
            key={option.value}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(option.value)}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Press>
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
 * Configuracoes da nota: uma folha que sobe do rodape e para na metade da tela.
 * Puxar para cima expande para mostrar toda a analise, a tipografia e as
 * propriedades sem apertar tudo num popover pequeno.
 */
export function NoteMenu({
  visible,
  title,
  properties,
  analysis,
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
  const collapsedHeight = Math.max(260, Math.round(height * 0.5));
  const expandedHeight = Math.max(collapsedHeight + 80, Math.round(height * 0.96));
  const travel = expandedHeight - collapsedHeight;

  const [expansion] = useState(() => new Animated.Value(0));
  const [slide] = useState(() => new Animated.Value(1));
  const [expanded, setExpanded] = useState(false);
  const [atTop, setAtTop] = useState(true);

  const animateExpansion = useCallback(
    (next: boolean) => {
      setExpanded(next);
      Animated.timing(expansion, {
        toValue: next ? 1 : 0,
        duration: SHEET_MOTION,
        useNativeDriver: false,
      }).start();
    },
    [expansion],
  );

  // Ao abrir, a folha sobe do rodape ja no tamanho recolhido (metade da tela).
  useEffect(() => {
    if (!visible) return;
    expansion.setValue(0);
    slide.setValue(1);
    const entrance = Animated.timing(slide, {
      toValue: 0,
      duration: SHEET_MOTION,
      useNativeDriver: false,
    });
    entrance.start();
    return () => entrance.stop();
  }, [visible, expansion, slide]);

  // Recolhida, a folha escuta o corpo inteiro: um deslize para cima em qualquer
  // ponto expande. Expandida, o corpo rola e, no topo, puxar para baixo recolhe;
  // o cabecalho continua puxando a folha de volta de qualquer posicao.
  const sheetResponder = useMemo(
    () =>
      createSheetResponder({
        canStart: (gesture) => canStartSheetDrag(gesture, expanded, atTop),
        expanded,
        travel,
        expansion,
        animateExpansion,
        onClose,
      }),
    [animateExpansion, atTop, expanded, expansion, onClose, travel],
  );

  const headerResponder = useMemo(
    () =>
      createSheetResponder({
        canStart: isVertical,
        expanded,
        travel,
        expansion,
        animateExpansion,
        onClose,
      }),
    [animateExpansion, expanded, expansion, onClose, travel],
  );

  const sheetHeight = expansion.interpolate({
    inputRange: [0, 1],
    outputRange: [collapsedHeight, expandedHeight],
  });
  const sheetSlide = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, collapsedHeight],
  });

  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <View style={styles.root}>
        <Press
          style={styles.backdrop}
          onPress={onClose}
          feedback={false}
          accessibilityLabel="Fechar menu"
        />
        <Animated.View
          testID="note-menu-sheet"
          style={[
            styles.sheet,
            { height: sheetHeight, transform: [{ translateY: sheetSlide }] },
          ]}
          {...sheetResponder.panHandlers}
        >
          <View style={styles.header} {...headerResponder.panHandlers}>
            <View
              style={styles.headerContent}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Detalhes da nota"
              accessibilityHint={
                expanded
                  ? 'Puxe para baixo para recolher'
                  : 'Puxe para cima para expandir'
              }
              accessibilityState={{ expanded }}
              accessibilityActions={[
                { name: 'expand', label: 'Expandir detalhes' },
                { name: 'collapse', label: 'Recolher detalhes' },
              ]}
              onAccessibilityAction={(event) => {
                const action = event.nativeEvent.actionName;
                if (action === 'expand') animateExpansion(true);
                if (action === 'collapse') animateExpansion(false);
              }}
            >
              <View style={styles.grabber} />
              <Text
                style={[styles.title, { fontSize: titleFontSize(shown, 20, 14) }]}
                numberOfLines={2}
              >
                {shown}
              </Text>
              <Text style={styles.hint}>
                {expanded ? 'Puxe para baixo para recolher' : 'Puxe para cima para ver tudo'}
              </Text>
            </View>
          </View>

          <ScrollView
            testID="note-menu-scroll"
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled
            scrollEnabled={expanded}
            scrollEventThrottle={16}
            onScroll={(event) => {
              const next = event.nativeEvent.contentOffset.y <= 0;
              setAtTop((current) => (current === next ? current : next));
            }}
            keyboardShouldPersistTaps="handled"
          >
            <Press style={styles.action} onPress={onShare} accessibilityLabel="Compartilhar nota">
              <Ionicons name="share-outline" size={19} color={colors.text} />
              <Text style={styles.actionText}>Compartilhar nota</Text>
            </Press>

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
                      <Press
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
                      </Press>
                      {analysisBusy && onStopAnalysis ? (
                        <Press onPress={onStopAnalysis} accessibilityLabel="Parar análise">
                          <Text style={styles.analyzeStop}>Parar</Text>
                        </Press>
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
              <Press
                style={styles.stepButton}
                onPress={() => onChangeTypography({ ...typography, size: clampFontSize(typography.size - 1) })}
                accessibilityLabel="Diminuir fonte"
              >
                <Text style={styles.stepText}>A-</Text>
              </Press>
              <Text style={styles.stepValue}>{typography.size}</Text>
              <Press
                style={styles.stepButton}
                onPress={() => onChangeTypography({ ...typography, size: clampFontSize(typography.size + 1) })}
                accessibilityLabel="Aumentar fonte"
              >
                <Text style={styles.stepText}>A+</Text>
              </Press>
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
        </Animated.View>
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
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    zIndex: 1,
    elevation: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headerContent: { gap: spacing.xs },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  hint: { color: colors.textTertiary, fontSize: fontSize.xs },
  scroll: { flex: 1 },
  scrollContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  title: { color: colors.text, fontWeight: '700', flex: 1 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
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
