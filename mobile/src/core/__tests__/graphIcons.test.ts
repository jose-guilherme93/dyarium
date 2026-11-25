import { GRAPH_ICONS, iconKeyFor, iconPaths } from '../graphIcons';
import type { GraphNodeKind } from '../graphModel';

const KINDS: GraphNodeKind[] = ['user', 'person', 'place', 'theme', 'decision', 'note'];

describe('graphIcons', () => {
  it('usa o icone do tipo quando a entidade nao escolheu um', () => {
    expect(iconKeyFor('person', '')).toBe('person');
    expect(iconKeyFor('place', undefined)).toBe('home');
    expect(iconKeyFor('theme', '')).toBe('puzzle');
    expect(iconKeyFor('decision', '')).toBe('check');
    expect(iconKeyFor('note', '')).toBe('document');
  });

  it('o icone escolhido vence o do tipo', () => {
    expect(iconKeyFor('theme', 'heart')).toBe('heart');
  });

  it('ignora uma chave fora da paleta e volta para o tipo', () => {
    expect(iconKeyFor('place', 'nao-existe')).toBe('home');
  });

  it('a paleta cobre todos os tipos e tem um caminho por icone', () => {
    for (const kind of KINDS) {
      expect(GRAPH_ICONS[iconKeyFor(kind, '')]).toBeDefined();
    }
    for (const icon of Object.values(GRAPH_ICONS)) {
      expect(icon.paths.length).toBeGreaterThan(0);
      expect(icon.paths.every((path) => path.length > 0)).toBe(true);
    }
  });

  it('o tema desenha uma unica peca de quebra-cabeca', () => {
    expect(iconPaths('puzzle')).toHaveLength(1);
  });
});
