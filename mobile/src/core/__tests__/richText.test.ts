import {
  breakSentences,
  countChars,
  countWords,
  extractImageUrls,
  markdownPreview,
  markdownToPlain,
} from '../richText';

describe('extractImageUrls', () => {
  it('extrai as URLs das imagens na ordem', () => {
    expect(extractImageUrls('a ![x](u1) b ![y](u2)')).toEqual(['u1', 'u2']);
  });

  it('devolve vazio quando nao ha imagem', () => {
    expect(extractImageUrls('so texto e [link](u)')).toEqual([]);
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

  it('nao conta a URL da imagem nem o codigo do markdown da foto', () => {
    expect(markdownToPlain('antes ![foto](attachment:abc) depois')).toBe('antes  depois');
    expect(countWords('antes ![foto](attachment:abc) depois')).toBe(2);
    expect(markdownToPlain('veja [a nota](note:abc)')).toBe('veja ');
    expect(markdownToPlain('veja [isso](https://exemplo.com/x)')).toBe('veja isso');
  });
});

describe('markdownPreview', () => {
  it('mostra o texto puro da nota', () => {
    expect(markdownPreview('**ola** mundo')).toBe('ola mundo');
    expect(markdownPreview('')).toBe('');
    expect(markdownPreview(undefined)).toBe('');
  });

  it('corta antes de converter: nao parseia a nota inteira', () => {
    const preview = markdownPreview(`${'palavra '.repeat(500)}fim`, 40);
    expect(preview.length).toBeLessThanOrEqual(40);
    expect(preview.startsWith('palavra')).toBe(true);
  });

  it('junta as linhas numa unica linha', () => {
    expect(markdownPreview('linha um\nlinha dois')).toBe('linha um linha dois');
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
