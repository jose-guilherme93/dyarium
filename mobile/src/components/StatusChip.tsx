import { StyleSheet, Text, View } from 'react-native';

import type { RecordingStatus } from '@/core/types';
import { fontSize, radius, spacing, type ThemeColors } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export interface StatusMeta {
  label: string;
  color: string;
  soft: string;
}

export const STATUS_LABELS: Record<RecordingStatus, string> = {
  draft: 'Rascunho',
  recording: 'Gravando',
  interrupted: 'Interrompida',
  recorded: 'Pronta',
  queued: 'Na fila',
  uploading: 'Enviando',
  completed: 'Enviada',
  failed: 'Falhou',
};

/** Meta do status para a paleta recebida. Puro: quem chama passa o tema. */
export function statusMeta(status: RecordingStatus, colors: ThemeColors): StatusMeta {
  switch (status) {
    case 'recording':
      return { label: STATUS_LABELS[status], color: colors.record, soft: colors.recordSoft };
    case 'interrupted':
      return { label: STATUS_LABELS[status], color: colors.warning, soft: colors.warningSoft };
    case 'recorded':
      return { label: STATUS_LABELS[status], color: colors.info, soft: colors.infoSoft };
    case 'uploading':
      return { label: STATUS_LABELS[status], color: colors.accent, soft: colors.accentSoft };
    case 'completed':
      return { label: STATUS_LABELS[status], color: colors.success, soft: colors.successSoft };
    case 'failed':
      return { label: STATUS_LABELS[status], color: colors.danger, soft: colors.dangerSoft };
    case 'draft':
    case 'queued':
      return {
        label: STATUS_LABELS[status],
        color: colors.textSecondary,
        soft: colors.neutralSoft,
      };
  }
}

export function StatusChip({ status, label }: { status: RecordingStatus; label?: string }) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const meta = statusMeta(status, colors);
  return (
    <View style={[styles.chip, { backgroundColor: meta.soft, borderColor: meta.color }]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <Text style={[styles.text, { color: meta.color }]}>{label ?? meta.label}</Text>
    </View>
  );
}

const baseStyles = defineStyles({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: fontSize.xs, fontWeight: '600' },
});
