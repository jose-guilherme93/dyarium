import { StyleSheet, Text, View } from 'react-native';

import type { RecordingStatus } from '@/core/types';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

interface StatusMeta {
  label: string;
  color: string;
  soft: string;
}

export const STATUS_META: Record<RecordingStatus, StatusMeta> = {
  draft: { label: 'Rascunho', color: colors.textSecondary, soft: 'rgba(255,255,255,0.06)' },
  recording: { label: 'Gravando', color: colors.record, soft: colors.recordSoft },
  interrupted: { label: 'Interrompida', color: colors.warning, soft: colors.warningSoft },
  recorded: { label: 'Pronta', color: colors.info, soft: colors.infoSoft },
  queued: { label: 'Na fila', color: colors.textSecondary, soft: 'rgba(255,255,255,0.06)' },
  uploading: { label: 'Enviando', color: colors.accent, soft: colors.accentSoft },
  completed: { label: 'Enviada', color: colors.success, soft: colors.successSoft },
  failed: { label: 'Falhou', color: colors.danger, soft: colors.dangerSoft },
  dead: { label: 'Falha permanente', color: colors.danger, soft: colors.dangerSoft },
  remote: { label: 'No servidor', color: colors.info, soft: colors.infoSoft },
};

export function StatusChip({ status, label }: { status: RecordingStatus; label?: string }) {
  const meta = STATUS_META[status];
  return (
    <View style={[styles.chip, { backgroundColor: meta.soft, borderColor: meta.color }]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <Text style={[styles.text, { color: meta.color }]}>{label ?? meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
