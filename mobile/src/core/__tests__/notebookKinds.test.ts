import { bookNotebookIds, noteNotebooks, type Notebook } from '../notebooks';

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

  it('trata caderno antigo sem kind como caderno comum', () => {
    const old = { ...notebook('antigo') };
    delete old.kind;
    expect(noteNotebooks([old]).map((item) => item.id)).toEqual(['antigo']);
    expect(bookNotebookIds([old]).size).toBe(0);
  });
});
