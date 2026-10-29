import {
  readingLabel,
  serverLabel,
  stageLabel,
} from '../analysisStages';

describe('rotulos do andamento', () => {
  it('troca a frase a cada bloco e volta ao comeco', () => {
    const first = readingLabel(0);
    expect(readingLabel(1)).not.toBe(first);
    expect(readingLabel(0)).toBe(first);
    expect(readingLabel(7)).toBe(readingLabel(0));
    expect(readingLabel(-3)).toBe(first);
  });

  it('mostra o contador de blocos junto da frase', () => {
    expect(stageLabel({ stage: 'reading', read: 0, total: 0 })).toBe(readingLabel(0));
    expect(stageLabel({ stage: 'reading', read: 12, total: 34 })).toContain('12 de 34');
  });

  it('tem frase propria para fila, modelo e frase final', () => {
    expect(stageLabel({ stage: 'queued' })).toBe('Na fila...');
    expect(stageLabel({ stage: 'loading' })).toBe('Carregando modelo...');
    expect(stageLabel({ stage: 'sentence' })).toBe('Escrevendo a frase...');
  });

  it('o servidor avanca pelo tempo e para na ultima frase', () => {
    expect(serverLabel(0)).toBe('Enviado ao servidor...');
    expect(serverLabel(6_000)).not.toBe(serverLabel(0));
    expect(serverLabel(60_000)).toBe(serverLabel(120_000));
    expect(stageLabel({ stage: null, serverElapsedMs: 6_000 })).toBe(serverLabel(6_000));
  });
});
