import type { ServerAnalysis } from '../api';
import { toNoteAnalysis } from '../analysis';

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
