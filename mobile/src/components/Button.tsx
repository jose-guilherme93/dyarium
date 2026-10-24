import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Press } from '@/components/Press';

import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: ButtonProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const isDisabled = disabled || loading;
  return (
    <Press
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[styles.label, variant === 'primary' && styles.labelOnAccent]}>{label}</Text>
      )}
    </Press>
  );
}

const baseStyles = defineStyles({
  base: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  primary: { backgroundColor: baseColors.accent },
  secondary: {
    backgroundColor: baseColors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.borderStrong,
  },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: baseColors.dangerSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: baseColors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  label: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600', letterSpacing: 0.2 },
  labelOnAccent: { color: baseColors.onAccent },
});
