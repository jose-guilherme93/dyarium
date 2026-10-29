import type { ServerAnalysis } from '../api';
import { simplifiedAnalysis, toNoteAnalysis, toServerAnalysis } from '../analysis';
import type { ComposedAnalysis } from '../analysisCompose';

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

function composed(partial: Partial<ComposedAnalysis> = {}): ComposedAnalysis {
  return {
    contractVersion: 2,
    model: 'qwen3-0.6b',
    models: ['qwen3-0.6b'],
    tone: 40,
    toneLabel: 'positivo',
    sentence: 'Uma despedida anunciada, sobre Ana.',
    sentenceSource: 'model',
    people: [
      {
        name: 'Ana',
        mentions: 3,
        blocks: 2,
        tone: -20,
        firstMs: 1000,
        lastMs: 4000,
      },
    ],
    places: [{ name: 'Praia', mentions: 1, blocks: 1, firstMs: 1200, lastMs: 1800 }],
    emotions: [{ name: 'saudade', blocks: 2, share: 0.5, tone: -20 }],
    themes: [{ name: 'familia', blocks: 2 }],
    events: [{ name: 'enterro da Ana', blocks: 1, startMs: 1000 }],
    decisions: [{ text: 'vou viajar em julho', blocks: 1, startMs: 2000 }],
    tasks: [{ text: 'comprar a passagem', blocks: 1, startMs: null }],
    ideas: [{ text: 'escrever sobre despedidas', blocks: 1, startMs: null }],
    epiphanies: [{ text: 'nunca falei o que eu sentia', blocks: 1, startMs: null }],
    moments: [{ text: 'ela dormindo no sofa', startMs: 1200, blockIndex: 0, salience: 70 }],
    blocksRead: 4,
    blocksTotal: 5,
    charsRead: 900,
    charsTotal: 1200,
    audioCoveredMs: 8000,
    audioTotalMs: 10000,
    complete: false,
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
        tasks: [' Pagar a conta '],
        ideas: [' Escrever um livro '],
        events: [' Enterro da Ana '],
        epiphanies: [' Nunca falei o que sentia '],
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
    expect(view?.peopleDetail).toEqual([{ name: 'Ana', count: 1 }]);
    expect(view?.places).toEqual(['Praia']);
    expect(view?.placesDetail).toEqual([{ name: 'Praia', count: 1 }]);
    expect(view?.questions).toEqual(['Volto amanha?']);
    expect(view?.decisions).toEqual(['Descansar']);
    expect(view?.tasks).toEqual(['Pagar a conta']);
    expect(view?.ideas).toEqual(['Escrever um livro']);
    expect(view?.events).toEqual(['Enterro da Ana']);
    expect(view?.epiphanies).toEqual(['Nunca falei o que sentia']);
    expect(view?.sentiment).toBe(0.4);
    expect(view?.sentimentLabel).toBe('positivo');
  });

  it('mostra a contagem de mencoes quando a analise informa', () => {
    const view = toNoteAnalysis(
      analysis({
        summary: 'resumo',
        people: ['Ana', 'Bia'],
        people_detail: [
          { name: 'Ana', count: 3 },
          { name: 'Bia', count: 1 },
        ],
        places: ['Praia'],
        places_detail: [{ name: 'Praia', count: 2 }],
      }),
    );
    expect(view?.peopleDetail).toEqual([
      { name: 'Ana', count: 3 },
      { name: 'Bia', count: 1 },
    ]);
    expect(view?.placesDetail).toEqual([{ name: 'Praia', count: 2 }]);
  });

  it('leva a cobertura e o estado parcial para a ficha', () => {
    const view = toNoteAnalysis(
      analysis({
        summary: 'resumo',
        schema_version: 2,
        sentence_source: 'derived',
        coverage: {
          blocks_read: 3,
          blocks_total: 8,
          chars_read: 500,
          chars_total: 1400,
          audio_ms: 12000,
          partial: true,
        },
      }),
    );
    expect(view?.coverage).toEqual({
      blocksRead: 3,
      blocksTotal: 8,
      charsRead: 500,
      charsTotal: 1400,
      audioMs: 12000,
      partial: true,
    });
    expect(view?.contractVersion).toBe(2);
    expect(view?.sentenceSource).toBe('derived');
  });

  it('marca parcial quando falta bloco, mesmo sem o booleano', () => {
    const view = toNoteAnalysis(
      analysis({
        summary: 'resumo',
        coverage: { blocks_read: 1, blocks_total: 4 },
      }),
    );
    expect(view?.coverage?.partial).toBe(true);
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

  it('leva a leitura e as secoes do servidor para a ficha', () => {
    const view = toNoteAnalysis(
      analysis({
        summary: 'resumo curto',
        reading: '  O dia girou em torno do trabalho e da familia.  ',
        sections: [
          {
            heading: '  Trabalho  ',
            kind: 'text',
            reading: ' Pressao no trabalho. ',
            summary: '',
            sentiment: { score: -0.3, label: 'negativo' },
          },
          { heading: '', kind: 'transcript', reading: 'A fala revela cansaco.', summary: '' },
        ],
      }),
    );
    expect(view?.reading).toBe('O dia girou em torno do trabalho e da familia.');
    expect(view?.sections).toEqual([
      {
        heading: 'Trabalho',
        kind: 'text',
        reading: 'Pressao no trabalho.',
        summary: '',
        sentimentLabel: 'negativo',
      },
      {
        heading: '',
        kind: 'transcript',
        reading: 'A fala revela cansaco.',
        summary: '',
        sentimentLabel: '',
      },
    ]);
  });

  it('nao descarta uma analise que so tem leitura', () => {
    const view = toNoteAnalysis(analysis({ reading: 'So a leitura.', summary: '' }));
    expect(view?.reading).toBe('So a leitura.');
    expect(view?.summary).toBe('');
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
  it('converte o documento composto no formato da ficha e do servidor', () => {
    const result = toServerAnalysis(composed(), 'qwen3-0.6b', {
      comprehension: 72,
      comprehensionSource: 'review',
      stutterRate: 1.5,
      hesitationRate: 0.5,
      revisedSegments: 3,
    });

    expect(result.model).toBe('qwen3-0.6b');
    expect(result.origin).toBe('app');
    expect(result.schema_version).toBe(2);
    expect(result.sentiment).toBe(0.4);
    expect(result.sentiment_label).toBe('positivo');
    expect(result.emotions).toEqual({ saudade: 0.5 });
    expect(result.people).toEqual(['Ana']);
    expect(result.people_detail).toEqual([{ name: 'Ana', count: 3, sentiment: -0.2 }]);
    expect(result.places).toEqual(['Praia']);
    expect(result.places_detail).toEqual([{ name: 'Praia', count: 1 }]);
    expect(result.summary).toBe('Uma despedida anunciada, sobre Ana.');
    expect(result.sentence_source).toBe('model');
    expect(result.themes).toEqual([{ name: 'familia', confidence: 0.5 }]);
    expect(result.key_moments).toEqual([{ start_ms: 1200, text: 'ela dormindo no sofa' }]);
    expect(result.decisions).toEqual(['vou viajar em julho']);
    expect(result.tasks).toEqual(['comprar a passagem']);
    expect(result.ideas).toEqual(['escrever sobre despedidas']);
    expect(result.events).toEqual(['enterro da Ana']);
    expect(result.epiphanies).toEqual(['nunca falei o que eu sentia']);
    expect(result.comprehension).toBe(72);
    expect(result.comprehension_source).toBe('review');
    expect(result.stutter_rate).toBe(1.5);
    expect(result.hesitation_rate).toBe(0.5);
    expect(result.coverage).toEqual({
      blocks_read: 4,
      blocks_total: 5,
      chars_read: 900,
      chars_total: 1200,
      audio_ms: 8000,
      partial: true,
    });
  });

  it('nao envia momento de bloco escrito (sem tempo real)', () => {
    const result = toServerAnalysis(
      composed({
        moments: [{ text: 'o silencio da casa', startMs: null, blockIndex: 2, salience: 10 }],
      }),
      'm',
    );
    expect(result.key_moments).toEqual([]);
  });

  it('preserva listas vazias e nao inventa campos', () => {
    const result = toServerAnalysis(
      composed({
        tone: 0,
        toneLabel: 'neutro',
        sentence: '',
        people: [],
        places: [],
        emotions: [],
        themes: [],
        events: [],
        decisions: [],
        tasks: [],
        ideas: [],
        epiphanies: [],
        moments: [],
        blocksRead: 0,
        blocksTotal: 0,
        charsRead: 0,
        charsTotal: 0,
        audioCoveredMs: 0,
        audioTotalMs: 0,
        complete: false,
      }),
      'm',
    );
    expect(result.emotions).toEqual({});
    expect(result.themes).toEqual([]);
    expect(result.people).toEqual([]);
    expect(result.people_detail).toEqual([]);
    expect(result.comprehension).toBe(-1);
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
    expect(neutral.coverage).toBeNull();
  });
});
