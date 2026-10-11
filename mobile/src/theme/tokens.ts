/**
 * Tokens de design do app. Estetica inspirada no Voice Memos do iOS: fundo
 * preto, vermelho para gravacao, cinzas neutros, tipografia limpa.
 */

export const colors = {
  bg: '#000000',
  bgElevated: '#0A0A0A',
  surface: '#1C1C1E',
  surfaceElevated: '#2C2C2E',
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.18)',

  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#5A5A5F',

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
} as const;

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

export const gradients = {
  app: ['#000000', '#000000'] as const,
  accent: ['#409CFF', '#0A84FF'] as const,
  record: ['#FF6961', '#FF3B30'] as const,
  surface: ['#2C2C2E', '#1C1C1E'] as const,
} as const;
