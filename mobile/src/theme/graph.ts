/**
 * Cores do mapa por tema.
 *
 * Ficam fora de `ThemeColors` porque nao sao cores de interface: sao a
 * identidade dos tipos de bola e das arestas. O desenho le a paleta do tema
 * ativo, entao o mapa acompanha claro, escuro e preto.
 */

import type { ThemeName } from './tokens';

export interface GraphColors {
  person: string;
  place: string;
  theme: string;
  decision: string;
  note: string;
  user: string;
  /** Cor dos icones desenhados dentro das bolas. */
  ink: string;
  edge: string;
  edgeStrong: string;
  selected: string;
  dim: string;
  label: string;
  labelMuted: string;
  chip: string;
  chipText: string;
  moodPositive: string;
  moodNeutral: string;
  moodNegative: string;
}

export const GRAPH_PALETTES: Record<ThemeName, GraphColors> = {
  amoled: {
    person: '#9AA1A8',
    place: '#9AA39C',
    theme: '#AAA49C',
    decision: '#A39DA4',
    note: '#A6A19B',
    user: '#ECEAE3',
    ink: '#15151A',
    edge: '#ECEAE3',
    edgeStrong: '#ECEAE3',
    selected: '#9CC0E8',
    dim: 'rgba(236,234,227,0.06)',
    label: '#ECEAE3',
    labelMuted: '#B7BCC4',
    chip: 'rgba(255,255,255,0.07)',
    chipText: '#E5E5EA',
    moodPositive: '#30D158',
    moodNeutral: '#8E8E93',
    moodNegative: '#FF453A',
  },
  dark: {
    person: '#9AA1A8',
    place: '#9AA39C',
    theme: '#AAA49C',
    decision: '#A39DA4',
    note: '#A6A19B',
    user: '#ECEAE3',
    ink: '#15151A',
    edge: '#ECEAE3',
    edgeStrong: '#ECEAE3',
    selected: '#9CC0E8',
    dim: 'rgba(236,234,227,0.05)',
    label: '#ECEAE3',
    labelMuted: '#B7BCC4',
    chip: 'rgba(255,255,255,0.07)',
    chipText: '#E9E9E7',
    moodPositive: '#4CB782',
    moodNeutral: '#9B9B9B',
    moodNegative: '#E5534B',
  },
  light: {
    person: '#858C93',
    place: '#88918A',
    theme: '#96918A',
    decision: '#918B92',
    note: '#948F8A',
    user: '#211E1A',
    ink: '#F6F4EF',
    edge: '#211E1A',
    edgeStrong: '#211E1A',
    selected: '#2C4A63',
    dim: 'rgba(33,30,26,0.05)',
    label: '#211E1A',
    labelMuted: '#6B655C',
    chip: 'rgba(55,53,47,0.05)',
    chipText: '#37352F',
    moodPositive: '#0F7B3E',
    moodNeutral: '#787774',
    moodNegative: '#D44C47',
  },
};
