/**
 * Tokens de design do app. A estetica segue o Voice Memos no tema preto
 * (AMOLED) e o Notion nos temas claros e cinza.
 *
 * As tres paletas trocam apenas cor. `colors` e `gradients` sao leitores da
 * paleta ativa: quem desenha le o valor atual no render. Estilos estaticos
 * passam por `createThemedStyles`, que troca as cores da paleta base (AMOLED)
 * pela paleta ativa sem recriar o modulo.
 */

export type ThemeName = 'light' | 'dark' | 'amoled';

export const DEFAULT_THEME: ThemeName = 'amoled';

export interface ThemeColors {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  borderStrong: string;

  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Texto e icones sobre accent/record: branco em todos os temas. */
  onAccent: string;

  accent: string;
  accentStrong: string;
  accentSoft: string;

  record: string;
  recordStrong: string;
  recordSoft: string;

  success: string;
  successSoft: string;

  warning: string;
  warningSoft: string;

  danger: string;
  dangerSoft: string;

  info: string;
  infoSoft: string;

  overlay: string;
  /** Fundo neutro de chips/badges sem cor propria. */
  neutralSoft: string;
  /** Ripple dos botoes. */
  ripple: string;
}

export interface ThemeGradients {
  app: readonly [string, string];
  accent: readonly [string, string];
  record: readonly [string, string];
  surface: readonly [string, string];
}

export interface ThemePalette {
  colors: ThemeColors;
  gradients: ThemeGradients;
}

const AMOLED: ThemePalette = {
  colors: {
    bg: '#000000',
    bgElevated: '#0A0A0A',
    surface: '#1C1C1E',
    surfaceElevated: '#2C2C2E',
    border: 'rgba(255,255,255,0.09)',
    borderStrong: 'rgba(255,255,255,0.18)',
    text: '#FFFFFF',
    textSecondary: '#8E8E93',
    textTertiary: '#5A5A5F',
    // `rgb()` em vez de `#FFFFFF`: o valor precisa ser distinto do texto para
    // o mapeamento de estilos estaticos nao trocar um pelo outro.
    onAccent: 'rgb(255, 255, 255)',
    accent: '#0A84FF',
    accentStrong: '#409CFF',
    accentSoft: 'rgba(10,132,255,0.16)',
    record: '#FF3B30',
    recordStrong: '#FF6961',
    recordSoft: 'rgba(255,59,48,0.18)',
    success: '#30D158',
    successSoft: 'rgba(48,209,88,0.16)',
    warning: '#FF9F0A',
    warningSoft: 'rgba(255,159,10,0.16)',
    danger: '#FF453A',
    dangerSoft: 'rgba(255,69,58,0.16)',
    info: '#64D2FF',
    infoSoft: 'rgba(100,210,255,0.16)',
    overlay: 'rgba(0,0,0,0.6)',
    neutralSoft: 'rgba(255,255,255,0.06)',
    ripple: 'rgba(255,255,255,0.10)',
  },
  gradients: {
    app: ['#000000', '#000000'],
    accent: ['#409CFF', '#0A84FF'],
    record: ['#FF6961', '#FF3B30'],
    surface: ['#2C2C2E', '#1C1C1E'],
  },
};

const DARK: ThemePalette = {
  colors: {
    bg: '#191919',
    bgElevated: '#202020',
    surface: '#252525',
    surfaceElevated: '#2F2F2F',
    border: 'rgba(255,255,255,0.10)',
    borderStrong: 'rgba(255,255,255,0.20)',
    text: '#E9E9E7',
    textSecondary: '#9B9B9B',
    textTertiary: '#6F6F6F',
    onAccent: 'rgb(255, 255, 255)',
    accent: '#2383E2',
    accentStrong: '#4E9EEA',
    accentSoft: 'rgba(35,131,226,0.20)',
    record: '#E5534B',
    recordStrong: '#F07972',
    recordSoft: 'rgba(229,83,75,0.20)',
    success: '#4CB782',
    successSoft: 'rgba(76,183,130,0.18)',
    warning: '#E5A03B',
    warningSoft: 'rgba(229,160,59,0.18)',
    danger: '#E5534B',
    dangerSoft: 'rgba(229,83,75,0.18)',
    info: '#5AA9E6',
    infoSoft: 'rgba(90,169,230,0.18)',
    overlay: 'rgba(0,0,0,0.55)',
    neutralSoft: 'rgba(255,255,255,0.07)',
    ripple: 'rgba(255,255,255,0.10)',
  },
  gradients: {
    app: ['#191919', '#191919'],
    accent: ['#4E9EEA', '#2383E2'],
    record: ['#F07972', '#E5534B'],
    surface: ['#2F2F2F', '#252525'],
  },
};

const LIGHT: ThemePalette = {
  colors: {
    bg: '#FFFFFF',
    bgElevated: '#FFFFFF',
    surface: '#F7F7F5',
    surfaceElevated: '#EFEFED',
    border: 'rgba(55,53,47,0.09)',
    borderStrong: 'rgba(55,53,47,0.16)',
    text: '#37352F',
    textSecondary: '#787774',
    textTertiary: '#9B9A97',
    onAccent: 'rgb(255, 255, 255)',
    accent: '#2383E2',
    accentStrong: '#0B6BCB',
    accentSoft: 'rgba(35,131,226,0.12)',
    record: '#E03E3E',
    recordStrong: '#C53030',
    recordSoft: 'rgba(224,62,62,0.12)',
    success: '#0F7B3E',
    successSoft: 'rgba(15,123,62,0.12)',
    warning: '#B25E00',
    warningSoft: 'rgba(223,138,0,0.14)',
    danger: '#D44C47',
    dangerSoft: 'rgba(212,76,71,0.12)',
    info: '#0B6BCB',
    infoSoft: 'rgba(11,107,203,0.12)',
    overlay: 'rgba(15,15,15,0.45)',
    neutralSoft: 'rgba(55,53,47,0.05)',
    ripple: 'rgba(55,53,47,0.08)',
  },
  gradients: {
    app: ['#FFFFFF', '#FFFFFF'],
    accent: ['#4A9EE8', '#2383E2'],
    record: ['#E86A6A', '#E03E3E'],
    surface: ['#EFEFED', '#F7F7F5'],
  },
};

export const THEMES: Record<ThemeName, ThemePalette> = {
  light: LIGHT,
  dark: DARK,
  amoled: AMOLED,
};

/**
 * Paleta fixa usada para escrever os estilos base. Nao depende do tema ativo:
 * um modulo carregado depois de uma troca de tema ainda precisa gerar as
 * mesmas cores de referencia para o mapeamento de `createThemedStyles`.
 */
export const baseColors: ThemeColors = AMOLED.colors;

export const THEME_OPTIONS: {
  name: ThemeName;
  label: string;
  hint: string;
}[] = [
  { name: 'light', label: 'Claro', hint: 'Fundo branco, texto escuro.' },
  { name: 'dark', label: 'Escuro', hint: 'Cinza suave, como o Notion.' },
  { name: 'amoled', label: 'Preto', hint: 'Fundo preto para telas AMOLED.' },
];

export function normalizeTheme(value: unknown): ThemeName {
  return value === 'light' || value === 'dark' || value === 'amoled' ? value : DEFAULT_THEME;
}

let activeTheme: ThemeName = DEFAULT_THEME;

/** Define a paleta que os leitores (`colors`, `gradients`) vao devolver. */
export function setActiveTheme(name: ThemeName): void {
  activeTheme = normalizeTheme(name);
}

export function activeThemeName(): ThemeName {
  return activeTheme;
}

/**
 * Cores da paleta ativa. O acesso acontece no render; para um componente ver a
 * troca, ele assina `useTheme()` (que muda a identidade do contexto).
 */
export const colors: ThemeColors = new Proxy({} as ThemeColors, {
  get(_target, property: string | symbol) {
    if (typeof property !== 'string') return undefined;
    return THEMES[activeTheme].colors[property as keyof ThemeColors];
  },
});

export const gradients: ThemeGradients = new Proxy({} as ThemeGradients, {
  get(_target, property: string | symbol) {
    if (typeof property !== 'string') return undefined;
    return THEMES[activeTheme].gradients[property as keyof ThemeGradients];
  },
});

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
  xxl: 34,
  display: 64,
} as const;
