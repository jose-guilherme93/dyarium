/**
 * Arquivo gerado por scripts/design-tokens.mjs a partir de docs/design/tokens.json.
 * Nao edite a mao: rode `make tokens` para regerar.
 */

export type DesignThemeName = 'light' | 'dark' | 'amoled';

export type DesignColors = {
  surface: string;
  surfaceAlt: string;
  surfaceRaised: string;
  line: string;
  text: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  danger: string;
  success: string;
  warning: string;
  info: string;
};

export const designColors: Record<DesignThemeName, DesignColors> = {
  light: {
    surface: '#eceee9',
    surfaceAlt: '#e3e6e0',
    surfaceRaised: '#dadfd7',
    line: '#d2d6cf',
    text: '#232622',
    textMuted: '#6a6f68',
    primary: '#5b6f66',
    primarySoft: '#dce3e0',
    danger: '#9c6259',
    success: '#5c7a63',
    warning: '#8b7444',
    info: '#5a6f80',
  },
  dark: {
    surface: '#171a18',
    surfaceAlt: '#1f2320',
    surfaceRaised: '#272c28',
    line: '#2f3431',
    text: '#e4e8e3',
    textMuted: '#a1a8a2',
    primary: '#a2b8ae',
    primarySoft: '#2a3431',
    danger: '#c78f85',
    success: '#94b09a',
    warning: '#c6ab77',
    info: '#9ab3c4',
  },
  amoled: {
    surface: '#000000',
    surfaceAlt: '#0b0d0c',
    surfaceRaised: '#151817',
    line: '#242826',
    text: '#e4e8e3',
    textMuted: '#9aa198',
    primary: '#a2b8ae',
    primarySoft: '#1e2624',
    danger: '#c78f85',
    success: '#94b09a',
    warning: '#c6ab77',
    info: '#9ab3c4',
  },
};

export const designType = {
  display: {
    size: 21,
    weight: 600,
    lineHeight: 1.2,
    letterSpacing: -0.01,
  },
  title: {
    size: 17,
    weight: 600,
    lineHeight: 1.3,
    letterSpacing: -0.005,
  },
  body: {
    size: 13,
    weight: 500,
    lineHeight: 1.32,
    letterSpacing: 0,
  },
  label: {
    size: 10,
    weight: 500,
    lineHeight: 1.2,
    letterSpacing: 0.12,
  },
  mono: {
    size: 11.5,
    weight: 500,
    lineHeight: 1.2,
    letterSpacing: 0.02,
  },
} as const;

export const designSpace = {
  s2: 2,
  s4: 4,
  s6: 6,
  s8: 8,
  s12: 12,
  s16: 16,
} as const;

export const designRadius = {
  control: 2,
  surface: 3,
} as const;

export const designFocus = {
  width: 1,
  offset: 2,
} as const;

export const designControl = {
  sm: 20,
  md: 26,
  lg: 30,
  padSm: 7,
  padMd: 9,
  padLg: 12,
} as const;

export const designMeter = {
  height: 2,
  gap: 8,
} as const;

export const designFont = {
  regular: 'SchibstedGrotesk-Medium',
  semibold: 'SchibstedGrotesk-SemiBold',
} as const;
