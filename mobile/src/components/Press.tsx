/**
 * Alvo tocavel do app.
 *
 * O feedback e o ripple nativo do Android: ele nasce no ponto exato em que o
 * dedo toca, e fosco (branco a 10%) e nao custa render. No iOS, onde nao existe
 * ripple, o alvo escurece enquanto esta pressionado. Todos os alvos passam por
 * aqui para o feedback ser o mesmo em qualquer tela.
 */

import { forwardRef } from 'react';
import { Platform, Pressable, type PressableProps, type View } from 'react-native';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

type PressProps = PressableProps & {
  /**
   * Desliga o feedback visual. Use em alvos que apenas capturam o toque (fundo
   * de modal, cartao que impede o fundo de fechar) e nao sao botoes.
   */
  feedback?: boolean;
};

export const Press = forwardRef<View, PressProps>(function Press(
  { style, android_ripple, feedback = true, ...rest },
  ref,
) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  return (
    <Pressable
      ref={ref}
      android_ripple={feedback ? (android_ripple ?? { color: colors.ripple, borderless: false }) : undefined}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        feedback && state.pressed && Platform.OS !== 'android' ? styles.pressed : null,
      ]}
      {...rest}
    />
  );
});

const baseStyles = defineStyles({
  // No iOS nao ha ripple: o alvo fica fosco enquanto o dedo esta nele.
  pressed: { opacity: 0.6 },
});
