import { markdownToTentapHtml, tentapHtmlToMarkdown } from '../tentapMarkdown';

function roundTrip(markdown: string, sources: Record<string, string> = {}): string {
  return tentapHtmlToMarkdown(markdownToTentapHtml(markdown, sources), sources);
}

describe('tentapMarkdown', () => {
  it('converte paragrafos com formatacao e link', () => {
    const md = '**negrito** _italico_ [link](https://x.test)';
    const html = markdownToTentapHtml(md);
    expect(html).toBe(
      '<p><strong>negrito</strong> <em>italico</em> <a href="https://x.test">link</a></p>',
    );
    expect(tentapHtmlToMarkdown(html)).toBe(md);
  });

  it('converte titulos e listas', () => {
    expect(roundTrip('# Titulo')).toBe('# Titulo');
    expect(roundTrip('- a\n- b')).toBe('- a\n- b');
    expect(roundTrip('1. a\n2. b')).toBe('1. a\n2. b');
  });

  it('quebra linha dentro do paragrafo sem criar paragrafo novo', () => {
    expect(markdownToTentapHtml('linha um\nlinha dois')).toBe(
      '<p>linha um<br>linha dois</p>',
    );
    expect(roundTrip('linha um\nlinha dois')).toBe('linha um\nlinha dois');
    expect(roundTrip('a\n\nb')).toBe('a\n\nb');
  });

  it('faz a ponte da imagem entre a referencia salva e o arquivo local', () => {
    const sources = { 'local:img.jpg': 'file:///nota/img.jpg' };
    const md = '![foto](local:img.jpg){w=50}';
    const html = markdownToTentapHtml(md, sources);
    expect(html).toBe('<img src="file:///nota/img.jpg" alt="foto" width="50%"><p></p>');
    expect(tentapHtmlToMarkdown(html, sources)).toBe(md);
  });

  it('preserva a mencao a outra nota como link', () => {
    const md = 'olha [Outra](note:abc)';
    expect(markdownToTentapHtml(md)).toBe('<p>olha <a href="note:abc">Outra</a></p>');
    expect(roundTrip(md)).toBe(md);
  });

  it('largura total nao guarda o marcador de largura', () => {
    expect(tentapHtmlToMarkdown('<img src="https://x/f.png" alt="f" width="100%">')).toBe(
      '![f](https://x/f.png)',
    );
  });

  it('preserva bloco de codigo como texto, com as cercas', () => {
    const md = '```js\nconst a = 1;\n```';
    expect(roundTrip(md)).toBe(md);
  });

  it('preserva tabela e divisoria como texto', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |';
    expect(roundTrip(table)).toBe(table);
    expect(roundTrip('---')).toBe('---');
  });

  it('nao interpreta asterisco dentro de codigo inline', () => {
    const md = 'use `a*b` aqui';
    expect(markdownToTentapHtml(md)).toBe('<p>use <code>a*b</code> aqui</p>');
    expect(roundTrip(md)).toBe(md);
  });

  it('converte riscado', () => {
    expect(roundTrip('~~riscado~~')).toBe('~~riscado~~');
  });

  it('nota vazia vira um paragrafo editavel', () => {
    expect(markdownToTentapHtml('')).toBe('<p></p>');
  });

  it('normaliza item de lista do TipTap (com <p> dentro)', () => {
    expect(tentapHtmlToMarkdown('<ul><li><p>a</p></li><li><p>b</p></li></ul>')).toBe(
      '- a\n- b',
    );
  });
});
