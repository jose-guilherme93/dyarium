import { render, screen, waitFor } from '@testing-library/react-native';

import { bookPage } from '@/core/books';

import { ChapterPages } from '@/components/ChapterPages';

jest.mock('@/theme/ThemeContext', () => ({
  useTheme: () => ({
    name: 'light',
    colors: {
      bg: '#ffffff',
      border: 'rgba(55,53,47,0.09)',
      textTertiary: '#9B9A97',
    },
  }),
}));

describe('ChapterPages', () => {
  const page = bookPage({});
  const width = 358;

  it('renderiza N cartoes quando a altura total forca N paginas', async () => {
    const onPageCount = jest.fn();
    render(
      <ChapterPages
        markdown={'Primeiro parágrafo.\n\nSegundo parágrafo com mais texto.\n\nTerceiro.'}
        page={page}
        width={width}
        onPageCount={onPageCount}
        totalHeightOverride={900}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-card-0')).toBeTruthy();
      expect(screen.getByTestId('page-card-1')).toBeTruthy();
      expect(screen.getByTestId('page-card-2')).toBeTruthy();
    });

    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByLabelText('Página 1 de 3')).toBeTruthy();
    expect(screen.getByLabelText('Página 3 de 3')).toBeTruthy();
    expect(onPageCount).toHaveBeenCalledWith(3);
  });

  it('mostra o texto do markdown nos cartoes', async () => {
    render(
      <ChapterPages
        markdown={'A neblina subia do rio.'}
        page={page}
        width={width}
        onPageCount={jest.fn()}
        totalHeightOverride={900}
      />,
    );

    await waitFor(() => {
      expect(screen.queryAllByText('A neblina subia do rio.').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('devolve null para texto vazio', () => {
    const { UNSAFE_root } = render(
      <ChapterPages
        markdown={'   \n  '}
        page={page}
        width={width}
        onPageCount={jest.fn()}
      />,
    );

    expect(UNSAFE_root.children).toHaveLength(0);
  });

  it('devolve null para markdown com imagem', () => {
    const { UNSAFE_root } = render(
      <ChapterPages
        markdown={'Texto.\n\n![foto](attachment:abc)\n\nMais texto.'}
        page={page}
        width={width}
        onPageCount={jest.fn()}
      />,
    );

    expect(UNSAFE_root.children).toHaveLength(0);
  });

  it('devolve null para markdown com audio', () => {
    const { UNSAFE_root } = render(
      <ChapterPages
        markdown={'Texto.\n!audio[attachment:abc]{d=3}\nMais texto.'}
        page={page}
        width={width}
        onPageCount={jest.fn()}
      />,
    );

    expect(UNSAFE_root.children).toHaveLength(0);
  });

  it('devolve null para markdown com titulo', () => {
    const { UNSAFE_root } = render(
      <ChapterPages
        markdown={'# Capítulo 1\n\nTexto.'}
        page={page}
        width={width}
        onPageCount={jest.fn()}
      />,
    );

    expect(UNSAFE_root.children).toHaveLength(0);
  });
});
