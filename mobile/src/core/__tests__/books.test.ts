import {
  bookPages,
  bookProgress,
  bookWords,
  chapterGroups,
  chapterNumber,
  formatWords,
  orderedChapters,
  pageCount,
  pageWindow,
} from '../books';
import type { Recording } from '../types';

function chapter(id: string, over: Partial<Recording> = {}): Recording {
  return {
    id,
    title: id,
    recordedAt: '2026-01-01T00:00:00Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('orderedChapters', () => {
  it('ordena pela posicao e desempata pela criacao', () => {
    const list = [
      chapter('c', { chapterPosition: 3 }),
      chapter('b', { chapterPosition: 1, createdAt: '2026-01-02T00:00:00Z' }),
      chapter('a', { chapterPosition: 1, createdAt: '2026-01-01T00:00:00Z' }),
      chapter('sem', {}),
    ];
    expect(orderedChapters(list).map((item) => item.id)).toEqual(['a', 'b', 'c', 'sem']);
  });
});

describe('chapterGroups', () => {
  it('abre um grupo na parte e mantem o que vem antes no grupo raiz', () => {
    const list = [
      chapter('c1', { chapterKind: 'chapter', chapterPosition: 1 }),
      chapter('p1', { chapterKind: 'part', chapterPosition: 2 }),
      chapter('c2', { chapterKind: 'chapter', chapterPosition: 3 }),
      chapter('c3', { chapterKind: 'chapter', chapterPosition: 4 }),
    ];
    expect(
      chapterGroups(list).map((group) => [
        group.part?.id ?? null,
        group.items.map((item) => item.id),
      ]),
    ).toEqual([
      [null, ['c1']],
      ['p1', ['c2', 'c3']],
    ]);
  });

  it('coloca capítulos sem parte num unico grupo raiz', () => {
    const list = [
      chapter('c2', { chapterKind: 'chapter', chapterPosition: 2 }),
      chapter('c1', { chapterKind: 'chapter', chapterPosition: 1 }),
    ];
    expect(chapterGroups(list)).toEqual([
      { part: null, items: [expect.objectContaining({ id: 'c1' }), expect.objectContaining({ id: 'c2' })] },
    ]);
  });
});

describe('chapterNumber', () => {
  it('conta so capitulos e pula as partes', () => {
    const list = [
      chapter('c1', { chapterKind: 'chapter', chapterPosition: 1 }),
      chapter('p1', { chapterKind: 'part', chapterPosition: 2 }),
      chapter('c2', { chapterKind: 'chapter', chapterPosition: 3 }),
      chapter('c3', { chapterKind: 'chapter', chapterPosition: 4 }),
    ];
    expect(chapterNumber(list, 'c1')).toBe(1);
    expect(chapterNumber(list, 'c2')).toBe(2);
    expect(chapterNumber(list, 'c3')).toBe(3);
    expect(chapterNumber(list, 'p1')).toBe(0);
    expect(chapterNumber(list, 'inexistente')).toBe(0);
  });
});

describe('bookWords', () => {
  it('soma a prosa ignorando as partes', () => {
    const list = [
      chapter('c1', { chapterKind: 'chapter', text: 'uma duas' }),
      chapter('p1', { chapterKind: 'part', text: 'ignorar estas palavras' }),
      chapter('c2', { chapterKind: 'chapter', text: 'tres quatro cinco' }),
    ];
    expect(bookWords(list)).toBe(5);
  });

  it('capitulo vazio nao soma nada', () => {
    expect(bookWords([chapter('c1', { chapterKind: 'chapter', text: '' })])).toBe(0);
    expect(bookWords([chapter('c1', { chapterKind: 'chapter' })])).toBe(0);
  });
});

describe('paginas e progresso', () => {
  it('estima paginas a 300 palavras por pagina', () => {
    expect(bookPages(0)).toBe(0);
    expect(bookPages(300)).toBe(1);
    expect(bookPages(301)).toBe(2);
    expect(bookPages(600)).toBe(2);
  });

  it('calcula o progresso entre 0 e 100', () => {
    expect(bookProgress(45000, 90000)).toBe(50);
    expect(bookProgress(0, 90000)).toBe(0);
    expect(bookProgress(120000, 90000)).toBe(100);
    expect(bookProgress(1000, 0)).toBe(0);
  });
});

describe('formatWords', () => {
  it('formata em pt-BR com separador de milhar', () => {
    expect(formatWords(17315)).toBe('17.315');
    expect(formatWords(0)).toBe('0');
    expect(formatWords(-4)).toBe('0');
  });
});

describe('pageWindow', () => {
  it('retorna altura que comporta N linhas inteiras', () => {
    const window = pageWindow(200, 20);
    expect(window.linesPerPage).toBe(10);
    expect(window.pageTextHeight).toBe(200);
  });

  it('arredonda para a linha mais proxima e descarta sobra', () => {
    const window = pageWindow(205, 20);
    expect(window.linesPerPage).toBe(10);
    expect(window.pageTextHeight).toBe(200);
  });

  it('retorna pelo menos uma linha quando a altura e menor que uma linha', () => {
    const window = pageWindow(10, 20);
    expect(window.linesPerPage).toBe(1);
    expect(window.pageTextHeight).toBe(20);
  });
});

describe('pageCount', () => {
  it('retorna 1 para altura zero ou vazia', () => {
    const window = pageWindow(200, 20);
    expect(pageCount(0, window)).toBe(1);
    expect(pageCount(-5, window)).toBe(1);
  });

  it('retorna N para multiplo exato da altura de pagina', () => {
    const window = pageWindow(200, 20);
    expect(pageCount(400, window)).toBe(2);
    expect(pageCount(600, window)).toBe(3);
  });

  it('arredonda para cima quando sobra texto', () => {
    const window = pageWindow(200, 20);
    expect(pageCount(401, window)).toBe(3);
    expect(pageCount(590, window)).toBe(3);
  });
});
