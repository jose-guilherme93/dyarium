import type { ServerAnalysis } from '../api';
import { simplifiedAnalysis, toNoteAnalysis, toServerAnalysis } from '../analysis';

function analysis(partial: Partial<ServerAnalysis>): ServerAnalysis {
  return {
    model: 'm',
    sentiment: 0,
    emotions: null,
    people: null,
    places: null,
    summary: '',
    ...partial,
  };
}

describe('toNoteAnalysis', () => {
  it('mapeia resumo, temas, emocoes, listas e sentimento para a ficha', () => {
    const view = toNoteAnalysis(
      analysis({
        sentiment: 0.4,
        sentiment_label: 'positivo',
        summary: '  Um dia tranquilo.  ',
        themes: [
          { name: ' família ', confidence: 0.9 },
          { name: '   ', confidence: 0.1 },
        ],
        emotions: { calma: 0.3, alegria: 0.8 },
        people: [' Ana ', ''],
        places: [' Praia '],
        questions: [' Volto amanha? '],
        decisions: [' Descansar '],
      }),
    );

    expect(view).not.toBeNull();
    expect(view?.summary).toBe('Um dia tranquilo.');
    expect(view?.themes).toEqual(['família']);
    expect(view?.emotions).toEqual([
      { name: 'alegria', intensity: 0.8 },
      { name: 'calma', intensity: 0.3 },
    ]);
    expect(view?.people).toEqual(['Ana']);
    expect(view?.places).toEqual(['Praia']);
    expect(view?.questions).toEqual(['Volto amanha?']);
    expect(view?.decisions).toEqual(['Descansar']);
    expect(view?.sentiment).toBe(0.4);
    expect(view?.sentimentLabel).toBe('positivo');
  });

  it('ignora emocoes invalidas e ordena pela intensidade', () => {
    const view = toNoteAnalysis(
      analysis({
        summary: 'resumo',
        emotions: { timidez: 0.2, entusiasmo: 0.9, ' ': 0.5 },
      }),
    );
    expect(view?.emotions).toEqual([
      { name: 'entusiasmo', intensity: 0.9 },
      { name: 'timidez', intensity: 0.2 },
    ]);
  });

  it('deduz o rotulo do sentimento quando o servidor nao manda um', () => {
    const view = toNoteAnalysis(analysis({ summary: 'resumo', sentiment: -0.8 }));
    expect(view?.sentimentLabel).toBe('negativo');
  });

  it('remove momentos sem texto e ignora analise sem conteudo', () => {
    const view = toNoteAnalysis(
      analysis({
        key_moments: [
          { start_ms: 1500, text: '  comecei a escrever  ' },
          { start_ms: 3000, text: '   ' },
        ],
      }),
    );
    expect(view?.moments).toEqual([{ startMs: 1500, text: 'comecei a escrever' }]);

    expect(toNoteAnalysis(analysis({ summary: '   ' }))).toBeNull();
    expect(toNoteAnalysis(null)).toBeNull();
  });
});

describe('toServerAnalysis', () => {
  it('converte o resultado local para o formato da ficha', () => {
    const analysis = toServerAnalysis(
      {
        sentiment: { score: 0.6, label: 'positivo' },
        emotions: [{ name: 'alegria', value: 0.9 }],
        themes: [{ name: 'trabalho', value: 0.7 }],
        people: [{ name: 'Ana' }],
        places: [{ name: 'Praia' }],
        events: [{ name: 'almoço', value: 0.5 }],
        reading: 'Um dia produtivo.',
      },
      'gemma-3-270m',
    );

    expect(analysis).toEqual({
      model: 'gemma-3-270m',
      sentiment: 0.6,
      sentiment_label: 'positivo',
      emotions: { alegria: 0.9 },
      people: ['Ana'],
      places: ['Praia'],
      summary: 'Um dia produtivo.',
      themes: [{ name: 'trabalho', confidence: 0.7 }],
      key_moments: null,
      questions: null,
      decisions: null,
    });
  });

  it('preserva listas vazias e nao inventa campos', () => {
    const analysis = toServerAnalysis(
      {
        sentiment: { score: 0, label: 'neutro' },
        emotions: [],
        themes: [],
        people: [],
        places: [],
        events: [],
        reading: '',
      },
      'm',
    );
    expect(analysis.emotions).toEqual({});
    expect(analysis.themes).toEqual([]);
    expect(analysis.people).toEqual([]);
    expect(analysis.places).toEqual([]);
  });
});

describe('simplifiedAnalysis', () => {
  it('estima tom positivo e negativo sem copiar a nota', () => {
    const positive = simplifiedAnalysis('Hoje foi um dia bom, fiquei feliz e tranquilo.');
    expect(positive.model).toBe('local-fallback');
    expect(positive.sentiment_label).toBe('positivo');
    expect(positive.summary).not.toContain('Hoje foi');

    const negative = simplifiedAnalysis('Dia dificil, fiquei triste e cansado.');
    expect(negative.sentiment_label).toBe('negativo');
  });

  it('devolve neutro quando nao ha palavras conhecidas', () => {
    const neutral = simplifiedAnalysis('A reuniao foi as tres horas.');
    expect(neutral.sentiment_label).toBe('neutro');
    expect(neutral.summary).toContain('Leitura simplificada');
  });
});

describe('garantia de leitura', () => {
  it('a leitura simplificada sempre passa na ficha, com ou sem texto', () => {
    for (const text of ['', 'texto curto', 'bom', 'ruim', 'A reuniao foi as tres horas.']) {
      expect(toNoteAnalysis(simplifiedAnalysis(text))).not.toBeNull();
    }
  });
});
