import {
  applyMarkdownFormat,
  countWords,
  htmlToMarkdown,
  markdownToHtml,
  markdownToPlain,
} from '../richText';

describe('markdownToHtml', () => {
  it('converte negrito, italico e lista', () => {
    expect(markdownToHtml('**oi**')).toBe('<div><b>oi</b></div>');
    expect(markdownToHtml('_oi_')).toBe('<div><i>oi</i></div>');
    expect(markdownToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownToHtml('a\n\nb')).toBe('<div>a</div><div><br></div><div>b</div>');
  });

  it('escapa HTML do usuario', () => {
    expect(markdownToHtml('<b>x</b>')).toBe('<div>&lt;b&gt;x&lt;/b&gt;</div>');
  });
});

describe('htmlToMarkdown', () => {
  it('converte de volta para markdown', () => {
    expect(htmlToMarkdown('<div><b>oi</b></div>')).toBe('**oi**');
    expect(htmlToMarkdown('<div><i>oi</i></div>')).toBe('_oi_');
    expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b');
    expect(htmlToMarkdown('<div>a</div><div>b</div>')).toBe('a\nb');
  });

  it('faz round-trip de markdown simples', () => {
    for (const md of ['**negrito**', '_italico_', 'linha um\nlinha dois', '- a\n- b']) {
      expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
    }
  });
});

describe('applyMarkdownFormat', () => {
  it('envolve a selecao em negrito e mantem a selecao', () => {
    const result = applyMarkdownFormat('texto aqui', { start: 0, end: 5 }, 'bold');
    expect(result.text).toBe('**texto** aqui');
    expect(result.selection).toEqual({ start: 2, end: 7 });
  });

  it('usa um placeholder quando nao ha selecao', () => {
    const result = applyMarkdownFormat('', { start: 0, end: 0 }, 'bold');
    expect(result.text).toBe('**texto**');
  });

  it('aplica italico', () => {
    const result = applyMarkdownFormat('abc', { start: 0, end: 3 }, 'italic');
    expect(result.text).toBe('_abc_');
  });

  it('prefixa a linha com marcador de lista', () => {
    const result = applyMarkdownFormat('linha', { start: 0, end: 0 }, 'list');
    expect(result.text).toBe('- linha');
    expect(result.selection).toEqual({ start: 2, end: 2 });
  });

  it('aplica lista na linha do meio', () => {
    const text = 'um\ndois\ntres';
    const result = applyMarkdownFormat(text, { start: 4, end: 4 }, 'list');
    expect(result.text).toBe('um\n- dois\ntres');
  });
});

describe('countWords / markdownToPlain', () => {
  it('conta palavras ignorando marcadores', () => {
    expect(markdownToPlain('**ola** mundo _tudo_')).toBe('ola mundo tudo');
    expect(countWords('**ola** mundo _tudo_')).toBe(3);
    expect(countWords('   ')).toBe(0);
    expect(countWords('- a\n- b')).toBe(2);
  });
});
