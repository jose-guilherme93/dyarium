/**
 * Texto e entrada de texto com a tipografia do app.
 *
 * O React Native nao herda `fontFamily` de uma `View` e a fonte padrao do
 * sistema muda entre Android e iOS. A interface do app usa a Schibsted Grotesk
 * do design system, entao estes wrappers aplicam a familia certa para o peso de
 * cada estilo e deixam um `fontFamily` explicito (serif/mono da nota) vencer.
 *
 * O bundle so tem Medium e SemiBold: pesos ate 500 usam Medium e 600 ou mais
 * usam SemiBold. O italico tambem cai no Medium, porque nao ha italico
 * Schibsted no bundle. Cada arquivo ja carrega o peso desenhado, entao o wrapper
 * zera o peso sintetico, que deixaria o texto mais grosso do que a fonte.
 */

import { forwardRef, type ElementRef } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { designFont } from '@/theme/design';

function familyForWeight(weight: string | number | undefined): string {
  if (weight === 'bold') return designFont.semibold;
  const value = typeof weight === 'number' ? weight : Number(weight);
  return value >= 600 ? designFont.semibold : designFont.regular;
}

function fontForStyle(style: TextProps['style'] | TextInputProps['style']): TextStyle | null {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  // A nota permite escolher serif/mono; essa escolha ja vem no estilo e manda.
  if (flat?.fontFamily) return null;
  if (flat?.fontStyle === 'italic') {
    return { fontFamily: designFont.regular, fontWeight: 'normal' };
  }
  return {
    fontFamily: familyForWeight(flat?.fontWeight),
    fontWeight: 'normal',
  };
}

export const Text = forwardRef<ElementRef<typeof NativeText>, TextProps>(function Text(
  { style, ...props },
  ref,
) {
  const font = fontForStyle(style);
  return <NativeText ref={ref} {...props} style={font ? [style, font] : style} />;
});

export const TextInput = forwardRef<ElementRef<typeof NativeTextInput>, TextInputProps>(
  function TextInput({ style, ...props }, ref) {
    const font = fontForStyle(style);
    return <NativeTextInput ref={ref} {...props} style={font ? [style, font] : style} />;
  },
);
