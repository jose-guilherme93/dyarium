import {
  StyleSheet,
  View,
  type TextInputProps,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';

import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
}

export function Field({ label, hint, style, ...props }: FieldProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        style={[styles.input, style]}
        {...props}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const baseStyles = defineStyles({
  wrap: { gap: spacing.sm },
  label: {
    color: baseColors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: baseColors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
    borderRadius: radius.md,
    color: baseColors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    height: 52,
  },
  hint: { color: baseColors.textTertiary, fontSize: fontSize.xs },
});
