import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { Notebook } from '@/core/notebooks';
import type { Recording } from '@/core/types';

import NotebooksScreen from '../notebooks';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockSetLastNotebookId = jest.fn(async () => undefined);
const mockSetNotebooksAlphabetical = jest.fn();
const mockCreateNotebook = jest.fn(async () => ({ id: 'nb-new', name: 'Novo' } as Notebook));
const mockRenameNotebook = jest.fn(async () => undefined);
const mockRemoveNotebook = jest.fn(async () => undefined);

jest.mock('expo-router', () => ({
  router: {
    canGoBack: jest.fn(() => false),
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/services/appNavigation', () => ({
  back: () => mockBack(),
  push: (...args: unknown[]) => mockPush(...args),
}));

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({
    lastNotebookId: undefined,
    setLastNotebookId: mockSetLastNotebookId,
    notebooksAlphabetical: false,
    setNotebooksAlphabetical: mockSetNotebooksAlphabetical,
  }),
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    notebooks: mockNotebooks,
    recordings: mockRecordings,
    createNotebook: mockCreateNotebook,
    renameNotebook: mockRenameNotebook,
    removeNotebook: mockRemoveNotebook,
    refresh: jest.fn(async () => undefined),
  }),
}));

let mockNotebooks: Notebook[] = [];
let mockRecordings: Recording[] = [];

function chapter(
  id: string,
  title: string,
  position: number,
  status: string,
  text = '',
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
    notebookId: 'nb-livro',
    chapterKind: 'chapter',
    chapterPosition: position,
    chapterStatus: status,
    text,
  };
}

function note(id: string, title: string, notebookId: string, text = ''): Recording {
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
    text,
  };
}

const NOTEBOOKS: Notebook[] = [
  {
    id: 'notas-ao-acaso',
    name: 'Notas ao acaso',
    color: '',
    isDefault: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  },
  {
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
  },
  {
    id: 'nb-comum',
    name: 'Trabalho',
    color: '#C7D8F2',
    isDefault: false,
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  },
];

describe('tela de cadernos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotebooks = NOTEBOOKS;
    mockRecordings = [
      note('note-1', 'Ideia de reunião', 'nb-comum', 'uma ideia de reunião'),
      chapter('ch-1', 'O mapa', 1, 'done', 'um dois três quatro cinco'),
      chapter('ch-2', 'A ponte', 2, 'revising', 'seis sete oito'),
      chapter('ch-3', 'Texto', 3, 'draft', ''),
    ];
  });

  it('mostra a seção Livros com capítulos, palavras e progresso', () => {
    render(<NotebooksScreen />);

    expect(screen.getByText('Livros')).toBeTruthy();
    expect(screen.getByTestId('book-name')).toHaveTextContent('O nome do vento');
    expect(screen.getByTestId('book-meta')).toHaveTextContent('3 capítulos · 8 palavras');
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('tocar no livro abre a superfície do livro', () => {
    render(<NotebooksScreen />);

    fireEvent.press(screen.getByLabelText('O nome do vento, 3 capítulos, 8 palavras'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/books/[id]',
      params: { id: 'nb-livro' },
    });
  });

  it('cadernos comuns continuam abrindo como antes', async () => {
    render(<NotebooksScreen />);

    fireEvent.press(screen.getByText('Trabalho'));
    expect(mockSetLastNotebookId).toHaveBeenCalledWith('nb-comum');
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('não conta livros no subtítulo nem na lista de cadernos', () => {
    render(<NotebooksScreen />);

    expect(screen.getByText('2 cadernos')).toBeTruthy();
    expect(screen.queryByText('3 cadernos')).toBeNull();
    expect(screen.queryAllByText('O nome do vento')).toHaveLength(1);
  });

  it('usa singular na contagem do livro', () => {
    mockRecordings = [chapter('ch-1', 'Único', 1, 'draft', 'palavra')];
    render(<NotebooksScreen />);

    expect(screen.getByTestId('book-meta')).toHaveTextContent('1 capítulo · 1 palavra');
  });

  it('não mostra a seção Livros quando não há livros', () => {
    mockNotebooks = NOTEBOOKS.filter((n) => n.kind !== 'book');
    mockRecordings = [];
    render(<NotebooksScreen />);

    expect(screen.queryByText('Livros')).toBeNull();
    expect(screen.queryByText('O nome do vento')).toBeNull();
  });
});
