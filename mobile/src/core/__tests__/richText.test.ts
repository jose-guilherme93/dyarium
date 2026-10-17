import {
  applyMarkdownFormat,
  breakSentences,
  countChars,
  countWords,
  extractImageUrls,
  findOpaqueBlocks,
  htmlToMarkdown,
  markdownToHtml,
  markdownToPlain,
  removeImageFromMarkdown,
  setImageWidthInMarkdown,
} from '../richText';

/** Ida e volta: markdown -> HTML do editor -> markdown. */
function roundTrip(markdown: string): string {
  return htmlToMarkdown(markdownToHtml(markdown));
}

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

  it('renderiza links como ancora e volta para markdown', () => {
    expect(markdownToHtml('veja [aqui](https://exemplo.test)')).toBe(
      '<div>veja <a href="https://exemplo.test">aqui</a></div>',
    );
    expect(htmlToMarkdown('<div><a href="https://exemplo.test">aqui</a></div>')).toBe(
      '[aqui](https://exemplo.test)',
    );
    expect(htmlToMarkdown(markdownToHtml('[a](https://x.test) [b](https://y.test)'))).toBe(
      '[a](https://x.test) [b](https://y.test)',
    );
  });

  it('renderiza imagem como bloco (paragrafo antes e depois) e volta para markdown', () => {
    expect(markdownToHtml('![foto](https://x.test/f.png)')).toBe(
      '<div><br></div><div class="img-block" contenteditable="false"><img src="https://x.test/f.png" data-src="https://x.test/f.png" alt="foto"></div><div><br></div>',
    );
    expect(htmlToMarkdown('<div><img src="https://x.test/f.png" alt="foto"></div>')).toBe(
      '![foto](https://x.test/f.png)',
    );
  });

  it('usa a fonte de exibicao (file:// local) e preserva a URL original', () => {
    const md = '![foto](attachment:abc)';
    const sources = { 'attachment:abc': 'file:///data/attachments/abc.png' };
    const html = markdownToHtml(md, sources);
    expect(html).toBe(
      '<div><br></div><div class="img-block" contenteditable="false"><img src="file:///data/attachments/abc.png" data-src="attachment:abc" alt="foto"></div><div><br></div>',
    );
    // Ao salvar, volta a referencia original (nao a fonte de exibicao).
    expect(htmlToMarkdown(html)).toBe(md);
  });

  it('preserva a largura e a ordem de varias imagens', () => {
    const md = '![a](attachment:1){w=40}\n![b](attachment:2)';
    const html = markdownToHtml(md);
    // sempre sobra paragrafo antes da primeira e depois da ultima imagem
    expect(html.startsWith('<div><br></div>')).toBe(true);
    expect(html.endsWith('<div><br></div>')).toBe(true);
    expect(html.indexOf('attachment:1')).toBeLessThan(html.indexOf('attachment:2'));
    expect(html).toContain('data-width="40"');
    expect(htmlToMarkdown(html)).toBe(md);
  });
});

describe('extractImageUrls', () => {
  it('extrai as URLs das imagens na ordem', () => {
    expect(extractImageUrls('a ![x](u1) b ![y](u2)')).toEqual(['u1', 'u2']);
  });

  it('devolve vazio quando nao ha imagem', () => {
    expect(extractImageUrls('so texto e [link](u)')).toEqual([]);
  });
});

describe('largura e remocao de imagem no markdown', () => {
  it('aplica e troca a largura de uma imagem', () => {
    expect(setImageWidthInMarkdown('![a](attachment:1)', 'attachment:1', 50)).toBe(
      '![a](attachment:1){w=50}',
    );
    expect(setImageWidthInMarkdown('![a](attachment:1){w=50}', 'attachment:1', 30)).toBe(
      '![a](attachment:1){w=30}',
    );
  });

  it('largura total remove o marcador', () => {
    expect(setImageWidthInMarkdown('![a](attachment:1){w=30}', 'attachment:1', 100)).toBe(
      '![a](attachment:1)',
    );
  });

  it('so mexe na imagem indicada', () => {
    const md = '![a](attachment:1)\n![b](attachment:2)';
    expect(setImageWidthInMarkdown(md, 'attachment:2', 30)).toBe(
      '![a](attachment:1)\n![b](attachment:2){w=30}',
    );
  });

  it('remove a imagem inteira, mantendo o resto', () => {
    const md = 'antes\n![a](attachment:1){w=50}\ndepois';
    expect(removeImageFromMarkdown(md, 'attachment:1')).toBe('antes\ndepois');
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

describe('countWords / countChars / markdownToPlain', () => {
  it('conta palavras ignorando marcadores', () => {
    expect(markdownToPlain('**ola** mundo _tudo_')).toBe('ola mundo tudo');
    expect(countWords('**ola** mundo _tudo_')).toBe(3);
    expect(countWords('   ')).toBe(0);
    expect(countWords('- a\n- b')).toBe(2);
  });

  it('conta caracteres do texto puro (com espacos)', () => {
    expect(countChars('**ola** mundo')).toBe(9);
    expect(countChars('')).toBe(0);
  });
});

describe('breakSentences', () => {
  it('quebra a linha a cada fim de frase', () => {
    expect(breakSentences('eu fiz. entao vamos la')).toBe('eu fiz.\nentao vamos la');
    expect(breakSentences('certo! vamos? sim.')).toBe('certo!\nvamos?\nsim.');
  });

  it('nao quebra numeros decimais', () => {
    expect(breakSentences('custa 3.5 reais')).toBe('custa 3.5 reais');
  });
});

describe('titulo, citacao e codigo', () => {
  it('titulo volta com os niveis', () => {
    expect(roundTrip('## Secao')).toBe('## Secao');
    expect(roundTrip('# Topo\n\ntexto')).toBe('# Topo\n\ntexto');
    expect(roundTrip('### Detalhe')).toBe('### Detalhe');
  });

  it('citacao volta com o prefixo', () => {
    expect(roundTrip('> uma citacao')).toBe('> uma citacao');
    expect(roundTrip('antes\n\n> cita\n\ndepois')).toBe('antes\n\n> cita\n\ndepois');
  });

  it('codigo volta com o fence e a indentacao', () => {
    expect(roundTrip('```\nlinha\n  indentada\n```')).toBe('```\nlinha\n  indentada\n```');
  });

  it('codigo com linguagem volta com a linguagem', () => {
    const html = markdownToHtml('```js\nconst a = 1;\n```');
    expect(html).toContain('data-lang="js"');
    expect(roundTrip('```js\nconst a = 1;\n```')).toBe('```js\nconst a = 1;\n```');
  });

  it('marcadores dentro de titulo e citacao sobrevivem', () => {
    expect(roundTrip('## **forte** e _suave_')).toBe('## **forte** e _suave_');
    expect(roundTrip('> **forte**')).toBe('> **forte**');
  });

  it('mistura o dia a dia continua igual depois da ida e volta', () => {
    const markdown = [
      '## Dia',
      '',
      'Texto com **negrito** e _italico_.',
      '',
      '- primeiro',
      '- segundo',
      '',
      '> uma citacao',
      '',
      '```',
      'codigo aqui',
      '```',
      '',
      '![foto](attachment:at_1){w=50}',
      '',
      'fim.',
      '',
    ].join('\n');
    // A linha em branco do fim e descartada ao salvar (o editor normaliza as
    // pontas); o resto volta identico.
    expect(roundTrip(markdown)).toBe(markdown.replace(/\n+$/, ''));
  });
});

describe('blocos opacos', () => {
  it('tabela e reconhecida e devolvida intacta', () => {
    const markdown = 'antes\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ndepois';
    expect(findOpaqueBlocks(markdown).map((found) => found.block.kind)).toEqual(['table']);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('tabela nao se mistura com o texto em volta', () => {
    const markdown = 'texto antes\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntexto depois';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('divisoria e devolvida intacta', () => {
    expect(roundTrip('antes\n\n---\n\ndepois')).toBe('antes\n\n---\n\ndepois');
  });

  it('mencao a outra nota e devolvida intacta, no meio da frase', () => {
    const markdown = 'olha [gravacao.webm](note:a6aaf781) e o resto';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('mencao a outra nota fica somente leitura e nao vira link', () => {
    const html = markdownToHtml('olha [gravacao.webm](note:abc) e o resto');
    expect(html).toContain('class="opaque-inline"');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('data-md="[gravacao.webm](note:abc)"');
    // Nao pode virar <a href="note:...">, que o toque tentaria abrir no sistema.
    expect(html).not.toContain('href="note:');
  });

  it('bloco opaco aparece somente leitura e carrega o markdown', () => {
    const html = markdownToHtml('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('class="opaque-block opaque-table"');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('data-md="');
  });

  it('salvar sem mexer no bloco devolve o markdown original', () => {
    const markdown = 'texto\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nmais texto';
    const html = markdownToHtml(markdown);
    // O editor reescreve o HTML como veio, sem tocar no bloco.
    expect(htmlToMarkdown(html)).toBe(markdown);
  });

  it('tabela com texto dentro das celulas continua legivel na previa', () => {
    const html = markdownToHtml('| nome | valor |\n| - | - |\n| cafe | 5,00 |');
    expect(html).toContain('tabela 2x2');
  });

  it('tabelas em bloco nao sao confundidas com texto', () => {
    // Linha com pipe no meio do texto nao e tabela.
    const markdown = 'use a | b para dividir';
    expect(findOpaqueBlocks(markdown)).toEqual([]);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('texto do bloco opaco nao entra na contagem de palavras', () => {
    expect(countWords('| nome | valor |\n| - | - |\n| cafe | 5,00 |')).toBe(0);
    expect(countWords('```\nvariavel = 1\n```')).toBe(0);
    expect(countWords('## Secao\n\nduas palavras')).toBe(3);
    expect(countWords('olha [nota](note:abc) e o resto')).toBe(4);
  });
});
