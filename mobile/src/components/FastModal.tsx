import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  type ModalProps,
} from 'react-native';

import { MOTION_FAST } from '@/theme/motion';
import { useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

type FastModalProps = Pick<ModalProps, 'visible' | 'transparent' | 'onRequestClose'> & {
  children: ReactNode;
  /** Sobe o conteudo acima do teclado (padrao: sim). */
  avoidKeyboard?: boolean;
};

/**
 * Modal com fade rapido no lugar da animacao nativa (`animationType="fade"`,
 * ~150 ms e fixa). Aqui a duracao vem do token de movimento e pode ser ajustada
 * num lugar so.
 *
 * A janela do app usa `adjustNothing` (plugin `withKeyboardLayout`): ela nao
 * encolhe quando o teclado abre. Por isso todo modal com campo de texto precisa
 * reservar o espaco do teclado aqui; sem isso o campo e o botao de concluir
 * ficam atras do teclado. O `KeyboardAvoidingView` calcula a sobreposicao pelo
 * quadro real do modal e anima o padding com a duracao do teclado.
 */
export function FastModal({
  visible,
  transparent = true,
  onRequestClose,
  avoidKeyboard = true,
  children,
}: FastModalProps) {
  const styles = useThemedStyles(baseStyles);

  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: MOTION_FAST,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, opacity]);

  return (
    <Modal
      visible={visible}
      transparent={transparent}
      animationType="none"
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior="padding"
        enabled={avoidKeyboard}
      >
        <Animated.View style={[styles.fill, { opacity }]}>{children}</Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const baseStyles = defineStyles({
  fill: { flex: 1 },
});
