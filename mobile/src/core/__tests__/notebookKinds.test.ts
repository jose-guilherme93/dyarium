import {
  bookNotebookIds,
  bookNotebooks,
  noteNotebooks,
  sameNotebooks,
  type Notebook,
} from '../notebooks';

function notebook(id: string, kind: 'notes' | 'book' = 'notes'): Notebook {
  return {
    id,
    name: id,
    color: '',
    isDefault: false,
    kind,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

describe('livros no app', () => {
  it('esconde livros da lista visivel e expoe os ids para as metricas', () => {
    const all = [notebook('diario'), notebook('livro', 'book'), notebook('trabalho')];
    expect(noteNotebooks(all).map((item) => item.id)).toEqual(['diario', 'trabalho']);
    expect([...bookNotebookIds(all)]).toEqual(['livro']);
  });

  it('separa os livros vivos para a tela de livros', () => {
    const all = [notebook('diario'), notebook('livro', 'book'), notebook('trabalho')];
    expect(bookNotebooks(all).map((item) => item.id)).toEqual(['livro']);
    expect(noteNotebooks(all).map((item) => item.id)).toEqual(['diario', 'trabalho']);
  });

  it('trata caderno antigo sem kind como caderno comum', () => {
    const old = { ...notebook('antigo') };
    delete old.kind;
    expect(noteNotebooks([old]).map((item) => item.id)).toEqual(['antigo']);
    expect(bookNotebookIds([old]).size).toBe(0);
    expect(bookNotebooks([old])).toEqual([]);
  });
});

describe('sameNotebooks e os metadados do livro', () => {
  it('detecta mudanca de meta e de autor', () => {
    const book: Notebook = { ...notebook('livro', 'book'), goalWords: 90000, author: 'Ana' };
    expect(sameNotebooks([book], [{ ...book }])).toBe(true);
    expect(sameNotebooks([book], [{ ...book, goalWords: 95000 }])).toBe(false);
    expect(sameNotebooks([book], [{ ...book, author: 'Bia' }])).toBe(false);
  });

  it('mantem iguais os cadernos que nao trazem os campos', () => {
    const plain = notebook('diario');
    expect(sameNotebooks([plain], [{ ...plain }])).toBe(true);
    expect(
      sameNotebooks(
        [plain],
        [{ ...plain, goalWords: 0, author: '', bookStatus: 'drafting', hasCover: false }],
      ),
    ).toBe(true);
  });
});
