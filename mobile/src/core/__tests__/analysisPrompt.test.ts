import {
  analysisContentHash,
  closeJsonPartial,
  foldText,
  parseJsonLoose,
  parseJsonObject,
  readingRepeatsInput,
} from '../analysisPrompt';

describe('analysisContentHash', () => {
  it('muda quando o texto, o titulo ou a transcricao mudam', () => {
    const base = analysisContentHash({ title: 'Nota', text: 'texto', transcript: 'audio' });
    expect(analysisContentHash({ title: 'Nota', text: 'texto', transcript: 'audio' })).toBe(base);
    expect(analysisContentHash({ title: 'Outra', text: 'texto', transcript: 'audio' })).not.toBe(base);
    expect(analysisContentHash({ title: 'Nota', text: 'texto novo', transcript: 'audio' })).not.toBe(base);
    expect(analysisContentHash({ title: 'Nota', text: 'texto', transcript: 'outro' })).not.toBe(base);
  });

  it('ignora markdown, acento e espacos redundantes', () => {
    expect(analysisContentHash({ title: 'Nota', text: '  um   **texto**  ' })).toBe(
      analysisContentHash({ title: 'Nota', text: 'um texto' }),
    );
    expect(analysisContentHash({ title: 'Nota', text: 'café' })).toBe(
      analysisContentHash({ title: 'Nota', text: 'cafe' }),
    );
  });
});

describe('foldText', () => {
  it('tira acento, caixa e pontuacao', () => {
    expect(foldText('  Olá, Mundo! ')).toBe('ola mundo');
  });
});

describe('JSON tolerante', () => {
  it('fecha objeto e string cortados no limite de tokens', () => {
    const partial = '{"tom": -30, "pessoas": [{"nome": "Ana"}], "momentos": ["ela dor';
    expect(closeJsonPartial(partial)).toMatch(/\]\}$/);
    expect(parseJsonLoose(partial)).toEqual({
      tom: -30,
      pessoas: [{ nome: 'Ana' }],
      momentos: ['ela dor'],
    });
  });

  it('le JSON cercado por markdown e com texto depois', () => {
    const raw = '```json\n{"tom": 10}\n```\nPronto.';
    expect(parseJsonObject(raw)).toEqual({ tom: 10 });
  });

  it('devolve null quando nao ha objeto', () => {
    expect(parseJsonObject('nao sei')).toBeNull();
    expect(parseJsonObject('[1,2]')).toBeNull();
  });
});

describe('readingRepeatsInput', () => {
  const input = 'Hoje acordei cansado, fui caminhar no parque e voltei melhor.';

  it('reconhece copia e quase copia', () => {
    expect(readingRepeatsInput(input, input)).toBe(true);
    expect(readingRepeatsInput(input.replace('melhor', 'bem'), input)).toBe(true);
  });

  it('aceita interpretacao', () => {
    expect(readingRepeatsInput('Um dia que comeca cansado e melhora no fim.', input)).toBe(false);
  });
});
