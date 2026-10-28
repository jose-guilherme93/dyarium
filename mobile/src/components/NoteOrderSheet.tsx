/**
 * Escolha da ordem da lista de notas. Vale a data de criacao no app.
 */

import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { Text } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Press } from '@/components/Press';
import type { NoteOrder } from '@/core/noteOrder';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface NoteOrderSheetProps {
  visible: boolean;
  order: NoteOrder;
  onChange(order: NoteOrder): void;
  onClose(): void;
}

const OPTIONS: { value: NoteOrder; label: string; icon: 'arrow-down-outline' | 'arrow-up-outline' }[] =
  [
    { value: 'newest', label: 'Mais recentes', icon: 'arrow-down-outline' },
    { value: 'oldest', label: 'Mais antigas', icon: 'arrow-up-outline' },
  ];

export function NoteOrderSheet({ visible, order, onChange, onClose }: NoteOrderSheetProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Fechar ordenação">
      <View style={styles.body}>
        {OPTIONS.map((option) => {
          const active = option.value === order;
          return (
            <Press
              key={option.value}
              style={[styles.option, active && styles.optionOn]}
              onPress={() => {
                onChange(option.value);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Ionicons name={option.icon} size={18} color={colors.text} />
              <Text style={styles.label}>{option.label}</Text>
              {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
            </Press>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const baseStyles = defineStyles({
  body: { padding: spacing.xl, gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  optionOn: { backgroundColor: baseColors.surface },
  label: { flex: 1, color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
});
