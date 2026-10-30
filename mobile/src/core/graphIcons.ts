/**
 * Icones monocromaticos do mapa.
 *
 * As chaves sao as mesmas que o servidor valida (`internal/store/icons.go`);
 * o desenho vive no cliente. Cada icone e uma lista de caminhos num quadro
 * 24x24, desenhados com traco: nada de bitmap, entao acompanham o zoom sem
 * borrar.
 */

import type { GraphNodeKind } from './graphModel';

interface GraphIcon {
  label: string;
  paths: string[];
}

export const GRAPH_ICONS: Record<string, GraphIcon> = {
  person: {
    label: 'Pessoa',
    paths: [
      'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
      'M7.5 7.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0Z',
    ],
  },
  home: {
    label: 'Casa',
    paths: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5'],
  },
  hash: {
    label: 'Tema',
    paths: ['M4 9h16M4 15h16M10 3 8 21M16 3l-2 18'],
  },
  check: {
    label: 'Decisão',
    paths: ['M4 12.5 9.5 18 20 6'],
  },
  heart: {
    label: 'Coração',
    paths: ['M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9Z'],
  },
  star: {
    label: 'Estrela',
    paths: ['m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z'],
  },
  book: {
    label: 'Livro',
    paths: ['M4 4h7a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4Z', 'M20 4h-3a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20Z'],
  },
  briefcase: {
    label: 'Trabalho',
    paths: ['M3 8h18v12H3V8Z', 'M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2', 'M3 13h18'],
  },
  music: {
    label: 'Música',
    paths: ['M9 18V6l10-2v12', 'M4 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0Z', 'M14 16a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0Z'],
  },
  health: {
    label: 'Saúde',
    paths: ['M12 5v14M5 12h14'],
  },
  money: {
    label: 'Dinheiro',
    paths: ['M12 3v18', 'M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3S9 11 12 11s4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3'],
  },
  food: {
    label: 'Comida',
    paths: ['M5 3v8a2 2 0 0 0 4 0V3', 'M7 11v10', 'M17 3c-2 0-3 2-3 4s1 3 3 3v11'],
  },
  car: {
    label: 'Carro',
    paths: ['M3 16v-3l2-5h14l2 5v3', 'M3 16h18', 'M5 19.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0Z', 'M16 19.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0Z'],
  },
  plane: {
    label: 'Viagem',
    paths: ['M2 13.5 22 4l-5.5 17-4-6-5.5-1.5Z'],
  },
  tree: {
    label: 'Natureza',
    paths: ['M12 21v-5', 'M7 16c0-2.8 2.2-5 5-5s5 2.2 5 5', 'M9 16h6'],
  },
  sun: {
    label: 'Dia',
    paths: ['M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', 'M7.5 12a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0Z'],
  },
  moon: {
    label: 'Noite',
    paths: ['M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z'],
  },
  flag: {
    label: 'Marco',
    paths: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'],
  },
  globe: {
    label: 'Mundo',
    paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0Z', 'M3 12h18', 'M12 3c3.5 3 3.5 15 0 18', 'M12 3c-3.5 3-3.5 15 0 18'],
  },
  camera: {
    label: 'Foto',
    paths: ['M3 8h4l1.5-2h7L17 8h4v12H3V8Z', 'M8.5 14a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0Z'],
  },
  document: {
    label: 'Nota',
    paths: ['M6 3h8l4 4v14H6V3Z', 'M14 3v4h4', 'M9 12h6M9 16h6'],
  },
};

/** Chaves aceitas pelo servidor e pelo seletor de icone. */
export const GRAPH_ICON_KEYS = Object.keys(GRAPH_ICONS);

const KIND_ICON: Record<GraphNodeKind, string> = {
  user: 'person',
  person: 'person',
  place: 'home',
  theme: 'hash',
  decision: 'check',
  note: 'document',
};

/** Icone efetivo: o escolhido quando valido, senao o do tipo. */
export function iconKeyFor(kind: GraphNodeKind, icon?: string): string {
  if (icon && GRAPH_ICONS[icon]) return icon;
  return KIND_ICON[kind] ?? 'person';
}

export function iconPaths(key: string): string[] {
  return GRAPH_ICONS[key]?.paths ?? GRAPH_ICONS.person.paths;
}
