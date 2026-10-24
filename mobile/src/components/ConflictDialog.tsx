/**
 * Dialogo de conflito de nota.
 *
 * O servidor recusou a gravacao porque o campo ja mudou no dashboard (409) e nao
 * gravou nada. A escolha e do usuario: "manter o meu" reenvia por cima; "ficar
 * com o de la" traz o texto de la. Sem este dialogo, o app teria que escolher
 * sozinho — e escolher sozinho e perder trabalho.
 */

import { Ionicons } from '@expo/vector-icons';
import { Modal, Text, View } from 'react-native';
import { Press } from '@/components/Press';

import type { ConflictField, Recording } from '@/core/types';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

/** Rotulo legivel do campo em conflito. */
export const CONFLICT_LABEL: Record<ConflictField, string> = {
  title: 'título',
  recorded_at: 'data',
  body: 'texto',
};

function conflictSentence(fields: ConflictField[]): string {
  const labels = fields.map((field) => CONFLICT_LABEL[field] ?? field);
  if (labels.length === 1) return `O ${labels[0]} desta nota mudou no dashboard.`;
  return `O ${labels.slice(0, -1).join(', ')} e o ${labels[labels.length - 1]} desta nota mudaram no dashboard.`;
}

interface ConflictDialogProps {
  note: Recording | undefined;
  visible: boolean;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onDismiss: () => void;
}

export function ConflictDialog({
  note,
  visible,
  onKeepMine,
  onTakeTheirs,
  onDismiss,
}: ConflictDialogProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  if (!note?.syncConflict?.length) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <Ionicons name="git-compare-outline" size={20} color={colors.warning} />
            <Text style={styles.title}>A nota mudou no dashboard</Text>
          </View>
          <Text style={styles.body}>{conflictSentence(note.syncConflict)}</Text>
          <Text style={styles.body}>
            O que está aqui no celular não foi enviado. O que decide?
          </Text>

          <Press style={styles.action} onPress={onKeepMine} accessibilityRole="button">
            <Text style={styles.actionTitle}>Manter o meu</Text>
            <Text style={styles.actionHint}>Substitui o que está no dashboard</Text>
          </Press>

          <Press style={styles.action} onPress={onTakeTheirs} accessibilityRole="button">
            <Text style={styles.actionTitle}>Ficar com o de lá</Text>
            <Text style={styles.actionHint}>Troca o que está aqui pelo do dashboard</Text>
          </Press>

          <Press style={styles.cancel} onPress={onDismiss} accessibilityRole="button">
            <Text style={styles.cancelText}>Decidir depois</Text>
          </Press>
        </View>
      </View>
    </Modal>
  );
}

const baseStyles = defineStyles({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '600' },
  body: { color: baseColors.textSecondary, fontSize: fontSize.md, lineHeight: 21 },
  action: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: baseColors.surfaceElevated,
    gap: 2,
  },
  actionTitle: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  actionHint: { color: baseColors.textTertiary, fontSize: fontSize.sm },
  cancel: { paddingVertical: spacing.sm, alignItems: 'center' },
  cancelText: { color: baseColors.textSecondary, fontSize: fontSize.md },
});