/**
 * Tipografia do editor de notas. Puro e testavel: a escolha vira estilo do
 * editor nativo e fica guardada como preferencia do aparelho.
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
  size: 16,
  weight: 'regular',
};

/** Entrelinha e espacamento das letras do texto da nota, no tom do Notion. */
export const NOTE_LINE_HEIGHT = 1.6;
export const NOTE_LETTER_SPACING = 0.1;

/**
 * Familias Inter carregadas pelo `_layout`. O React Native nao escolhe o peso
 * de uma fonte customizada pelo `fontWeight` em todas as plataformas, entao
 * cada peso tem o proprio arquivo e o nome da familia o identifica.
 */
export const INTER_FAMILIES = {
  light: 'Inter_300Light',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

/** Familia Inter para um peso numerico vindo de qualquer estilo da tela. */
export function interFamilyForWeight(weight: string | number | undefined): string {
  const value = typeof weight === 'number' ? weight : Number(weight);
  if (value >= 800) return INTER_FAMILIES.extrabold;
  if (value >= 700) return INTER_FAMILIES.bold;
  if (value >= 600) return INTER_FAMILIES.semibold;
  if (value >= 500) return INTER_FAMILIES.medium;
  if (value > 0 && value < 400) return INTER_FAMILIES.light;
  return INTER_FAMILIES.regular;
}

export const INTER_ITALIC_FAMILY = 'Inter_400Regular_Italic';

export function noteLineHeight(size: number): number {
  return Math.round(size * NOTE_LINE_HEIGHT);
}

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 26;

const FAMILIES: Record<NoteFontFamily, string> = {
  system: `"Inter", -apple-system, system-ui, sans-serif`,
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

/** Familia equivalente no React Native: as pilhas que o sistema entende. */
const NATIVE_FAMILIES: Record<Exclude<NoteFontFamily, 'system'>, string> = {
  serif: 'serif',
  mono: 'monospace',
};

/**
 * Familia nativa do editor. `system` agora e a Inter, a mesma da interface; o
 * peso entra pela familia porque cada peso e um arquivo separado.
 */
export function fontFamilyNative(
  family: NoteFontFamily,
  weight: NoteFontWeight = 'regular',
): string | undefined {
  if (family === 'system') return interFamilyForWeight(WEIGHTS[weight]);
  return NATIVE_FAMILIES[family] ?? undefined;
}

/** Peso equivalente no TextStyle do React Native (string, como a plataforma espera). */
export function fontWeightNative(weight: NoteFontWeight): '300' | '400' | '700' {
  return String(WEIGHTS[weight] ?? WEIGHTS.regular) as '300' | '400' | '700';
}

/** Normaliza uma tipografia vinda de fora (preferencia antiga ou corrompida). */
export function normalizeTypography(input: Partial<NoteTypography> | undefined): NoteTypography {
  const family = input?.family === 'serif' || input?.family === 'mono' ? input.family : 'system';
  const weight = input?.weight === 'light' || input?.weight === 'bold' ? input.weight : 'regular';
  return { family, weight, size: clampFontSize(input?.size ?? DEFAULT_TYPOGRAPHY.size) };
}
