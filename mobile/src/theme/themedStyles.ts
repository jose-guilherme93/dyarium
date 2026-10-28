/**
 * Estilos estaticos com a paleta ativa.
 *
 * Os `StyleSheet.create` do app continuam sendo escritos com a paleta base
 * (AMOLED). Na leitura, cada estilo vira uma copia com as cores da paleta
 * ativa; a copia e memorizada por tema, entao a identidade do objeto so muda
 * quando o tema muda (o React volta a aplicar o estilo no aparelho).
 *
 * Nao e um sistema de CSS: apenas as propriedades de cor sao trocadas. Tudo o
 * que nao e cor (layout, tamanhos, sombras) passa intacto.
 */

import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import {
  THEMES,
  activeThemeName,
  type ThemeColors,
  type ThemeName,
} from './tokens';

/** Propriedades de estilo que carregam uma cor de tema. */
const COLOR_PROPERTIES = new Set([
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderStartColor',
  'borderEndColor',
  'borderBlockColor',
  'borderBlockStartColor',
  'borderBlockEndColor',
  'borderInlineColor',
  'borderInlineStartColor',
  'borderInlineEndColor',
  'outlineColor',
  'tintColor',
  'textDecorationColor',
  'overlayColor',
]);

/** Valor da paleta base -> token semantico. */
const TOKEN_BY_VALUE = new Map<string, keyof ThemeColors>();
for (const [token, value] of Object.entries(THEMES.amoled.colors)) {
  // O proprio codigo garante valores unicos; se dois tokens empatarem, o
  // mapeamento nao consegue saber qual cor usar.
  if (!TOKEN_BY_VALUE.has(value)) TOKEN_BY_VALUE.set(value, token as keyof ThemeColors);
}

const variantCache = new WeakMap<object, Map<ThemeName, object>>();

function themedStyle(base: object, theme: ThemeName): object {
  let byTheme = variantCache.get(base);
  if (!byTheme) {
    byTheme = new Map();
    variantCache.set(base, byTheme);
  }
  const cached = byTheme.get(theme);
  if (cached) return cached;

  const palette = THEMES[theme].colors;
  const next: Record<string, unknown> = { ...base };
  for (const [property, value] of Object.entries(base)) {
    if (!COLOR_PROPERTIES.has(property) || typeof value !== 'string') continue;
    const token = TOKEN_BY_VALUE.get(value);
    if (token) next[property] = palette[token];
  }
  byTheme.set(theme, next);
  return next;
}

/**
 * Declara estilos base com a tipagem do React Native. E so uma identidade: a
 * troca de cores acontece em `useThemedStyles`, no render.
 */
export function defineStyles<
  T extends Record<string, ViewStyle | TextStyle | ImageStyle>,
>(styles: T): T {
  return styles;
}

/**
 * Substituto de `StyleSheet.create` que respeita o tema ativo.
 *
 * Use no lugar de `StyleSheet.create` para qualquer estilo que referencie
 * `colors`. O objeto devolvido e um leitor: `styles.card` entrega a variante do
 * tema atual.
 */
export function createThemedStyles<
  T extends Record<string, ViewStyle | TextStyle | ImageStyle>,
>(styles: T, theme?: ThemeName): T {
  return new Proxy(styles, {
    get(target, property, receiver) {
      if (typeof property !== 'string' || !Object.prototype.hasOwnProperty.call(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      const base = target[property];
      return themedStyle(base, theme ?? activeThemeName());
    },
  }) as T;
}
