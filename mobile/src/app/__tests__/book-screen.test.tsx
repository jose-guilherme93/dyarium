import { useLocalSearchParams } from 'expo-router';

import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Notebook } from '@/core/notebooks';
import type { Recording } from '@/core/types';

import BookScreen from '../books/[id]';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({ id: 'nb-livro' })),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/services/appNavigation', () => ({
  back: () => mockBack(),
  push: (...args: unknown[]) => mockPush(...args),
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    notebooks: mockNotebooks,
    recordings: mockRecordings,
  }),
}));

let mockNotebooks: Notebook[] = [];
let mockRecordings: Recording[] = [];

const BOOK: Notebook = {
  id: 'nb-livro',
  name: 'O nome do vento',
  color: '#b8c4c8',
  isDefault: false,
  kind: 'book',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  author: 'Ana Ribeiro',
  subtitle: 'Volume I',
  goalWords: 90_000,
};

function recording(
  id: string,
  title: string,
  notebookId: string,
  overrides: Partial<Recording> = {},
): Recording {
  return {
    id,
    title,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    recordedAt: '2026-10-01T10:00:00.000Z',
    dir: '',
    segmentCount: 0,
    offset: 0,
    attempts: 0,
    status: 'completed',
    notebookId,
    ...overrides,
  };
}

function chapter(
  id: string,
  title: string,
  position: number,
  status: string,
  text = '',
): Recording {
  return recording(id, title, 'nb-livro', {
    chapterKind: 'chapter',
    chapterPosition: position,
    chapterStatus: status,
    text,
  });
}

function part(id: string, title: string, position: number): Recording {
  return recording(id, title, 'nb-livro', {
    chapterKind: 'part',
    chapterPosition: position,
  });
}

const mockedParams = useLocalSearchParams as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedParams.mockReturnValue({ id: 'nb-livro' });
  mockNotebooks = [BOOK];
  mockRecordings = [
    chapter('ch-1', 'O mapa', 1, 'done', 'uma duas tres quatro cinco'),
    chapter('ch-2', 'A ponte', 2, 'revising', 'seis sete oito'),
    part('part-2', 'Parte II · A cidade de vidro', 3),
    chapter('ch-3', 'O mercado', 4, 'draft', 'nove dez onze'),
    chapter('ch-4', 'Texto', 5, 'draft', ''),
  ];
});

describe('tela do livro', () => {
  it('mostra título, autor, stats e meta', () => {
    render(<BookScreen />);

    expect(screen.getByTestId('book-title')).toHaveTextContent('O nome do vento');
    expect(screen.getByText('por Ana Ribeiro · Volume I')).toBeTruthy();
    expect(screen.getByTestId('book-stats')).toHaveTextContent(/4\s*capítulos\s*·\s*11\s*palavras\s*·\s*≈1\s*página/);
    expect(screen.getByTestId('book-goal')).toHaveTextContent(/0%\s*da meta de 90\.000/);
  });

  it('usa singular para 1 capítulo, 1 palavra e meta de 1 palavra', () => {
    mockNotebooks = [{ ...BOOK, goalWords: 1 }];
    mockRecordings = [chapter('ch-1', 'Único', 1, 'draft', 'palavra')];
    render(<BookScreen />);

    expect(screen.getByTestId('book-stats')).toHaveTextContent(/1\s*capítulo\s*·\s*1\s*palavra\s*·\s*≈1\s*página/);
    expect(screen.getByTestId('book-goal')).toHaveTextContent(/100%\s*da meta de 1 palavra/);
  });

  it('mostra F/P para frontispício e posfácio', () => {
    mockRecordings = [
      recording('front-1', 'Prefácio', 'nb-livro', {
        chapterKind: 'front',
        chapterPosition: 0,
        text: 'uma introdução',
      }),
      chapter('ch-1', 'Abertura', 1, 'draft', 'uma cena'),
      recording('back-1', 'Epílogo', 'nb-livro', {
        chapterKind: 'back',
        chapterPosition: 2,
        text: 'um fechamento',
      }),
    ];
    render(<BookScreen />);

    expect(screen.getByTestId('chapter-row-front-1')).toHaveTextContent(/F\s*Prefácio/);
    expect(screen.getByTestId('chapter-row-back-1')).toHaveTextContent(/P\s*Epílogo/);
  });

  it('agrupa capítulos em partes e numera sem contar a parte', () => {
    render(<BookScreen />);

    expect(screen.getByTestId('part-row-1')).toHaveTextContent(/Parte\s*II\s*·\s*A cidade de vidro/);
    expect(screen.getByText('O mapa')).toBeTruthy();
    expect(screen.getByText('A ponte')).toBeTruthy();
    expect(screen.getByText('O mercado')).toBeTruthy();
    expect(screen.getByText('Texto')).toBeTruthy();

    expect(screen.getByTestId('chapter-row-ch-1')).toHaveTextContent(/1\s*O mapa/);
    expect(screen.getByTestId('chapter-row-ch-2')).toHaveTextContent(/2\s*A ponte/);
    expect(screen.getByTestId('chapter-row-ch-3')).toHaveTextContent(/3\s*O mercado/);
    expect(screen.getByTestId('chapter-row-ch-4')).toHaveTextContent(/4\s*Texto/);
  });

  it('sugere continuar no primeiro capítulo não finalizado', () => {
    render(<BookScreen />);

    expect(screen.getByTestId('continue-row')).toHaveTextContent(/Continuar\s*no/);
    expect(screen.getByTestId('continue-row')).toHaveTextContent(/Capítulo\s*2\s*·\s*A ponte/);
  });

  it('quando todos estão finalizados, continua no primeiro capítulo', () => {
    mockRecordings = [
      chapter('ch-1', 'O mapa', 1, 'done', 'uma duas tres'),
      chapter('ch-2', 'A ponte', 2, 'done', 'quatro cinco seis'),
    ];
    render(<BookScreen />);

    expect(screen.getByTestId('continue-row')).toHaveTextContent(/Capítulo\s*1\s*·\s*O mapa/);
  });

  it('tocar num capítulo abre a nota', () => {
    render(<BookScreen />);

    fireEvent.press(screen.getByText('O mercado'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/note/[id]',
      params: { id: 'ch-3' },
    });
  });

  it('mostra "vazio" para capítulo sem texto e sem palavras', () => {
    render(<BookScreen />);

    expect(screen.getByText('vazio')).toBeTruthy();
  });

  it('mostra estado vazio quando o livro não tem capítulos', () => {
    mockRecordings = [];
    render(<BookScreen />);

    expect(screen.getByTestId('book-empty')).toHaveTextContent('Nenhum capítulo');
    expect(screen.queryByTestId('continue-row')).toBeNull();
  });

  it('mostra estado vazio quando o id não existe', () => {
    mockedParams.mockReturnValue({ id: 'nb-apagado' });
    render(<BookScreen />);

    expect(screen.getByTestId('book-empty')).toHaveTextContent('Livro não encontrado');
  });
});
