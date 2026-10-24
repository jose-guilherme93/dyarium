import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Press } from '@/components/Press';

import { FastModal } from './FastModal';
import { MOTION_SHEET } from '@/theme/motion';
import { baseColors, radius } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

interface BottomSheetProps {
  visible: boolean;
  onClose(): void;
  children: ReactNode;
  /** Estilo do cartao (padding, gap, maxHeight). */
  cardStyle?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * Folha que sobe do rodape.
 *
 * A entrada anima so `translateY` e a opacidade do fundo, no driver nativo:
 * nenhuma medida de conteudo entra na animacao, entao a folha nao "corta" a
 * altura enquanto aparece. O conteudo pode crescer depois (lista que chega do
 * banco, teclado) sem reiniciar a entrada.
 *
 * O `FastModal` por dentro ja reserva o espaco do teclado (`adjustNothing` no
 * Android); a folha so precisa ficar ancorada no rodape.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  cardStyle,
  testID,
  accessibilityLabel = 'Fechar menu',
}: BottomSheetProps) {
  const styles = useThemedStyles(baseStyles);

  const { height } = useWindowDimensions();
  // A distancia da entrada e congelada na primeira montagem: se a dimensao da
  // janela mudar no meio da animacao (modal), a folha nao salta.
  const [from] = useState(() => Math.max(1, height));
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return undefined;
    }
    progress.setValue(0);
    const entrance = Animated.timing(progress, {
      toValue: 1,
      duration: MOTION_SHEET,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    entrance.start();
    return () => entrance.stop();
  }, [visible, progress]);

  if (!visible) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [from, 0],
  });

  return (
    <FastModal visible onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Press
          style={styles.fill}
          onPress={onClose}
          feedback={false}
          accessibilityLabel={accessibilityLabel}
        />
      </Animated.View>
      <Animated.View
        testID={testID}
        style={[styles.card, { transform: [{ translateY }] }, cardStyle]}
      >
        {children}
      </Animated.View>
    </FastModal>
  );
}

const baseStyles = defineStyles({
  fill: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: baseColors.overlay,
  },
  card: {
    marginTop: 'auto',
    maxHeight: '85%',
    backgroundColor: baseColors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: baseColors.borderStrong,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
});
