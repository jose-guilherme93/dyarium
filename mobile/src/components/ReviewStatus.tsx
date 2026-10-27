import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';

import { reviewState } from '@/core/transcriptReview';
import type { TranscriptReview, TranscriptSegment } from '@/core/types';
import { baseColors, fontSize, radius, spacing, type ThemeColors } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface ReviewStatusProps {
  segments: TranscriptSegment[];
  review?: TranscriptReview;
  /** Por que nao existe revisao, quando o usuario toca no estado vazio. */
  reason?: string;
  /** Revisa de novo apenas os trechos que ficaram sem revisao. */
  onRetryRejected?(): Promise<void> | void;
}

/**
 * Estado da revisao em icones e numeros. A regra da interface e mostrar, nao
 * escrever: o chip diz quanto mudou, quanto ficou de fora e a compreensao; a
 * explicacao (e a lista antes/depois) mora atras de um toque.
 */
export function ReviewStatus({ segments, review, reason, onRetryRejected }: ReviewStatusProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = useMemo(() => reviewState(review, segments), [review, segments]);

  const comprehension =
    state.kind === 'changed' || state.kind === 'empty' || state.kind === 'partial'
      ? state.comprehension
      : -1;
  const rejected = state.kind === 'partial' ? state.rejected : 0;

  const changedSegments = useMemo(
    () =>
      segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) => segment.revised && segment.revised !== segment.text),
    [segments],
  );

  const retry = async () => {
    if (!onRetryRejected || busy) return;
    setBusy(true);
    try {
      await onRetryRejected();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Press
        style={styles.chip}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={chipLabel(state)}
      >
        {state.kind === 'running' ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Ionicons
            name={state.kind === 'none' ? 'sparkles-outline' : 'sparkles'}
            size={15}
            color={state.kind === 'none' ? colors.textTertiary : colors.accent}
          />
        )}
        {state.kind === 'running' ? (
          <Text style={styles.count}>
            {state.done} de {state.total}
          </Text>
        ) : state.kind === 'changed' || state.kind === 'partial' ? (
          <Text style={styles.count}>{state.changed}</Text>
        ) : state.kind === 'empty' ? (
          // Zero e informacao: "revisou e nao mudou nada", nao ausencia.
          <Text style={[styles.count, styles.countMuted]}>0</Text>
        ) : null}
        {rejected > 0 ? (
          <View style={styles.warnPill}>
            <Text style={styles.warnText}>{rejected}</Text>
          </View>
        ) : null}
        {comprehension >= 0 ? (
          <View style={styles.score}>
            <ScoreRing value={comprehension} colors={colors} />
            <Text style={styles.scoreText}>{comprehension}</Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        {changedSegments.length > 0 ? (
          <Ionicons name="git-compare-outline" size={15} color={colors.textSecondary} />
        ) : null}
        <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
      </Press>

      <BottomSheet visible={open} onClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Ionicons
              name={state.kind === 'none' ? 'sparkles-outline' : 'sparkles'}
              size={20}
              color={state.kind === 'none' ? colors.textTertiary : colors.accent}
            />
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle}>Revisão</Text>
              <Text style={styles.sheetSub}>{review?.model ?? ''}</Text>
            </View>
            {comprehension >= 0 ? (
              <View style={styles.score}>
                <ScoreRing value={comprehension} colors={colors} size={22} />
                <Text style={styles.scoreText}>{comprehension}</Text>
              </View>
            ) : null}
          </View>

          {state.kind === 'running' ? (
            <Text style={styles.note}>
              {state.done} de {state.total} trechos revisados
            </Text>
          ) : null}

          {state.kind === 'none' ? (
            <Text style={styles.note}>{reason ?? 'Esta transcrição ainda não foi revisada.'}</Text>
          ) : null}

          {state.kind === 'empty' ? (
            <Text style={styles.note}>Nada a corrigir neste texto.</Text>
          ) : null}

          {rejected > 0 ? (
            <View style={styles.retryRow}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
              <Text style={styles.retryText}>{rejected} sem revisão</Text>
              <View style={styles.spacer} />
              {onRetryRejected ? (
                <Press
                  style={styles.retryButton}
                  onPress={() => void retry()}
                  accessibilityLabel="Revisar de novo os trechos sem revisão"
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="refresh" size={16} color={colors.accent} />
                  )}
                </Press>
              ) : null}
            </View>
          ) : null}

          {changedSegments.length > 0 ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {changedSegments.map(({ segment, index }) => (
                <View key={`${index}-${segment.start_ms}`} style={styles.changeRow}>
                  <Text style={styles.changeTime}>
                    {Math.floor(segment.start_ms / 60000)}:
                    {String(Math.floor((segment.start_ms % 60000) / 1000)).padStart(2, '0')}
                  </Text>
                  <View style={styles.changeTexts}>
                    <Text style={styles.before}>{segment.text}</Text>
                    <Text style={styles.after}>{segment.revised}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </BottomSheet>
    </>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function chipLabel(state: ReturnType<typeof reviewState>): string {
  switch (state.kind) {
    case 'none':
      return 'Transcrição não revisada. Toque para saber por quê.';
    case 'running':
      return `Revisando ${state.done} de ${state.total} trechos.`;
    case 'changed':
      return `${plural(state.changed, 'trecho alterado', 'trechos alterados')}. Toque para ver o antes e o depois.`;
    case 'empty':
      return 'Revisão concluída sem alterações.';
    case 'partial':
      return `${plural(state.changed, 'trecho alterado', 'trechos alterados')} e ${state.rejected} sem revisão.`;
  }
}

/** Anel de compreensao: cor por faixa, sem texto alem do numero. */
function ScoreRing({
  value,
  colors,
  size = 16,
}: {
  value: number;
  colors: ThemeColors;
  size?: number;
}) {
  const stroke = Math.max(2, size / 8);
  const radiusValue = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radiusValue;
  const ratio = Math.max(0, Math.min(100, value)) / 100;
  const color = value >= 80 ? colors.success : value >= 50 ? colors.warning : colors.danger;
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radiusValue}
        stroke={colors.neutralSoft}
        strokeWidth={stroke}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radiusValue}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * ratio} ${circumference}`}
        fill="none"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

const baseStyles = defineStyles({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: baseColors.border,
    backgroundColor: baseColors.surface,
  },
  count: { fontSize: fontSize.xs, fontWeight: '600', color: baseColors.text },
  countMuted: { color: baseColors.textTertiary, fontWeight: '500' },
  warnPill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: baseColors.warningSoft,
  },
  warnText: { fontSize: fontSize.xs, fontWeight: '700', color: baseColors.warning },
  score: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  scoreText: { fontSize: fontSize.xs, color: baseColors.textSecondary },
  spacer: { flex: 1 },
  sheet: { gap: spacing.sm, paddingBottom: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheetTitleWrap: { flex: 1 },
  sheetTitle: { fontSize: fontSize.md, fontWeight: '600', color: baseColors.text },
  sheetSub: { fontSize: fontSize.xs, color: baseColors.textTertiary },
  note: { fontSize: fontSize.sm, color: baseColors.textSecondary, lineHeight: 20 },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.xs,
  },
  retryText: { fontSize: fontSize.sm, color: baseColors.textSecondary },
  retryButton: { padding: spacing.xs },
  list: { maxHeight: 360 },
  listContent: { gap: spacing.md, paddingVertical: spacing.xs },
  changeRow: { flexDirection: 'row', gap: spacing.sm },
  changeTime: {
    fontSize: fontSize.xs,
    color: baseColors.textTertiary,
    width: 44,
    paddingTop: 2,
  },
  changeTexts: { flex: 1, gap: 2 },
  before: { fontSize: fontSize.sm, color: baseColors.textTertiary, textDecorationLine: 'line-through' },
  after: { fontSize: fontSize.sm, color: baseColors.text },
});
