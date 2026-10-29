import { toAnalysisText } from '../analysisText';

describe('toAnalysisText', () => {
  it('tira HTML e entidades, preservando a prosa e os paragrafos', () => {
    const input =
      '<div>Primeiro <b>paragrafo</b> com&nbsp;espaco.</div>' +
      '<div>Segundo &amp; ultimo&nbsp;paragrafo.</div>';
    expect(toAnalysisText(input)).toBe(
      'Primeiro paragrafo com espaco.\n\nSegundo & ultimo paragrafo.',
    );
  });

  it('descarta script, style e comentario sem deixar rastro', () => {
    const input =
      'Antes. <script>alert("lixo")</script><style>.a{color:red}</style><!-- nota --> Depois.';
    expect(toAnalysisText(input)).toBe('Antes. Depois.');
  });

  it('remove cerca de codigo inteira e mantem o texto ao redor', () => {
    const input = 'Antes.\n\n```ts\nconst x = 1;\nconsole.log(x);\n```\n\nDepois.';
    expect(toAnalysisText(input)).toBe('Antes.\n\nDepois.');
  });

  it('remove imagem, audio, link e URL nua', () => {
    const input =
      'Vi a foto ![praia](attachment:abc){w=50} e ouvi !audio[attachment:abc]{d=3.5}. ' +
      'Veja [a nota](note:abc) e [o site](https://exemplo.com/x). ' +
      'Link solto https://exemplo.com/y e www.exemplo.com.';
    expect(toAnalysisText(input)).toBe('Vi a foto e ouvi. Veja a nota e o site. Link solto e.');
  });

  it('tira marcadores de lista, titulo, citacao, enfase e carimbo de tempo', () => {
    const input = '# Titulo\n\n- item **forte**\n- item _leve_\n\n> citacao\n\n[00:12] fala';
    expect(toAnalysisText(input)).toBe('Titulo\n\nitem forte item leve\n\ncitacao\n\nfala');
  });

  it('remove emoji, invisiveis e caracteres de controle', () => {
    const input = 'Bom dia \u{1f600}\u200b! Tudo\u0007 bem\u00ad?';
    expect(toAnalysisText(input)).toBe('Bom dia! Tudo bem?');
  });

  it('descarta linha que so tem simbolo', () => {
    expect(toAnalysisText('Texto.\n---\n***\nOutro texto.')).toBe('Texto.\n\nOutro texto.');
  });

  it('normaliza espaco e e idempotente', () => {
    const once = toAnalysisText('  Um   texto\tcom   espacos.  \n\n\nOutro.  ');
    expect(once).toBe('Um texto com espacos.\n\nOutro.');
    expect(toAnalysisText(once)).toBe(once);
  });

  it('mantem acentos e pontuacao de frase', () => {
    expect(toAnalysisText('Ela disse: "não vou, não!" — e saiu.')).toBe(
      'Ela disse: "não vou, não!" — e saiu.',
    );
  });

  it('devolve vazio para texto que so tem ruido', () => {
    expect(toAnalysisText('<div><script>x()</script></div>')).toBe('');
    expect(toAnalysisText('   ')).toBe('');
    expect(toAnalysisText('')).toBe('');
  });
});
