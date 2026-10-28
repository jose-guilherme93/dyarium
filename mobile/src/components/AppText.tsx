/**
 * Texto e entrada de texto com a tipografia do app.
 *
 * O React Native nao herda `fontFamily` de uma `View` e a fonte padrao do
 * sistema muda entre Android e iOS. O app inteiro usa a mesma familia do
 * Notion (Inter), entao estes wrappers aplicam a familia certa para o peso de
 * cada estilo e deixam um `fontFamily` explicito (serif/mono da nota) vencer.
 *
 * Cada peso e um arquivo Inter separado; por isso o wrapper escolhe a familia
 * pelo `fontWeight` e zera o peso sintetico, que deixaria o texto mais grosso
 * do que o desenhado pela fonte.
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

import { INTER_ITALIC_FAMILY, interFamilyForWeight } from '@/core/typography';

function fontForStyle(style: TextProps['style'] | TextInputProps['style']): TextStyle | null {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  // A nota permite escolher serif/mono; essa escolha ja vem no estilo e manda.
  if (flat?.fontFamily) return null;
  if (flat?.fontStyle === 'italic') {
    return { fontFamily: INTER_ITALIC_FAMILY, fontWeight: 'normal' };
  }
  return {
    fontFamily: interFamilyForWeight(flat?.fontWeight),
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
