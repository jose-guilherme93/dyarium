import type { Recording } from '../types';
import { analyzeWriting, monthlySeries, plainText, weekdayHourGrid, writingHistory } from '../writing';

function base(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'Nota',
    recordedAt: '2026-10-10T12:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    ...overrides,
  };
}

const norm = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('plainText', () => {
  it('tira markdown e mantem as palavras (links viram rotulo)', () => {
    expect(norm(plainText('**oi** _mundo_'))).toBe('oi mundo');
    expect(norm(plainText('veja [aqui](https://x)'))).toBe('veja aqui');
    expect(norm(plainText('![foto](local:a.jpg) depois'))).toBe('depois');
    expect(norm(plainText('- item\n- outro'))).toBe('item outro');
  });
});

describe('analyzeWriting', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');

  it('conta palavras, frases, unicas e a palavra mais usada', () => {
    const metrics = analyzeWriting(
      [base({ text: 'O projeto cresceu. O projeto vai bem! Você viu?' })],
      now,
    );
    expect(metrics.withText).toBe(1);
    expect(metrics.words).toBe(9);
    expect(metrics.sentences).toBe(3);
    expect(metrics.questions).toBe(1);
    expect(metrics.exclamations).toBe(1);
    expect(metrics.topWords[0]).toEqual({ label: 'projeto', value: 2 });
    expect(metrics.longestNote?.words).toBe(9);
    expect(metrics.lexicalRichness).toBeGreaterThan(0);
  });

  it('conta imagens, links e listas', () => {
    const metrics = analyzeWriting(
      [base({ text: 'veja ![foto](local:a.jpg) e [aqui](https://x)!\n- item' })],
      now,
    );
    expect(metrics.images).toBe(1);
    expect(metrics.links).toBe(1);
    expect(metrics.listItems).toBe(1);
    // um "!" e da exclamação; o outro e da imagem (nao conta)
    expect(metrics.exclamations).toBe(1);
  });

  it('separa escrita de transcricao', () => {
    const metrics = analyzeWriting(
      [base({ text: 'duas palavras', transcript: 'uma fala bem maior aqui', filePath: 'file://a' })],
      now,
    );
    expect(metrics.withAudio).toBe(1);
    expect(metrics.withText).toBe(1);
    expect(metrics.withTranscript).toBe(1);
    expect(metrics.words).toBe(2);
    expect(metrics.transcriptWords).toBe(5);
    expect(metrics.averageTranscriptWords).toBe(5);
  });

  it('calcula dias ativos e sequencia', () => {
    const metrics = analyzeWriting(
      [
        base({ id: 'a', recordedAt: '2026-10-01T12:00:00.000Z' }),
        base({ id: 'b', recordedAt: '2026-10-02T12:00:00.000Z' }),
        base({ id: 'c', recordedAt: '2026-10-03T12:00:00.000Z' }),
        base({ id: 'd', recordedAt: '2026-10-05T12:00:00.000Z' }),
      ],
      new Date('2026-10-05T18:00:00.000Z'),
    );
    expect(metrics.activeDays).toBe(4);
    expect(metrics.longestStreak).toBe(3);
    expect(metrics.currentStreak).toBe(1);
  });

  it('nao quebra sem dados', () => {
    const metrics = analyzeWriting([], now);
    expect(metrics.notes).toBe(0);
    expect(metrics.words).toBe(0);
    expect(metrics.topWords).toEqual([]);
    expect(metrics.insights).toEqual([]);
    expect(metrics.topWeekday).toBeNull();
  });

  it('gera insights sobre a escrita', () => {
    const metrics = analyzeWriting(
      [base({ text: 'escrevi bastante sobre o projeto hoje mesmo' })],
      now,
    );
    expect(metrics.insights.length).toBeGreaterThan(0);
    expect(metrics.insights[0]).toContain('palavras');
  });
});

describe('writingHistory', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');

  it('monta a serie semanal e o calendario', () => {
    const history = writingHistory(
      [
        base({ id: 'a', recordedAt: '2026-10-06T12:00:00.000Z', text: 'duas palavras' }),
        base({ id: 'b', recordedAt: '2026-10-12T12:00:00.000Z', text: 'mais duas' }),
      ],
      now,
      2,
    );
    expect(history.weekly).toHaveLength(2);
    expect(history.calendar).toHaveLength(2);
    expect(history.calendar.every((column) => column.length === 7)).toBe(true);
    expect(history.weekly.reduce((sum, week) => sum + week.words, 0)).toBe(4);
    expect(history.maxDaily).toBe(2);
    expect(history.maxWeekly).toBe(2);
    // a semana atual tem dias futuros (sem chave)
    expect(history.calendar[1].some((cell) => cell.key === null)).toBe(true);
  });

  it('sem notas, tudo zerado e com dias futuros', () => {
    const history = writingHistory([], now, 1);
    expect(history.maxWeekly).toBe(0);
    expect(history.maxDaily).toBe(0);
    expect(history.weekly[0].words).toBe(0);
  });
});

describe('analyzeWriting: humor, meta e mes', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');

  it('detecta humor positivo e negativo', () => {
    const good = analyzeWriting([base({ text: 'que dia maravilhoso, muito bom, adorei' })], now);
    const bad = analyzeWriting([base({ text: 'dia horrivel, muito triste, pessimo' })], now);
    expect(good.sentiment.average).toBeGreaterThan(0);
    expect(good.sentiment.positive).toBe(1);
    expect(bad.sentiment.average).toBeLessThan(0);
    expect(bad.sentiment.negative).toBe(1);
  });

  it('sabe se escreveu hoje', () => {
    expect(analyzeWriting([base({ text: 'oi' })], new Date('2026-10-10T12:00:00.000Z')).wroteToday).toBe(true);
    expect(analyzeWriting([base({ text: 'oi' })], new Date('2026-10-11T12:00:00.000Z')).wroteToday).toBe(false);
  });

  it('compara o mes atual com o anterior', () => {
    const metrics = analyzeWriting(
      [
        base({ id: 'a', recordedAt: '2026-09-10T12:00:00.000Z', text: 'duas palavras' }),
        base({ id: 'b', recordedAt: '2026-10-05T12:00:00.000Z', text: 'quatro palavras aqui agora' }),
      ],
      now,
    );
    expect(metrics.monthly).toHaveLength(6);
    expect(metrics.monthly[metrics.monthly.length - 2].words).toBe(2);
    expect(metrics.monthly[metrics.monthly.length - 1].words).toBe(4);
    expect(metrics.monthComparisonPct).toBe(100);
  });
});

describe('weekdayHourGrid', () => {
  it('soma as notas na grade 7x8', () => {
    const grid = weekdayHourGrid([
      base({ id: 'a' }),
      base({ id: 'b' }),
      base({ id: 'c' }),
    ]);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(8);
    expect(grid.flat().reduce((sum, value) => sum + value, 0)).toBe(3);
  });
});

describe('monthlySeries', () => {
  it('devolve os meses do mais antigo ao atual', () => {
    const series = monthlySeries(
      [base({ recordedAt: '2026-10-05T12:00:00.000Z', text: 'duas palavras' })],
      new Date('2026-10-14T12:00:00.000Z'),
      3,
    );
    expect(series).toHaveLength(3);
    expect(series[2].words).toBe(2);
    expect(series[0].words).toBe(0);
  });
});
