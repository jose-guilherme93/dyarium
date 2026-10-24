/**
 * Alvo tocavel do app.
 *
 * O feedback e o ripple do Android: ele nasce no ponto exato em que o dedo
 * toca e some ao soltar. O Android desenha a mascara do ripple nativo como um
 * retangulo, entao em qualquer alvo com cantos arredondados o brilho vazava
 * pelos cantos. Por isso o ripple e desenhado aqui dentro, num circulo
 * recortado pela forma do alvo: o raio vem do proprio estilo ou, quando o alvo
 * nao declara um, da geometria medida (botoes de icone ficam circulares e o
 * resto ganha um arredondamento suave). Assim qualquer alvo novo ja nasce com
 * o glow certo, sem lista de excecoes. No iOS, onde nao existe ripple, o alvo
 * escurece enquanto esta pressionado.
 */

import { forwardRef, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableAndroidRippleConfig,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type View as ViewType,
  type ViewStyle,
} from 'react-native';

import { radius } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

const RIPPLE_GROW = 300;
const RIPPLE_FADE = 180;
/** Arredondamento suave para alvos que nao declaram um raio. */
const SOFT_RADIUS = radius.md;
/** Acima disso, um alvo quadrado nao e um botao de icone. */
const ICON_TARGET_MAX = 64;

type PressProps = PressableProps & {
  /**
   * Desliga o feedback visual. Use em alvos que apenas capturam o toque (fundo
   * de modal, cartao que impede o fundo de fechar) e nao sao botoes.
   */
  feedback?: boolean;
};

interface RippleState {
  x: number;
  y: number;
  radius: number;
  /** Forma do recorte, igual aos cantos do alvo. */
  shape: ViewStyle;
}

/** Estado "em repouso" para resolver o estilo sem o dedo no alvo. */
const IDLE_PRESS_STATE = {
  pressed: false,
  hovered: false,
  focused: false,
} as PressableStateCallbackType;

/** Estilo resolvido do alvo, sem o estado de pressionado. */
function flattenStyle(style: StyleProp<ViewStyle>): ViewStyle | undefined {
  if (!style) return undefined;
  return StyleSheet.flatten(style) as ViewStyle | undefined;
}

/**
 * Cantos arredondados declarados pelo alvo, ou `null` se ele nao define um
 * raio. E o mesmo raio do botao que recorta o ripple.
 */
export function rippleCorners(style: StyleProp<ViewStyle>): ViewStyle | null {
  const flat = flattenStyle(style);
  if (!flat) return null;
  if (flat.borderRadius != null) return { borderRadius: flat.borderRadius };
  const corners: ViewStyle = {
    borderTopLeftRadius: flat.borderTopLeftRadius,
    borderTopRightRadius: flat.borderTopRightRadius,
    borderBottomLeftRadius: flat.borderBottomLeftRadius,
    borderBottomRightRadius: flat.borderBottomRightRadius,
  };
  return Object.values(corners).some((value) => value != null) ? corners : null;
}

/**
 * Forma do recorte quando o alvo nao declara um raio: quadrados pequenos
 * (botoes de icone) ficam circulares e o resto ganha um canto suave. O tamanho
 * vem da medicao, entao qualquer alvo novo se encaixa sem configuracao.
 */
export function fallbackCorners(width: number, height: number): ViewStyle {
  const min = Math.min(width, height);
  if (min <= 0) return { borderRadius: SOFT_RADIUS };
  if (min <= ICON_TARGET_MAX && Math.abs(width - height) <= 4) {
    return { borderRadius: min / 2 };
  }
  return { borderRadius: Math.min(SOFT_RADIUS, min / 2) };
}

/** Raio declarado pelo estilo; sem ele, a forma deduzida do tamanho. */
export function rippleShape(
  style: StyleProp<ViewStyle>,
  width: number,
  height: number,
): ViewStyle {
  return rippleCorners(style) ?? fallbackCorners(width, height);
}

/**
 * Se o alvo usa o ripple recortado (`rounded`), o nativo (`native`) ou nao tem
 * feedback (`none`). O nativo so fica para `borderless`, que e um circulo sem
 * recorte por definicao.
 */
export function pressRippleMode(
  ripple: PressableAndroidRippleConfig | null | undefined,
  feedback: boolean,
): 'none' | 'native' | 'rounded' {
  if (!feedback) return 'none';
  if (ripple?.borderless === true) return 'native';
  return 'rounded';
}

export const Press = forwardRef<ViewType, PressProps>(function Press(
  { style, android_ripple, feedback = true, onLayout, onPressIn, onPressOut, children, ...rest },
  ref,
) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  // O estilo pode ser uma funcao (`Button`): resolvemos a variante sem
  // pressionar para saber o raio dos cantos.
  const resolvedStyle =
    typeof style === 'function' ? style(IDLE_PRESS_STATE) : (style as StyleProp<ViewStyle>);
  const mode = pressRippleMode(android_ripple, feedback);
  const roundedRipple = Platform.OS === 'android' && mode === 'rounded';

  const [scale] = useState(() => new Animated.Value(0));
  const [alpha] = useState(() => new Animated.Value(0));
  const [ripple, setRipple] = useState<RippleState | null>(null);
  const size = useRef({ width: 0, height: 0 });

  const handleLayout = (event: LayoutChangeEvent) => {
    size.current = {
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    };
    onLayout?.(event);
  };

  const handlePressIn = (event: GestureResponderEvent) => {
    if (roundedRipple) {
      const { locationX, locationY } = event.nativeEvent;
      const { width, height } = size.current;
      // Raio ate o canto mais distante: o circulo cobre o alvo inteiro.
      const radius = Math.max(
        48,
        Math.hypot(
          Math.max(locationX, width - locationX),
          Math.max(locationY, height - locationY),
        ),
      );
      scale.stopAnimation();
      alpha.stopAnimation();
      scale.setValue(0);
      alpha.setValue(android_ripple?.alpha ?? 1);
      setRipple({
        x: locationX,
        y: locationY,
        radius,
        shape: rippleShape(resolvedStyle, width, height),
      });
      Animated.timing(scale, {
        toValue: 1,
        duration: RIPPLE_GROW,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    if (roundedRipple) {
      Animated.timing(alpha, {
        toValue: 0,
        duration: RIPPLE_FADE,
        useNativeDriver: true,
      }).start();
    }
    onPressOut?.(event);
  };

  const rippleColor = android_ripple?.color ?? colors.ripple;

  const rippleLayer =
    roundedRipple && ripple ? (
      <View pointerEvents="none" style={[styles.rippleLayer, ripple.shape]}>
        <Animated.View
          style={[
            styles.ripple,
            {
              left: ripple.x - ripple.radius,
              top: ripple.y - ripple.radius,
              width: ripple.radius * 2,
              height: ripple.radius * 2,
              borderRadius: ripple.radius,
              backgroundColor: rippleColor,
              opacity: alpha,
              transform: [{ scale }],
            },
          ]}
        />
      </View>
    ) : null;

  return (
    <Pressable
      ref={ref}
      android_ripple={
        mode === 'native'
          ? (android_ripple ?? { color: colors.ripple, borderless: false })
          : undefined
      }
      onLayout={handleLayout}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        feedback && state.pressed && Platform.OS !== 'android' ? styles.pressed : null,
      ]}
      {...rest}
    >
      {typeof children === 'function'
        ? (state: PressableStateCallbackType) => (
            <>
              {rippleLayer}
              {children(state)}
            </>
          )
        : (
            <>
              {rippleLayer}
              {children}
            </>
          )}
    </Pressable>
  );
});

const baseStyles = defineStyles({
  // No iOS nao ha ripple: o alvo fica fosco enquanto o dedo esta nele.
  pressed: { opacity: 0.6 },
  // Recorta o circulo do ripple pela forma do alvo.
  rippleLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  ripple: { position: 'absolute' },
});
