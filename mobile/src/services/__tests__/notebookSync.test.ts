import type { Notebook } from '@/core/notebooks';

import { pullNotebooks, pushNotebooks } from '../notebookSync';

const mockLoadConfig = jest.fn();
const mockListDirty = jest.fn();
const mockMarkSynced = jest.fn();
const mockPrune = jest.fn();
const mockRemoveRow = jest.fn();
const mockUpsertFromServer = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockList = jest.fn();

jest.mock('@/core/api', () => ({
  DyariumApi: jest.fn().mockImplementation(() => ({
    createNotebook: (...args: unknown[]) => mockCreate(...args),
    updateNotebook: (...args: unknown[]) => mockUpdate(...args),
    deleteNotebook: (...args: unknown[]) => mockDelete(...args),
    listNotebooks: (...args: unknown[]) => mockList(...args),
  })),
}));

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadConfig(),
}));

jest.mock('../notebooks', () => ({
  listDirtyNotebooks: () => mockListDirty(),
  markNotebookSynced: (...args: unknown[]) => mockMarkSynced(...args),
  pruneNotebooks: (...args: unknown[]) => mockPrune(...args),
  removeNotebookRow: (...args: unknown[]) => mockRemoveRow(...args),
  upsertNotebookFromServer: (...args: unknown[]) => mockUpsertFromServer(...args),
  notebookFromServer: jest.requireActual('../notebooks').notebookFromServer,
  notebookBookPayload: jest.requireActual('../notebooks').notebookBookPayload,
}));

function book(over: Partial<Notebook> = {}): Notebook {
  return {
    id: 'nb_livro',
    name: 'O nome do vento',
    color: '',
    isDefault: false,
    kind: 'book',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    dirty: true,
    synced: false,
    subtitle: '',
    author: 'Ana',
    synopsis: '',
    language: 'pt-BR',
    goalWords: 90000,
    bookStatus: 'drafting',
    pageSize: '14x21',
    pageMarginMm: 19,
    bodyPx: 18,
    bodyLeading: 160,
    bodyFont: 'newsreader',
    dailyGoalWords: 500,
    deadline: '',
    hasCover: false,
    coverUpdatedAt: '',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadConfig.mockResolvedValue({ baseUrl: 'https://diary.test', token: 't' });
  mockListDirty.mockResolvedValue([]);
  mockMarkSynced.mockResolvedValue(undefined);
  mockPrune.mockResolvedValue(undefined);
  mockRemoveRow.mockResolvedValue(undefined);
  mockUpsertFromServer.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue({ id: 'nb_livro' });
  mockUpdate.mockResolvedValue({ id: 'nb_livro' });
  mockDelete.mockResolvedValue(undefined);
  mockList.mockResolvedValue([]);
});

describe('push de cadernos', () => {
  it('leva kind e os metadados quando o caderno e livro', async () => {
    mockListDirty.mockResolvedValue([book()]);

    await pushNotebooks();

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'nb_livro',
        name: 'O nome do vento',
        color: '',
        kind: 'book',
        author: 'Ana',
        goal_words: 90000,
        page_size: '14x21',
        daily_goal_words: 500,
      }),
    );
    expect(mockMarkSynced).toHaveBeenCalledWith('nb_livro');
  });

  it('caderno comum continua subindo so nome e cor', async () => {
    mockListDirty.mockResolvedValue([book({ kind: 'notes', goalWords: 0, author: '' })]);

    await pushNotebooks();

    const body = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(body.name).toBe('O nome do vento');
    expect(body.color).toBe('');
    expect(body.kind).toBeUndefined();
    expect(body.goal_words).toBeUndefined();
  });
});

describe('pull de cadernos', () => {
  it('grava os metadados do livro vindos do servidor', async () => {
    mockList.mockResolvedValue([
      {
        id: 'nb_livro',
        name: 'O nome do vento',
        color: '#C7D8F2',
        is_default: false,
        kind: 'book',
        subtitle: 'Volume I',
        author: 'Ana',
        synopsis: 'Um livro',
        language: 'pt-BR',
        goal_words: 90000,
        book_status: 'revising',
        page_size: '14x21',
        page_margin_mm: 19,
        body_px: 18,
        body_leading: 160,
        body_font: 'newsreader',
        daily_goal_words: 500,
        deadline: '2026-12-01',
        has_cover: true,
        cover_updated_at: '2026-10-03T00:00:00Z',
        entry_count: 2,
        chapter_count: 2,
        words: 1200,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z',
      },
    ]);

    await pullNotebooks();

    expect(mockUpsertFromServer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'nb_livro',
        kind: 'book',
        subtitle: 'Volume I',
        author: 'Ana',
        goalWords: 90000,
        bookStatus: 'revising',
        pageSize: '14x21',
        pageMarginMm: 19,
        bodyPx: 18,
        bodyLeading: 160,
        bodyFont: 'newsreader',
        dailyGoalWords: 500,
        deadline: '2026-12-01',
        hasCover: true,
        coverUpdatedAt: '2026-10-03T00:00:00Z',
      }),
    );
    expect(mockPrune).toHaveBeenCalledWith(new Set(['nb_livro']));
  });
});
