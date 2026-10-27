import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export interface NoteProperty {
  label: string;
  value: string;
}

const SHEET_MOTION = motionDuration(220);

export type SheetRelease = 'close' | 'collapse' | 'expand';

/**
 * Decide o que um gesto solto faz. `dy` vem em pontos e `vy` em pontos por
 * segundo, como o gesture-handler entrega (nao em pontos por milissegundo).
 */
export function sheetReleaseAction(
  expanded: boolean,
  dy: number,
  vy: number,
): SheetRelease {
  if (expanded) {
    // Puxada longa/rapida fecha direto; uma puxada curta volta para a metade.
    if (vy > 1100 || dy > 140) return 'close';
    if (vy > 400 || dy > 40) return 'collapse';
    return 'expand';
  }
  if (vy > 800 || dy > 55) return 'close';
  if (vy < -600 || dy < -30) return 'expand';
  return 'collapse';
}

export interface SheetDragMode {
  enabled: boolean;
  /** Ativa o gesto nos dois sentidos; `false` = so para baixo. */
  bothDirections: boolean;
}

/**
 * Como o corpo da folha responde ao arrasto. Recolhida, qualquer deslize
 * vertical expande. Expandida, o corpo rola; so um deslize para baixo no topo
 * recolhe (para o gesto nao roubar a rolagem da lista).
 */
export function sheetDragMode(expanded: boolean, atTop: boolean): SheetDragMode {
  if (!expanded) return { enabled: true, bothDirections: true };
  return { enabled: atTop, bothDirections: false };
}

interface SheetPanOptions {
  expanded: boolean;
  /** Recolhida, o corpo aceita os dois sentidos; expandida, so para baixo. */
  bothDirections: boolean;
  travel: number;
  expansion: Animated.Value;
  /** Deslocamento extra para baixo, depois que a folha ja esta recolhida. */
  dragPull: Animated.Value;
  /** Quanto a folha pode descer puxada pelo dedo (sua altura recolhida). */
  maxPull: number;
  animateExpansion(next: boolean): void;
  closeSheet(): void;
}

/**
 * Arrasto da folha como gesto nativo.
 *
 * O `PanResponder` do JS perdia para os `Pressable` e para o `ScrollView`
 * dentro do menu: o toque era consumido pelo filho e a folha so reagia numa
 * faixa estreita. Um gesto nativo do gesture-handler disputa o toque antes dos
 * filhos e, ao passar do limiar vertical, assume o arrasto.
 */
function createSheetPan({
  expanded,
  bothDirections,
  travel,
  expansion,
  dragPull,
  maxPull,
  animateExpansion,
  closeSheet,
}: SheetPanOptions) {
  // Marca se o gesto chegou a assumir o toque: um toque simples nos filhos
  // (botao, rolagem) nao deve disparar animacao nenhuma no final.
  let activated = false;
  return Gesture.Pan()
    // Os callbacks mexem num Animated.Value do JS.
    .runOnJS(true)
    .activeOffsetY(bothDirections ? [-8, 8] : 8)
    .failOffsetX([-16, 16])
    .onStart(() => {
      activated = true;
      expansion.stopAnimation();
      dragPull.stopAnimation();
    })
    .onUpdate((event) => {
      if (travel <= 0) return;
      const dy = event.translationY;
      const base = expanded ? 1 : 0;
      // Para cima, a altura cresce. Para baixo, ela recolhe ate o tamanho
      // recolhido e o resto vira deslocamento: a folha acompanha o dedo em vez
      // de travar no limite.
      const next = Math.max(0, Math.min(1, base - dy / travel));
      expansion.setValue(next);
      const pull = dy > 0 ? dy - base * travel : 0;
      dragPull.setValue(Math.max(0, Math.min(maxPull, pull)));
    })
    .onEnd((event, success) => {
      // Cancelado (ligacao, troca de app): o `onFinalize` devolve a folha.
      if (!success) return;
      const action = sheetReleaseAction(expanded, event.translationY, event.velocityY);
      if (action === 'close') {
        closeSheet();
        return;
      }
      animateExpansion(action === 'expand');
    })
    .onFinalize((_event, success) => {
      if (activated && !success) animateExpansion(expanded);
      activated = false;
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
  { value: 'system', label: 'Inter' },
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
  const styles = useThemedStyles(baseStyles);

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
  const styles = useThemedStyles(baseStyles);

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
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const shown = title.trim() || 'Nota sem título';
  const { height: windowHeight } = useWindowDimensions();
  // A geometria da folha e congelada na abertura. `useWindowDimensions` pode
  // mudar quando a janela do modal assenta; recalcular `collapsedHeight` no
  // meio da entrada fazia a folha "cortar" a altura enquanto subia.
  const [height] = useState(() => Math.max(1, windowHeight));
  const collapsedHeight = Math.max(260, Math.round(height * 0.5));
  const expandedHeight = Math.max(collapsedHeight + 80, Math.round(height * 0.96));
  const travel = expandedHeight - collapsedHeight;

  const [expansion] = useState(() => new Animated.Value(0));
  const [slide] = useState(() => new Animated.Value(1));
  /** Deslocamento extra para baixo, puxado pelo dedo depois de recolhida. */
  const [dragPull] = useState(() => new Animated.Value(0));
  /** Opacidade do fundo escuro, para o fechamento acompanhar a descida. */
  const [scrim] = useState(() => new Animated.Value(1));
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
      Animated.timing(dragPull, {
        toValue: 0,
        duration: SHEET_MOTION,
        useNativeDriver: true,
      }).start();
    },
    [dragPull, expansion],
  );

  // Fechamento igual ao inverso da entrada: a folha desce inteira e o fundo
  // escurecido some junto, em vez de o modal simplesmente desaparecer.
  const closeSheet = useCallback(() => {
    Animated.timing(dragPull, {
      toValue: expanded ? expandedHeight : collapsedHeight,
      duration: SHEET_MOTION,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(scrim, {
      toValue: 0,
      duration: SHEET_MOTION,
      useNativeDriver: true,
    }).start(onClose);
  }, [collapsedHeight, dragPull, expanded, expandedHeight, onClose, scrim]);

  // Ao abrir, a folha sobe do rodape ja no tamanho recolhido (metade da tela).
  useEffect(() => {
    if (!visible) return;
    expansion.setValue(0);
    dragPull.setValue(0);
    scrim.setValue(1);
    slide.setValue(1);
    const entrance = Animated.timing(slide, {
      toValue: 0,
      duration: SHEET_MOTION,
      easing: Easing.out(Easing.cubic),
      // So o translateY muda: o driver nativo mantem a entrada fluida mesmo
      // enquanto o conteudo do menu monta na thread de JS.
      useNativeDriver: true,
    });
    entrance.start();
    return () => entrance.stop();
  }, [visible, dragPull, expansion, scrim, slide]);

  // O cabecalho sempre arrasta a folha nos dois sentidos. O corpo so assume o
  // gesto quando a lista nao esta rolando (recolhida, ou expandida no topo).
  const headerPan = useMemo(
    () =>
      createSheetPan({
        expanded,
        bothDirections: true,
        travel,
        expansion,
        dragPull,
        maxPull: collapsedHeight,
        animateExpansion,
        closeSheet,
      }),
    [animateExpansion, closeSheet, collapsedHeight, dragPull, expanded, expansion, travel],
  );

  const bodyMode = sheetDragMode(expanded, atTop);
  const bodyPan = useMemo(
    () =>
      createSheetPan({
        expanded,
        bothDirections: bodyMode.bothDirections,
        travel,
        expansion,
        dragPull,
        maxPull: collapsedHeight,
        animateExpansion,
        closeSheet,
      }).enabled(bodyMode.enabled),
    [
      animateExpansion,
      bodyMode.bothDirections,
      bodyMode.enabled,
      closeSheet,
      collapsedHeight,
      dragPull,
      expanded,
      expansion,
      travel,
    ],
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
    <FastModal visible={visible} onRequestClose={closeSheet}>
      {/* O menu vive dentro de um `Modal` do React Native: no Android ele fica
          fora da arvore do root do gesture-handler, entao precisa do proprio. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: scrim }]}>
          <Press
            style={styles.backdrop}
            onPress={closeSheet}
            feedback={false}
            accessibilityLabel="Fechar menu"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheetHost,
            { transform: [{ translateY: sheetSlide }, { translateY: dragPull }] },
          ]}
        >
          <Animated.View
            testID="note-menu-sheet"
            style={[styles.sheet, { height: sheetHeight }]}
          >
            <GestureDetector gesture={headerPan}>
              <View style={styles.header}>
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
            </GestureDetector>

            <GestureDetector gesture={bodyPan}>
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
            </GestureDetector>
          </Animated.View>
        </Animated.View>
      </GestureHandlerRootView>
    </FastModal>
  );
}

const baseStyles = defineStyles({
  root: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: baseColors.overlay,
  },
  // O host posiciona e anima o translateY no driver nativo; a altura animada
  // (expandir/recolher) fica no filho, que roda no driver de JS. Misturar as
  // duas no mesmo Animated.View obrigava a entrada a rodar na thread de JS.
  sheetHost: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  sheet: {
    backgroundColor: baseColors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
    overflow: 'hidden',
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
    borderColor: baseColors.border,
  },
  headerContent: { gap: spacing.xs },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: baseColors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  hint: { color: baseColors.textTertiary, fontSize: fontSize.xs },
  scroll: { flex: 1 },
  scrollContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  title: { color: baseColors.text, fontWeight: '700', flex: 1 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
  actionText: { color: baseColors.text, fontSize: fontSize.md },
  sectionLabel: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.xs,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: baseColors.bgElevated,
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
  segmentItemActive: { backgroundColor: baseColors.surfaceElevated },
  segmentText: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  segmentTextActive: { color: baseColors.text, fontWeight: '600' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.sm,
    padding: 2,
  },
  stepButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
    backgroundColor: baseColors.surfaceElevated,
  },
  stepText: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '700' },
  stepValue: {
    minWidth: 44,
    textAlign: 'center',
    color: baseColors.text,
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
  propLabel: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  propValue: { color: baseColors.text, fontSize: fontSize.sm, flexShrink: 1, textAlign: 'right' },
  muted: { color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
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
  lowPowerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lowPowerText: { flex: 1, gap: 2 },
  lowPowerTitle: { color: baseColors.text, fontSize: fontSize.sm, fontWeight: '600' },
  analyzePrivacy: { color: baseColors.textTertiary, fontSize: fontSize.xs, lineHeight: 17 },
  analysis: { gap: spacing.sm },
  analysisSentiment: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  analysisSentimentLabel: { color: baseColors.accentStrong, fontSize: fontSize.sm, fontWeight: '700' },
  analysisScore: {
    color: baseColors.textTertiary,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  analysisSummary: { color: baseColors.text, fontSize: fontSize.sm, lineHeight: 20 },
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
  analysisTime: {
    color: baseColors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
});
