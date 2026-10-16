import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, StyleSheet, type ModalProps } from 'react-native';

import { MOTION_FAST } from '@/theme/motion';

type FastModalProps = Pick<ModalProps, 'visible' | 'transparent' | 'onRequestClose'> & {
  children: ReactNode;
};

/**
 * Modal com fade rapido no lugar da animacao nativa (`animationType="fade"`,
 * ~150 ms e fixa). Aqui a duracao vem do token de movimento e pode ser ajustada
 * num lugar so.
 */
export function FastModal({
  visible,
  transparent = true,
  onRequestClose,
  children,
}: FastModalProps) {
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
      <Animated.View style={[styles.fill, { opacity }]}>{children}</Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
