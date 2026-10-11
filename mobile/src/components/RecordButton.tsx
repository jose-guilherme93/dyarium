import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

interface RecordButtonProps {
  recording: boolean;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
  size?: number;
}

/**
 * Botao de gravar no estilo Voice Memos: um anel com um circulo vermelho
 * dentro; ao gravar, o circulo vira um quadrado arredondado (parar).
 */
export function RecordButton({
  recording,
  disabled,
  busy,
  onPress,
  size = 76,
}: RecordButtonProps) {
  const innerSize = recording ? size * 0.4 : size * 0.8;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Parar gravacao' : 'Iniciar gravacao'}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pressable,
        { width: size, height: size, borderRadius: size / 2 },
        recording && styles.ringActive,
        (disabled || busy) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.inner,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: recording ? 8 : innerSize / 2,
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderWidth: 3,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringActive: { borderColor: colors.record },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.94 }] },
  inner: { backgroundColor: colors.record },
});
