/**
 * A folha do icone de IA: transcrever, analisar e processar no servidor.
 *
 * Aparece sozinha uma vez (na primeira nota) e fica disponivel para sempre no
 * icone. "Ocultar" silencia so a abertura automatica — o icone continua
 * abrindo os interruptores, e a escolha fica no banco, fora de qualquer backup.
 */

import { View } from 'react-native';

import { Text } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { ProcessingToggles } from '@/components/ProcessingToggles';
import { Press } from '@/components/Press';
import { FLAG_PROCESSING_HINT } from '@/core/flags';
import { setAppFlag } from '@/services/db';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface ProcessingSheetProps {
  visible: boolean;
  onClose(): void;
}

export function ProcessingSheet({ visible, onClose }: ProcessingSheetProps) {
  const styles = useThemedStyles(baseStyles);

  // Fechar tambem conta como resposta: a abertura automatica acontece uma vez
  // na vida da instalacao e nao insiste na proxima nota.
  const close = () => {
    void setAppFlag(FLAG_PROCESSING_HINT, '1').catch(() => undefined);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} accessibilityLabel="Fechar processamento">
      <View style={styles.body}>
        <Text style={styles.title}>Processamento</Text>
        <ProcessingToggles compact />
        <Press onPress={close} accessibilityRole="button" style={styles.hide}>
          <Text style={styles.hideText}>Ocultar esta mensagem</Text>
        </Press>
      </View>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  body: { padding: spacing.xl, gap: spacing.lg },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  hide: { alignItems: 'center', paddingVertical: spacing.sm },
  hideText: { color: baseColors.textTertiary, fontSize: fontSize.sm },
});
