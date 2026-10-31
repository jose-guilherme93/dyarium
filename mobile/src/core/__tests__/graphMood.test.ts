import type { GraphEntry } from '../graphModel';
import {
  averageMood,
  buildEntityMood,
  buildMoodSeries,
  localDay,
  moodTrend,
} from '../graphMood';

function entry(id: string, recordedAt: string, sentiment?: number): GraphEntry {
  return {
    id,
    title: `Nota ${id}`,
    recordedAt,
    notebookId: 'nb',
    analysis:
      typeof sentiment === 'number'
        ? ({ sentiment } as GraphEntry['analysis'])
        : undefined,
  };
}

describe('buildMoodSeries', () => {
  it('agrupa por dia local e faz a média das notas', () => {
    const series = buildMoodSeries([
      entry('a', '2026-10-20T10:00:00', 0.4),
      entry('b', '2026-10-20T22:00:00', 0.2),
      entry('c', '2026-10-21T09:00:00', -0.6),
      entry('d', '2026-10-21T10:00:00'),
    ]);
    expect(series.map((point) => point.date)).toEqual(['2026-10-20', '2026-10-21']);
    expect(series[0].sentiment).toBeCloseTo(0.3);
    expect(series[0].notes).toBe(2);
    expect(series[1].sentiment).toBeCloseTo(-0.6);
    expect(series[1].notes).toBe(1);
  });

  it('sai em ordem de data', () => {
    const series = buildMoodSeries([
      entry('b', '2026-10-22T10:00:00', 0.1),
      entry('a', '2026-10-20T10:00:00', 0.2),
    ]);
    expect(series.map((point) => point.date)).toEqual(['2026-10-20', '2026-10-22']);
  });

  it('devolve série vazia sem análise', () => {
    expect(buildMoodSeries([entry('a', '2026-10-20T10:00:00')])).toEqual([]);
  });
});

describe('buildEntityMood', () => {
  const entries = [
    entry('a', '2026-10-20T10:00:00', 0.9),
    entry('b', '2026-10-21T10:00:00', -0.9),
    entry('c', '2026-10-22T10:00:00', 0.4),
  ];

  it('usa o tom do vínculo com a entidade, não o da nota', () => {
    const series = buildEntityMood(
      [
        { entryId: 'a', entityId: 'e1', sentiment: 0.2 },
        { entryId: 'b', entityId: 'e1', sentiment: -0.6 },
        { entryId: 'c', entityId: 'e1' },
        // Vinculo de outra entidade na mesma nota nao entra.
        { entryId: 'a', entityId: 'e2', sentiment: -1 },
      ],
      entries,
      'e1',
    );
    expect(series.map((point) => point.date)).toEqual(['2026-10-20', '2026-10-21']);
    expect(series[0].sentiment).toBeCloseTo(0.2);
    expect(series[1].sentiment).toBeCloseTo(-0.6);
  });

  it('junta duas notas do mesmo dia numa média', () => {
    const series = buildEntityMood(
      [
        { entryId: 'a', entityId: 'e1', sentiment: 0.4 },
        { entryId: 'd', entityId: 'e1', sentiment: 0 },
      ],
      [...entries, entry('d', '2026-10-20T20:00:00', 0.8)],
      'e1',
    );
    expect(series).toHaveLength(1);
    expect(series[0].notes).toBe(2);
    expect(series[0].sentiment).toBeCloseTo(0.2);
  });

  it('devolve vazio quando a entidade não tem tom', () => {
    expect(buildEntityMood([{ entryId: 'a', entityId: 'e9' }], entries, 'e9')).toEqual([]);
  });
});

describe('moodTrend', () => {
  it('mede do primeiro ao último dia', () => {
    expect(
      moodTrend([
        { date: '2026-10-20', sentiment: -0.2, notes: 1 },
        { date: '2026-10-21', sentiment: 0.6, notes: 1 },
      ]),
    ).toBeCloseTo(0.8);
  });

  it('sem dois dias não há tendência', () => {
    expect(moodTrend([])).toBe(0);
    expect(moodTrend([{ date: '2026-10-20', sentiment: 0.4, notes: 2 }])).toBe(0);
  });
});

describe('averageMood', () => {
  it('pondera pela quantidade de notas de cada dia', () => {
    const average = averageMood([
      { date: '2026-10-20', sentiment: 1, notes: 3 },
      { date: '2026-10-21', sentiment: -1, notes: 1 },
    ]);
    expect(average.sentiment).toBeCloseTo(0.5);
    expect(average.notes).toBe(4);
  });

  it('não divide por zero', () => {
    expect(averageMood([])).toEqual({ sentiment: 0, notes: 0 });
  });
});

describe('localDay', () => {
  it('usa o dia do aparelho', () => {
    expect(localDay('2026-10-20T12:00:00')).toBe('2026-10-20');
    expect(localDay('2026-01-02T00:30:00')).toBe('2026-01-02');
  });

  it('cai no prefixo do ISO quando a data é inválida', () => {
    expect(localDay('2026-10-20')).toBe('2026-10-20');
  });
});
