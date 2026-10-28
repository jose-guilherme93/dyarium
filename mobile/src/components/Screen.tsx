import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { baseColors } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function Screen({ children, style, edges = ['top', 'bottom'] }: ScreenProps) {
  const styles = useThemedStyles(baseStyles);
  const { gradients } = useTheme();

  return (
    <View style={styles.root}>
      <LinearGradient colors={gradients.app} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={[styles.safe, style]} edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const baseStyles = defineStyles({
  root: { flex: 1, backgroundColor: baseColors.bg },
  safe: { flex: 1 },
});
