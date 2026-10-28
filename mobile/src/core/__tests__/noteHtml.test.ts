import { htmlToMarkdown, markdownToHtml, noteImages } from '../noteHtml';

const images = {
  'local:a.jpg': 'file:///dados/a.jpg',
  'attachment:123': 'file:///cache/123.jpg',
};

const imageSrc = (ref: string) => images[ref as keyof typeof images] ?? ref;
const imageRef = (src: string) =>
  Object.entries(images).find(([, uri]) => uri === src)?.[0];

describe('markdownToHtml', () => {
  it('deixa a imagem no meio do paragrafo, no lugar em que ela esta', () => {
    const html = markdownToHtml('antes ![foto](local:a.jpg){w=50} depois', {
      imageSrc,
      width: 360,
      imageRatio: () => 4 / 3,
    });

    expect(html).toContain('antes <img');
    expect(html).toContain('depois');
    expect(html.indexOf('antes')).toBeLessThan(html.indexOf('<img'));
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('depois'));
    expect(html).toContain('width="180"');
  });

  it('converte enfase, listas, titulo, citacao e link', () => {
    const html = markdownToHtml(
      '# Titulo\n**negrito** e _italico_ e ~~riscado~~ e `codigo`\n- item\n1. um\n> citacao\n[site](https://exemplo.test)',
    );

    expect(html).toContain('<h1>Titulo</h1>');
    expect(html).toContain('<b>negrito</b>');
    expect(html).toContain('<i>italico</i>');
    expect(html).toContain('<s>riscado</s>');
    expect(html).toContain('<code>codigo</code>');
    expect(html).toContain('<ul><li>item</li></ul>');
    expect(html).toContain('<ol><li>um</li></ol>');
    expect(html).toContain('<blockquote><p>citacao</p></blockquote>');
    expect(html).toContain('<a href="https://exemplo.test">site</a>');
  });

  it('preserva bloco de codigo', () => {
    const html = markdownToHtml('```\nconst a = 1;\nconsole.log(a);\n```');
    expect(html).toContain('<codeblock>');
    expect(html).toContain('const a = 1;');
    expect(html).toContain('console.log(a);');
  });

  it('manda a largura da foto em pixels, proportional a largura do editor', () => {
    const html = markdownToHtml('![foto](local:a.jpg){w=50}', {
      imageSrc: () => 'file:///a.jpg',
      width: 360,
    });

    // O editor nativo precisa dos pixels: o componente de imagem nao entende
    // percentual. O percentual do documento volta na volta (`{w=50}`).
    expect(html).toContain('width="180"');
    expect(html).toContain('data-width="50"');
  });

  it('nota vazia nao inventa paragrafo', () => {
    expect(markdownToHtml('')).toBe('');
    expect(markdownToHtml('   \n')).toBe('');
  });

  it('fala o formato interno do editor, sem passar pelo normalizador', () => {
    // O editor rico reconhece `<html>...</html>` como o formato interno dele e
    // pula o normalizador (um parse de HTML5 completo) tanto no editor quanto
    // a cada medicao das previas. Fora desse formato, cada previa paga um
    // parse de HTML por medicao.
    const html = markdownToHtml('**negrito**');

    expect(html.startsWith('<html>')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
    expect(html).toContain('<p><b>negrito</b></p>');
  });
});

describe('ida e volta pelo editor', () => {
  it('volta ao markdown depois de passar pelo HTML do editor', () => {
    // O editor devolve o HTML no mesmo formato interno; a volta precisa
    // devolver exatamente o markdown.
    expect(htmlToMarkdown(markdownToHtml('**negrito** e `codigo`'))).toBe(
      '**negrito** e `codigo`',
    );
  });

  it('preserva a lista e o titulo', () => {
    const markdown = '# Titulo\n\n- item\n- outro';
    expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
  });

  it('preserva as linhas em branco entre os paragrafos', () => {
    // A linha em branco e um paragrafo vazio dentro do editor: e ela que
    // separa um paragrafo do outro no markdown.
    expect(htmlToMarkdown(markdownToHtml('A\n\nB'))).toBe('A\n\nB');
    expect(htmlToMarkdown(markdownToHtml('A\n\n\n\nB'))).toBe('A\n\n\n\nB');
  });

  it('le o HTML no formato interno do editor sem dobrar as linhas em branco', () => {
    // O editor nativo devolve o HTML com uma quebra de linha depois de cada
    // tag. Essa quebra e formatacao do HTML, nao texto: sem tira-la, cada
    // linha em branco do markdown voltava dobrada e o texto da nota crescia a
    // cada gravacao.
    expect(htmlToMarkdown('<html>\n<p>A</p>\n<br>\n<p>B</p>\n</html>')).toBe('A\n\nB');
    // As quebras que o usuario digitou no fim do texto continuam la.
    expect(htmlToMarkdown('<html>\n<p>A</p>\n<br>\n<br>\n</html>')).toBe('A\n\n');
  });
});

describe('htmlToMarkdown', () => {
  it('volta a imagem inline para a referencia salva e a largura', () => {
    const markdown = htmlToMarkdown(
      '<p>antes <img src="file:///dados/a.jpg" width="180" height="135"> depois</p>',
      { imageRef, imageAlt: () => 'foto', width: 360 },
    );

    expect(markdown).toBe('antes ![foto](local:a.jpg){w=50} depois');
  });

  it('nao empurra a imagem para o fim do texto', () => {
    const markdown = htmlToMarkdown(
      '<p>um <img src="file:///dados/a.jpg" width="180" height="135"> dois</p><p>tres</p>',
      { imageRef, imageAlt: () => 'foto', width: 360 },
    );

    expect(markdown).toBe('um ![foto](local:a.jpg){w=50} dois\ntres');
  });

  it('converte o HTML do editor de volta para markdown', () => {
    const markdown = htmlToMarkdown(
      '<h1>Titulo</h1><p><b>negrito</b> e <i>italico</i> e <s>riscado</s> e <code>codigo</code></p><ul><li>item</li></ul><ol><li>um</li></ol><blockquote><p>citacao</p></blockquote><p><a href="https://exemplo.test">site</a></p>',
    );

    expect(markdown).toContain('# Titulo');
    expect(markdown).toContain('**negrito** e _italico_ e ~~riscado~~ e `codigo`');
    expect(markdown).toContain('- item');
    expect(markdown).toContain('1. um');
    expect(markdown).toContain('> citacao');
    expect(markdown).toContain('[site](https://exemplo.test)');
  });

  it('preserva o bloco de codigo', () => {
    const markdown = htmlToMarkdown(
      '<codeblock><p>const a = 1;<br>console.log(a);</p></codeblock>',
    );
    expect(markdown).toBe('```\nconst a = 1;\nconsole.log(a);\n```');
  });

  it('nao transforma texto literal em formatacao na volta', () => {
    const markdown = htmlToMarkdown(
      '<p># nao e titulo</p><p>- nao e lista</p><p>2 * 3 e a_b</p><p>1. nao e lista</p>',
    );

    expect(markdown).toContain('\\# nao e titulo');
    expect(markdown).toContain('\\- nao e lista');
    expect(markdown).toContain('2 \\* 3');
    expect(markdown).toContain('\\_');
    expect(markdown).toContain('1\\. nao e lista');

    const html = markdownToHtml(markdown);
    expect(html).toContain('<p># nao e titulo</p>');
    expect(html).toContain('<p>- nao e lista</p>');
    expect(html).toContain('<p>2 * 3 e a_b</p>');
    expect(html).toContain('<p>1. nao e lista</p>');
  });

  it('nao escapa os marcadores que o proprio editor gerou', () => {
    const markdown = htmlToMarkdown('<h2>Titulo</h2><p><b>forte</b></p><p><i>leve</i></p>');
    expect(markdown).toContain('## Titulo');
    expect(markdown).toContain('**forte**');
    expect(markdown).toContain('_leve_');
  });

  it('mantem codigo inline literal', () => {
    const markdown = htmlToMarkdown('<p><code>a*b</code> e <code>c#d</code></p>');
    expect(markdown).toBe('`a*b` e `c#d`');
    expect(markdownToHtml(markdown)).toContain('<code>a*b</code>');
    expect(markdownToHtml(markdown)).toContain('<code>c#d</code>');
  });

  it('faz ida e volta sem perder texto nem imagem', () => {
    const source =
      'primeira linha\nsegunda com ![foto](attachment:123){w=40} no meio\n- item\n> citacao';
    const html = markdownToHtml(source, {
      imageSrc,
      width: 360,
      imageRatio: () => 4 / 3,
    });
    const back = htmlToMarkdown(html, { imageRef, imageAlt: () => 'foto', width: 360 });

    expect(back).toBe(source);
  });
});

describe('noteImages', () => {
  it('lista as imagens na ordem, com alt e largura', () => {
    expect(noteImages('a ![um](local:1.jpg) b ![dois](attachment:2){w=30}')).toEqual([
      { ref: 'local:1.jpg', alt: 'um', width: 100 },
      { ref: 'attachment:2', alt: 'dois', width: 30 },
    ]);
  });
});
