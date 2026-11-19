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
