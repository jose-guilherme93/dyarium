/**
 * Tipografia do editor de notas. Puro e testavel: a escolha vira CSS no WebView
 * e fica guardada como preferencia do aparelho.
 */

export type NoteFontFamily = 'system' | 'serif' | 'mono';
export type NoteFontWeight = 'light' | 'regular' | 'bold';

export interface NoteTypography {
  family: NoteFontFamily;
  /** Tamanho em px. */
  size: number;
  weight: NoteFontWeight;
}

export const DEFAULT_TYPOGRAPHY: NoteTypography = {
  family: 'system',
  size: 17,
  weight: 'regular',
};

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 26;

const FAMILIES: Record<NoteFontFamily, string> = {
  system: '-apple-system, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, monospace',
};

const WEIGHTS: Record<NoteFontWeight, number> = {
  light: 300,
  regular: 400,
  bold: 700,
};

/** Mantem o tamanho dentro do intervalo permitido. */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TYPOGRAPHY.size;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

export function fontFamilyCss(family: NoteFontFamily): string {
  return FAMILIES[family] ?? FAMILIES.system;
}

export function fontWeightCss(weight: NoteFontWeight): number {
  return WEIGHTS[weight] ?? WEIGHTS.regular;
}

/** Normaliza uma tipografia vinda de fora (preferencia antiga ou corrompida). */
export function normalizeTypography(input: Partial<NoteTypography> | undefined): NoteTypography {
  const family = input?.family === 'serif' || input?.family === 'mono' ? input.family : 'system';
  const weight = input?.weight === 'light' || input?.weight === 'bold' ? input.weight : 'regular';
  return { family, weight, size: clampFontSize(input?.size ?? DEFAULT_TYPOGRAPHY.size) };
}
