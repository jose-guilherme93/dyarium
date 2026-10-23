/**
 * Alvo tocavel do app.
 *
 * O feedback e o ripple nativo do Android: ele nasce no ponto exato em que o
 * dedo toca, e fosco (branco a 10%) e nao custa render. No iOS, onde nao existe
 * ripple, o alvo escurece enquanto esta pressionado. Todos os alvos passam por
 * aqui para o feedback ser o mesmo em qualquer tela.
 */

import { forwardRef } from 'react';
import { Platform, Pressable, StyleSheet, type PressableProps, type View } from 'react-native';

const RIPPLE = { color: 'rgba(255,255,255,0.10)', borderless: false } as const;

export const Press = forwardRef<View, PressableProps>(function Press(
  { style, android_ripple, ...rest },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      android_ripple={android_ripple ?? RIPPLE}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        state.pressed && Platform.OS !== 'android' ? styles.pressed : null,
      ]}
      {...rest}
    />
  );
});

const styles = StyleSheet.create({
  // No iOS nao ha ripple: o alvo fica fosco enquanto o dedo esta nele.
  pressed: { opacity: 0.6 },
});
