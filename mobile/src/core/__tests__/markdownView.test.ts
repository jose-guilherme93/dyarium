import { parseInline, parseMarkdownView } from '../markdownView';

describe('parseMarkdownView', () => {
  it('separa paragrafos, imagem e titulo', () => {
    const blocks = parseMarkdownView('primeira\n![foto](attachment:a1){w=50}\n## Titulo');
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      spans: [{ text: 'primeira' }],
    });
    expect(blocks[1]).toEqual({
      type: 'image',
      ref: 'attachment:a1',
      alt: 'foto',
      width: 50,
    });
    expect(blocks[2]).toMatchObject({ type: 'heading', level: 2 });
  });

  it('mantem linha vazia como bloco, igual ao editor', () => {
    const blocks = parseMarkdownView('um\n\ndois');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'blank', 'paragraph']);
  });

  it('le listas, citacao, codigo e divisoria', () => {
    const blocks = parseMarkdownView('- um\n1. dois\n> citacao\n```js\nx = 1\n```\n---');
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: true, marker: '1.' });
    expect(blocks[2]).toMatchObject({ type: 'quote' });
    expect(blocks[3]).toMatchObject({ type: 'code', lang: 'js', text: 'x = 1' });
    expect(blocks[4]).toEqual({ type: 'divider' });
  });
});

describe('parseInline', () => {
  it('reconhece negrito, italico, codigo e link', () => {
    expect(parseInline('**oi** _tudo_ `x` [site](https://a.b)')).toEqual([
      { text: 'oi', bold: true },
      { text: ' ' },
      { text: 'tudo', italic: true },
      { text: ' ' },
      { text: 'x', code: true },
      { text: ' ' },
      { text: 'site', link: 'https://a.b' },
    ]);
  });

  it('transforma mencao a nota em navegacao', () => {
    expect(parseInline('veja [outra](note:en1)')).toEqual([
      { text: 'veja ' },
      { text: 'outra', note: 'en1' },
    ]);
  });
});
