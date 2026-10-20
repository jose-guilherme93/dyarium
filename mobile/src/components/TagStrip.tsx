import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

interface TagStripProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Faixa horizontal com fade nas bordas quando ha conteudo fora da tela. O fade
 * e so visual (pointerEvents none), entao o toque continua indo para os chips.
 */
export function TagStrip({ children, style, contentStyle }: TagStripProps) {
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const scrollable = content > viewport + 2;
  const showLeft = scrollable && offset > 4;
  const showRight = scrollable && offset + viewport < content - 4;

  return (
    <View style={[styles.wrap, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(event) => setViewport(event.nativeEvent.layout.width)}
        onContentSizeChange={(width) => setContent(width)}
        onScroll={(event) => setOffset(event.nativeEvent.contentOffset.x)}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, contentStyle]}
      >
        {children}
      </ScrollView>
      {showLeft ? (
        <LinearGradient
          pointerEvents="none"
          colors={[colors.bg, 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.fade, styles.left]}
        />
      ) : null}
      {showRight ? (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0)', colors.bg]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.fade, styles.right]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  content: { gap: spacing.sm, paddingRight: spacing.xl },
  fade: { position: 'absolute', top: 0, bottom: 0, width: 22 },
  left: { left: 0 },
  right: { right: 0 },
});
