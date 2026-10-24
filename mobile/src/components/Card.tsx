import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { baseColors, radius, spacing } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export function Card({ children, style, padded = true }: CardProps) {
  const styles = useThemedStyles(baseStyles);

  return <View style={[styles.card, padded && styles.padded, style]}>{children}</View>;
}

const baseStyles = defineStyles({
  card: {
    backgroundColor: baseColors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: baseColors.border,
  },
  padded: { padding: spacing.lg },
});
