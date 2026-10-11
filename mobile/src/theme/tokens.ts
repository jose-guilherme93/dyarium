/**
 * Tokens de design do app. Estetica escura, alto contraste, cantos generosos.
 * Mantenha os nomes estaveis: as telas importam daqui.
 */

export const colors = {
  bg: '#0A0A0F',
  bgElevated: '#0F0F16',
  surface: '#14141C',
  surfaceElevated: '#1B1B26',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',

  text: '#F5F5F7',
  textSecondary: '#9A9AA8',
  textTertiary: '#63636F',

  accent: '#6E56CF',
  accentStrong: '#8B73E8',
  accentSoft: 'rgba(110,86,207,0.18)',

  record: '#FF4D5E',
  recordStrong: '#FF6B78',
  recordSoft: 'rgba(255,77,94,0.18)',

  success: '#3DD68C',
  successSoft: 'rgba(61,214,140,0.16)',

  warning: '#F5A623',
  warningSoft: 'rgba(245,166,35,0.16)',

  danger: '#FF5A5F',
  dangerSoft: 'rgba(255,90,95,0.16)',

  info: '#4CC2FF',
  infoSoft: 'rgba(76,194,255,0.16)',

  overlay: 'rgba(5,5,8,0.72)',
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
  app: ['#0A0A0F', '#0E0E18', '#0A0A0F'] as const,
  accent: ['#8B73E8', '#6E56CF'] as const,
  record: ['#FF6B78', '#FF4D5E'] as const,
  surface: ['#1B1B26', '#14141C'] as const,
} as const;
