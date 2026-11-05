/**
 * Cores do mapa por tema (estilo Obsidian).
 *
 * Ficam fora de `ThemeColors` porque nao sao cores de interface: sao a
 * identidade dos tipos de bola e das arestas. O desenho le a paleta do tema
 * ativo, entao o mapa acompanha claro, escuro e preto.
 *
 * As cores saem do mapa do dashboard, mas com pigmento: o mapa do navegador e
 * quase cinza e no aparelho ficava apagado. Cada tipo de bola tem sua cor
 * suave (azul, verde, ocre, vinho, lavanda), as arestas ficam discretas e o
 * centro e um disco translucido do texto do tema.
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
  /** Fundo do nome: a linha passa por tras do texto, nao por cima. */
  labelBackdrop: string;
  /** Cor principal das arestas (com opacidade aplicada pelo peso). */
  edge: string;
  /** Aresta forte: conexao com a bola selecionada. */
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
    person: '#7f9dc8',
    place: '#86b39a',
    theme: '#cbb27a',
    decision: '#c08a8a',
    note: '#9b8fc0',
    user: '#eceae3',
    ink: '#eceae3',
    edge: '#8b93a0',
    edgeStrong: '#b7bcc4',
    selected: '#9cc0e8',
    labelBackdrop: '#000000',
    dim: 'rgba(255,255,255,0.06)',
    label: '#eceae3',
    labelMuted: '#b7bcc4',
    chip: 'rgba(255,255,255,0.07)',
    chipText: '#E5E5EA',
    moodPositive: '#7fc79a',
    moodNeutral: '#e0b26a',
    moodNegative: '#ee8a7c',
  },
  dark: {
    person: '#7f9dc8',
    place: '#86b39a',
    theme: '#cbb27a',
    decision: '#c08a8a',
    note: '#9b8fc0',
    user: '#eceae3',
    ink: '#eceae3',
    edge: '#8b93a0',
    edgeStrong: '#b7bcc4',
    selected: '#9cc0e8',
    labelBackdrop: '#191919',
    dim: 'rgba(255,255,255,0.05)',
    label: '#eceae3',
    labelMuted: '#b7bcc4',
    chip: 'rgba(255,255,255,0.07)',
    chipText: '#E9E9E7',
    moodPositive: '#7fc79a',
    moodNeutral: '#e0b26a',
    moodNegative: '#ee8a7c',
  },
  light: {
    person: '#4e6b96',
    place: '#4d7a63',
    theme: '#8a7134',
    decision: '#8c5b5b',
    note: '#6b5f8f',
    user: '#211e1a',
    ink: '#211e1a',
    edge: '#a8a29a',
    edgeStrong: '#6b655c',
    selected: '#2c4a63',
    labelBackdrop: '#ffffff',
    dim: 'rgba(0,0,0,0.05)',
    label: '#211e1a',
    labelMuted: '#6b655c',
    chip: 'rgba(55,53,47,0.05)',
    chipText: '#37352F',
    moodPositive: '#2f7d4f',
    moodNeutral: '#8a5a16',
    moodNegative: '#9c3b2e',
  },
};