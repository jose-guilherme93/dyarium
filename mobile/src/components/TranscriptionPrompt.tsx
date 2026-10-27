/**
 * Aviso de que a transcricao e a analise estao desligadas.
 *
 * Aparece quando a pessoa tenta transcrever um audio sem modelo local. O botao
 * leva direto a tela que liga a transcricao e baixa os modelos; o X dispensa o
 * aviso de vez, para quem so quer gravar audio e escrever sem ser lembrado.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  View,
} from 'react-native';
import { Text } from '@/components/AppText';

import { FastModal } from '@/components/FastModal';
import { Press } from '@/components/Press';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface TranscriptionPromptProps {
  visible: boolean;
  /** Fecha sem dispensar (fundo ou botao voltar). */
  onClose(): void;
  /** Fecha e nao mostra de novo neste aparelho. */
  onDismiss(): void;
  /** Fecha e abre a tela de modelos/transcricao. */
  onOpenSettings(): void;
}

export function TranscriptionPrompt({
  visible,
  onClose,
  onDismiss,
  onOpenSettings,
}: TranscriptionPromptProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <FastModal visible={visible} onRequestClose={onClose}>
      <Press
        style={styles.backdrop}
        onPress={onClose}
        feedback={false}
        accessibilityLabel="Fechar aviso"
      >
        <Press style={styles.card} onPress={() => undefined} feedback={false}>
          <View style={styles.head}>
            <View style={styles.icon}>
              <Ionicons name="mic-off-outline" size={19} color={colors.warning} />
            </View>
            <Text style={styles.title}>Transcrição e análise desligadas</Text>
            <Press
              onPress={onDismiss}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Fechar aviso e não mostrar de novo"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Press>
          </View>
          <Text style={styles.body}>
            Ative a transcrição local e a análise em Opções &gt; Modelos no aparelho. Sem
            isso, o áudio fica só gravado e a nota fica sem transcrição nem análise.
          </Text>
          <Press
            style={styles.action}
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Abrir ajustes de transcrição e análise"
          >
            <Ionicons name="settings-outline" size={18} color={colors.onAccent} />
            <Text style={styles.actionText}>Abrir ajustes</Text>
          </Press>
        </Press>
      </Press>
    </FastModal>
  );
}

const baseStyles = defineStyles({
  backdrop: {
    flex: 1,
    backgroundColor: baseColors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: baseColors.bgElevated,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: baseColors.surface,
  },
  title: {
    flex: 1,
    color: baseColors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  body: { color: baseColors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: baseColors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
  },
  actionText: { color: baseColors.onAccent, fontSize: fontSize.md, fontWeight: '700' },
});
