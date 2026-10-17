import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
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
  analysisLoading?: boolean;
  /** Posicao do popover (abaixo do botao de configuracoes). */
  anchor?: NoteMenuAnchor | null;
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
  analysisLoading = false,
  anchor,
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
  const maxHeight = Math.min(600, Math.max(320, height - 120));

  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar menu">
        <Pressable style={[styles.card, placement, { maxHeight }]} onPress={() => undefined}>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <Text style={[styles.title, { fontSize: titleFontSize(shown, 20, 14) }]} numberOfLines={2}>
              {shown}
            </Text>

            <Pressable style={styles.action} onPress={onShare} accessibilityLabel="Compartilhar nota">
              <Ionicons name="share-outline" size={19} color={colors.text} />
              <Text style={styles.actionText}>Compartilhar nota</Text>
            </Pressable>

            {analysis !== undefined || analysisLoading ? (
              <>
                <Text style={styles.sectionLabel}>Análise</Text>
                {analysisLoading && !analysis ? (
                  <View style={styles.analysisLoading}>
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                    <Text style={styles.muted}>Buscando análise...</Text>
                  </View>
                ) : analysis ? (
                  <AnalysisContent analysis={analysis} />
                ) : (
                  <Text style={styles.muted}>Sem análise do servidor para esta nota.</Text>
                )}
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
        </Pressable>
      </Pressable>
    </FastModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
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
  },
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
  analysisLoading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
