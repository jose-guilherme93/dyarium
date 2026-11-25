import { rowToNotebook, type NotebookRow } from '../notebooks';

jest.mock('../db', () => ({ getDatabase: jest.fn() }));

const ROW: NotebookRow = {
  id: 'nb_livro',
  name: 'O nome do vento',
  color: '#C7D8F2',
  is_default: 0,
  kind: 'book',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
  dirty: 0,
  synced: 1,
  deleted: 0,
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
  has_cover: 1,
  cover_updated_at: '2026-10-03T00:00:00Z',
};

describe('rowToNotebook', () => {
  it('mapeia as colunas do livro', () => {
    expect(rowToNotebook(ROW)).toEqual({
      id: 'nb_livro',
      name: 'O nome do vento',
      color: '#C7D8F2',
      isDefault: false,
      kind: 'book',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
      dirty: false,
      synced: true,
      subtitle: 'Volume I',
      author: 'Ana',
      synopsis: 'Um livro',
      language: 'pt-BR',
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
    });
  });

  it('usa padroes seguros numa linha antiga', () => {
    const antiga = { ...ROW } as Partial<NotebookRow>;
    delete antiga.subtitle;
    delete antiga.author;
    delete antiga.synopsis;
    delete antiga.language;
    delete antiga.goal_words;
    delete antiga.book_status;
    delete antiga.page_size;
    delete antiga.page_margin_mm;
    delete antiga.body_px;
    delete antiga.body_leading;
    delete antiga.body_font;
    delete antiga.daily_goal_words;
    delete antiga.deadline;
    delete antiga.has_cover;
    delete antiga.cover_updated_at;

    expect(rowToNotebook(antiga as NotebookRow)).toMatchObject({
      goalWords: 0,
      bookStatus: 'drafting',
      subtitle: '',
      pageSize: '',
      hasCover: false,
      coverUpdatedAt: '',
    });
  });
});

describe('mergeNotebookFromDrive', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDatabase } = require('../db') as { getDatabase: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mergeNotebookFromDrive } = require('../notebooks') as typeof import('../notebooks');

  it('grava o caderno do Drive com um valor por coluna e entra pendente de push', async () => {
    const runAsync = jest.fn(async () => undefined);
    getDatabase.mockResolvedValue({
      getFirstAsync: jest.fn(async () => null),
      runAsync,
    });

    await mergeNotebookFromDrive({
      id: 'nb_drive',
      name: 'Do Drive',
      color: '#C7D8F2',
      isDefault: false,
      kind: 'book',
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
      subtitle: 'Sub',
      goalWords: 1000,
      bookStatus: 'drafting',
    });

    const [sql, params] = runAsync.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toHaveLength((sql.match(/\?/g) ?? []).length);
    expect(params).toHaveLength(24);
    expect(params[22]).toBe(1);
    expect(params[23]).toBe(0);
  });

  it('caderno padrao novo entra sem pendencia', async () => {
    const runAsync = jest.fn(async () => undefined);
    getDatabase.mockResolvedValue({
      getFirstAsync: jest.fn(async () => null),
      runAsync,
    });

    await mergeNotebookFromDrive({
      id: 'notas-ao-acaso',
      name: 'Notas ao acaso',
      color: '',
      isDefault: true,
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
    });

    const [, params] = runAsync.mock.calls[0] as unknown as [string, unknown[]];
    expect(params[22]).toBe(0);
    expect(params[23]).toBe(0);
  });
});
