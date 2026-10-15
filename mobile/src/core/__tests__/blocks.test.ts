import { blocksToMarkdown, markdownToBlocks, parseInline } from '../blocks';

describe('parseInline', () => {
  it('marca negrito, italico e codigo', () => {
    expect(parseInline('a **b** _c_ `d`')).toEqual([
      { type: 'text', text: 'a ', styles: {} },
      { type: 'text', text: 'b', styles: { bold: true } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'c', styles: { italic: true } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'd', styles: { code: true } },
    ]);
  });

  it('converte link em conteudo inline', () => {
    expect(parseInline('veja [aqui](https://exemplo.test) agora')).toEqual([
      { type: 'text', text: 'veja ', styles: {} },
      { type: 'link', href: 'https://exemplo.test', content: [{ type: 'text', text: 'aqui', styles: {} }] },
      { type: 'text', text: ' agora', styles: {} },
    ]);
  });
});

describe('markdownToBlocks', () => {
  it('gera um parágrafo por linha', () => {
    expect(markdownToBlocks('um\n\ndois')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'um', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'dois', styles: {} }] },
    ]);
  });

  it('reconhece títulos pelo nível', () => {
    expect(markdownToBlocks('## Sub')).toEqual([
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Sub', styles: {} }] },
    ]);
  });

  it('reconhece listas, checklist, citação, imagem e código', () => {
    const blocks = markdownToBlocks(
      ['- a', '1. b', '- [x] feita', '- [ ] aberta', '> cito', '![alt](https://x/img.png)', '```js', 'const a = 1;', '```'].join('\n'),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'bulletListItem',
      'numberedListItem',
      'checkListItem',
      'checkListItem',
      'quote',
      'image',
      'codeBlock',
    ]);
    expect(blocks[2].props).toEqual({ checked: true });
    expect(blocks[3].props).toEqual({ checked: false });
    expect(blocks[5].props).toEqual({ url: 'https://x/img.png', caption: 'alt' });
    expect(blocks[6].props).toEqual({ language: 'js' });
    expect(blocks[6].content).toEqual([{ type: 'text', text: 'const a = 1;', styles: {} }]);
  });

  it('ignora linhas em branco e mantém documento vazio', () => {
    expect(markdownToBlocks('\n\n  \n')).toEqual([]);
  });
});

describe('blocksToMarkdown', () => {
  it('renderiza cada tipo de bloco', () => {
    const blocks = markdownToBlocks(
      ['# T', '- a', '1. b', '- [x] feita', '> cito', '![alt](https://x/img.png)', '```js', 'x', '```'].join('\n'),
    );
    expect(blocksToMarkdown(blocks)).toBe(
      ['# T', '- a', '1. b', '- [x] feita', '> cito', '![alt](https://x/img.png)', '```js', 'x', '```'].join('\n'),
    );
  });

  it('faz ida e volta estável no documento do app', () => {
    const markdown = [
      '# Diário',
      'Um **parágrafo** com _itálico_, `código` e um [link](https://exemplo.test).',
      '- item um',
      '- item dois',
      '> uma citação',
      '```',
      'linha de código',
      '```',
      '![foto](https://exemplo.test/foto.png)',
    ].join('\n');
    expect(blocksToMarkdown(markdownToBlocks(markdown))).toBe(markdown);
  });

  it('degrada blocos desconhecidos para o texto inline', () => {
    expect(
      blocksToMarkdown([{ type: 'audio', props: {}, content: [{ type: 'text', text: 'oi', styles: {} }] }]),
    ).toBe('oi');
  });
});
