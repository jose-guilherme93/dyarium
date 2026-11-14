/**
 * Resumo do processamento na folha do icone de IA.
 *
 * A decisao mora numa tela so (Opcoes > Processamento). Aqui so o estado atual
 * e o atalho: dois lugares que mudam a mesma escolha acabavam se contradizendo.
 */

import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';
import { placeLabel, type ProcessingPlace } from '@/core/processing';
import { push } from '@/services/appNavigation';
import { useSettings } from '@/state/SettingsContext';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface ProcessingTogglesProps {
  /** Esconde o rodape dentro da folha (titulo ja diz). */
  compact?: boolean;
}

export function ProcessingToggles({ compact = false }: ProcessingTogglesProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const { transcriptionPlace, analysisPlace } = useSettings();

  const row = (label: string, place: ProcessingPlace) => (
    <Press
      style={styles.row}
      onPress={() => push('/processing')}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${placeLabel(place)}. Ajustar processamento`}
    >
      <Text style={styles.title}>{label}</Text>
      <Text style={styles.value}>{placeLabel(place)}</Text>
      <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
    </Press>
  );

  return (
    <View style={styles.list}>
      {row('Transcrição', transcriptionPlace)}
      {row('Análise', analysisPlace)}
      {compact ? null : (
        <View style={styles.foot}>
          <Ionicons name="options-outline" size={13} color={colors.textTertiary} />
          <Text style={styles.footText}>Ajustar em Opções</Text>
        </View>
      )}
    </View>
  );
}

const baseStyles = defineStyles({
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: baseColors.border,
  },
  title: { flex: 1, color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  value: { color: baseColors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: spacing.sm,
  },
  footText: { color: baseColors.textTertiary, fontSize: fontSize.xs },
});
