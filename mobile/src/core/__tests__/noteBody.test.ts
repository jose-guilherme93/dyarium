import { joinNoteBody, splitNoteBody } from '../noteBody';

describe('splitNoteBody', () => {
  it('separa texto e imagens', () => {
    const blocks = splitNoteBody('antes\n![foto](local:a.jpg)\ndepois');
    expect(blocks).toEqual([
      { kind: 'text', id: 'b0', markdown: 'antes' },
      { kind: 'image', id: 'b1', ref: 'local:a.jpg', alt: 'foto', width: undefined },
      { kind: 'text', id: 'b2', markdown: 'depois' },
    ]);
  });

  it('guarda a largura da imagem', () => {
    const blocks = splitNoteBody('![foto](local:a.jpg){w=40}');
    expect(blocks[0]).toEqual({
      kind: 'image',
      id: 'b0',
      ref: 'local:a.jpg',
      alt: 'foto',
      width: 40,
    });
  });

  it('agrupa linhas de texto em um bloco so', () => {
    const blocks = splitNoteBody('um\ndois\n\ntres');
    expect(blocks).toEqual([{ kind: 'text', id: 'b0', markdown: 'um\ndois\n\ntres' }]);
  });

  it('nota vazia vira um bloco de texto vazio (lugar para digitar)', () => {
    expect(splitNoteBody('')).toEqual([{ kind: 'text', id: 'b0', markdown: '' }]);
  });

  it('tabela e divisoria viram bloco que o app nao edita', () => {
    const blocks = splitNoteBody('antes\n| a | b |\n| - | - |\ndepois');
    expect(blocks[1]).toEqual({
      kind: 'opaque',
      id: 'b1',
      markdown: '| a | b |\n| - | - |',
      label: 'tabela 2x2',
    });

    const divider = splitNoteBody('antes\n\n---\n\ndepois');
    expect(divider[1]).toEqual({
      kind: 'opaque',
      id: 'b1',
      markdown: '---',
      label: 'divisoria',
    });
  });
});

describe('joinNoteBody', () => {
  it('devolve o markdown original', () => {
    const markdown = 'antes\n![foto](local:a.jpg){w=40}\ndepois';
    expect(joinNoteBody(splitNoteBody(markdown))).toBe(markdown);
  });

  it('preserva linhas em branco ao redor da imagem', () => {
    const markdown = 'antes\n\n![foto](local:a.jpg)\n\ndepois';
    expect(joinNoteBody(splitNoteBody(markdown))).toBe(markdown);
  });

  it('remove a largura quando a imagem ocupa a nota toda', () => {
    const blocks = [
      { kind: 'image', id: 'b0', ref: 'local:a.jpg', alt: 'foto', width: 100 } as const,
    ];
    expect(joinNoteBody(blocks)).toBe('![foto](local:a.jpg)');
  });

  it('preserva a tabela e a divisoria ao juntar', () => {
    const markdown = 'antes\n| a | b |\n| - | - |\n| 1 | 2 |\n\ndepois';
    expect(joinNoteBody(splitNoteBody(markdown))).toBe(markdown);
  });
});
