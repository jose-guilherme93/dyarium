/**
 * Estilo do HTML rico da nota.
 *
 * O mesmo objeto alimenta o editor nativo (`EnrichedTextInput`) e a previa de
 * leitura (`EnrichedText`), para o conteudo nao mudar de aparencia ao tocar.
 */

import type { HtmlStyle } from 'react-native-enriched-html';

import type { NoteTypography } from '@/core/typography';
import { colors, radius } from '@/theme/tokens';

export function noteHtmlStyle(typography?: NoteTypography): HtmlStyle {
  const size = typography?.size ?? 17;
  return {
    h1: { fontSize: Math.round(size * 1.6), bold: true },
    h2: { fontSize: Math.round(size * 1.35), bold: true },
    h3: { fontSize: Math.round(size * 1.15), bold: true },
    h4: { fontSize: size, bold: true },
    h5: { fontSize: size, bold: true },
    h6: { fontSize: size, bold: true },
    blockquote: {
      borderColor: colors.borderStrong,
      borderWidth: 3,
      gapWidth: 12,
      color: colors.textSecondary,
    },
    codeblock: {
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
    },
    code: {
      color: colors.accentStrong,
      backgroundColor: colors.surface,
    },
    a: {
      color: colors.accent,
      textDecorationLine: 'underline',
    },
    ul: {
      bulletColor: colors.textSecondary,
      bulletSize: 7,
      marginLeft: 20,
      gapWidth: 8,
    },
    ol: {
      marginLeft: 20,
      gapWidth: 8,
      markerColor: colors.textSecondary,
    },
  };
}
