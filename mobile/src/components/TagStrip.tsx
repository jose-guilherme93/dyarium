import type { ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { designSpace } from '@/theme/design';

interface TagStripProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Faixa horizontal de chips. Sem desvanecer nas bordas: o sistema nao usa
 * gradiente. O corte seco na borda e o proprio sinal de que ha mais conteudo,
 * e a rolagem continua normal.
 */
export function TagStrip({ children, style, contentStyle }: TagStripProps) {
  return (
    <View style={style}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.content, contentStyle]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = {
  content: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: designSpace.s4,
    paddingVertical: designSpace.s2,
  },
};
