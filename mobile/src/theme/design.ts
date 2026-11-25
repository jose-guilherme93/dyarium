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
  dev: string;
  info: string;
  overlay: string;
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
    dev: '#b3642e',
    info: '#5a6f80',
    overlay: 'rgba(0,0,0,0.18)',
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
    dev: '#e0a273',
    info: '#9ab3c4',
    overlay: 'rgba(0,0,0,0.45)',
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
    dev: '#e0a273',
    info: '#9ab3c4',
    overlay: 'rgba(0,0,0,0.55)',
  },
};

export const designType = {
  greeting: {
    size: 48,
    weight: 600,
    lineHeight: 1.05,
    letterSpacing: -0.025,
  },
  clock: {
    size: 40,
    weight: 600,
    lineHeight: 1.05,
    letterSpacing: 0.01,
  },
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
  s24: 24,
  s32: 32,
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
  compose: 44,
} as const;

export const designRow = {
  touch: 44,
  dense: 26,
} as const;

export const designTree = {
  cell: 14,
  rail: 6,
  guide: 1,
} as const;

export const designMark = {
  size: 8,
  stroke: 1.5,
  tick: 4,
} as const;

export const designChart = {
  height: 84,
  top: 8,
  base: 64,
  labels: 78,
  barMin: 3,
  colMin: 5,
  colMax: 16,
  colRatio: 0.52,
  sessionMin: 10,
  sessionBarMin: 6,
} as const;

export const designIcon = {
  sm: 12,
  md: 14,
  lg: 24,
  box: 16,
  stroke: 1.5,
  strokeDetail: 1.3,
  set: ["menu","plus","back","forward","search","mic","panel","theme","more","tree","book","grid","sync","close","chevron","check","pin","tag","alert","cloud","server","sort","chart","image","link","doc","clock","bell","calendar","network","trash","play","pause","stop","gear"],
} as const;

export const designReading = {
  family: 'Newsreader',
  stack: "\"Newsreader\", Georgia, serif",
  size: 15,
  weight: 400,
  lineHeight: 1.45,
  measure: 44,
} as const;

export const designLayout = {
  page: 420,
  measure: 58,
  gutter: 24,
  sidebar: 238,
  rail: 34,
  toolbar: 34,
  tab: 26,
  spread: 520,
  phone: 324,
} as const;

export const designLayer = {
  content: 0,
  rail: 1,
  toolbar: 2,
  sheet: 40,
  dialog: 50,
  notice: 60,
  tooltip: 70,
} as const;

export const designMotion = {
  fast: 90,
  base: 160,
  ease: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

export const designNotice = {
  dwell: 6000,
} as const;

export const designWave = {
  height: 44,
  bar: 1.5,
  gap: 1,
  min: 2,
  idle: 0.26,
  played: 1,
} as const;

export const designState = {
  bar: 2,
  disabled: 0.45,
} as const;

export const designFont = {
  regular: 'SchibstedGrotesk-Medium',
  semibold: 'SchibstedGrotesk-SemiBold',
  monoStack: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace",
} as const;
