/** Escolha inline de onde a etapa roda: texto, sem pilula e sem borda. */

import { View } from 'react-native';

import { Press } from '@/components/Press';
import { Text } from '@/components/AppText';
import type { ProcessingPlace } from '@/core/processing';
import { baseColors, fontSize, spacing } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const OPTIONS: { value: Exclude<ProcessingPlace, 'off'>; label: string }[] = [
  { value: 'device', label: 'Aparelho' },
  { value: 'server', label: 'Servidor' },
  { value: 'online', label: 'Online' },
];

interface PlaceChoicesProps {
  value: ProcessingPlace;
  onChange(place: Exclude<ProcessingPlace, 'off'>): void;
  disabled?: boolean;
  label: string;
}

export function PlaceChoices({ value, onChange, disabled = false, label }: PlaceChoicesProps) {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.row}>
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <Press
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={`${label}: ${option.label}`}
            style={styles.option}
          >
            <Text style={[styles.text, active && styles.textActive, disabled && styles.textDisabled]}>
              {option.label}
            </Text>
            {active ? <View style={[styles.underline, disabled && styles.underlineDisabled]} /> : null}
          </Press>
        );
      })}
    </View>
  );
}

const baseStyles = defineStyles({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  option: { paddingVertical: 4 },
  text: { color: baseColors.textTertiary, fontSize: fontSize.sm, fontWeight: '500' },
  textActive: { color: baseColors.text, fontWeight: '600' },
  textDisabled: { color: baseColors.textTertiary },
  underline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 2,
    borderRadius: 2,
    backgroundColor: baseColors.accent,
  },
  underlineDisabled: { backgroundColor: baseColors.textTertiary },
});
