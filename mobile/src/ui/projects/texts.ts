/**
 * Estilos de texto da superficie Projetos, derivados so dos tokens gerados
 * (`docs/design/tokens.json` via `src/theme/design.ts`). Cor nunca mora aqui:
 * quem desenha aplica `useDesign()` por cima.
 */

import { Platform, type TextStyle } from 'react-native';

import {
  designFont,
  designType,
} from '@/theme/design';

/** Pilha mono nativa: o sistema escolhe a familia monoespacada do aparelho. */
const MONO_FAMILY = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });

export const typeStyles: Record<'display' | 'title' | 'body' | 'label' | 'mono', TextStyle> = {
  display: {
    fontFamily: designFont.semibold,
    fontSize: designType.display.size,
    lineHeight: designType.display.size * designType.display.lineHeight,
    letterSpacing: designType.display.letterSpacing * designType.display.size,
  },
  title: {
    fontFamily: designFont.semibold,
    fontSize: designType.title.size,
    lineHeight: designType.title.size * designType.title.lineHeight,
    letterSpacing: designType.title.letterSpacing * designType.title.size,
  },
  body: {
    fontFamily: designFont.regular,
    fontSize: designType.body.size,
    lineHeight: designType.body.size * designType.body.lineHeight,
    letterSpacing: designType.body.letterSpacing * designType.body.size,
  },
  label: {
    fontFamily: designFont.regular,
    fontSize: designType.label.size,
    lineHeight: designType.label.size * designType.label.lineHeight,
    letterSpacing: designType.label.letterSpacing * designType.label.size,
    textTransform: 'uppercase' as const,
  },
  mono: {
    fontFamily: MONO_FAMILY,
    fontSize: designType.mono.size,
    lineHeight: designType.mono.size * designType.mono.lineHeight,
    letterSpacing: designType.mono.letterSpacing * designType.mono.size,
    fontVariant: ['tabular-nums' as const],
  },
};
