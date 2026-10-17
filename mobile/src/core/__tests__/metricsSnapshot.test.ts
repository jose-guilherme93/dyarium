import type { Recording } from '../types';
import { METRICS_SCHEMA, buildMetricsSnapshot } from '../metricsSnapshot';

function base(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'Nota',
    recordedAt: '2026-10-14T12:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-10-14T12:00:00.000Z',
    updatedAt: '2026-10-14T12:00:00.000Z',
    ...overrides,
  };
}

const now = new Date('2026-10-14T18:00:00.000Z');

describe('buildMetricsSnapshot', () => {
  it('monta o documento versionado com escrita e historico', () => {
    const snapshot = buildMetricsSnapshot(
      [
        base({ id: 'a', text: 'escrevi bastante sobre o projeto hoje mesmo' }),
        base({ id: 'b', text: 'que dia maravilhoso', transcript: 'falei algumas palavras', filePath: 'file://a' }),
      ],
      now,
    );

    expect(snapshot.schema).toBe(METRICS_SCHEMA);
    expect(snapshot.generated_at).toBe(now.toISOString());
    expect(snapshot.writing.notes).toBe(2);
    expect(snapshot.writing.with_text).toBe(2);
    expect(snapshot.writing.with_audio).toBe(1);
    expect(snapshot.writing.with_transcript).toBe(1);
    expect(snapshot.writing.words).toBe(10);
    expect(snapshot.writing.wrote_today).toBe(true);
    expect(snapshot.writing.active_days).toBe(1);
    expect(snapshot.writing.top_words.length).toBeGreaterThan(0);
    expect(snapshot.history.weekly).toHaveLength(12);
    expect(snapshot.history.calendar).toHaveLength(12);
    expect(snapshot.history.calendar[0]).toHaveLength(7);
    expect(snapshot.writing.weekday_hour).toHaveLength(7);
  });

  it('usa as mesmas chaves do contrato (snake_case)', () => {
    const snapshot = buildMetricsSnapshot([base({ text: 'oi' })], now);
    const writing = snapshot.writing as unknown as Record<string, unknown>;
    for (const key of [
      'words',
      'unique_words',
      'lexical_richness',
      'average_words_per_note',
      'current_streak',
      'longest_streak',
      'top_weekday',
      'monthly',
      'month_comparison_pct',
      'weekday_hour',
      'consistency',
      'sentiment',
      'insights',
    ]) {
      expect(writing).toHaveProperty(key);
    }
    // Nada em camelCase escapando para o servidor.
    expect(writing.uniqueWords).toBeUndefined();
    expect(writing.averageWordsPerNote).toBeUndefined();
  });

  it('devolve o retrato vazio sem notas, sem quebrar', () => {
    const snapshot = buildMetricsSnapshot([], now);
    expect(snapshot.writing.notes).toBe(0);
    expect(snapshot.writing.words).toBe(0);
    expect(snapshot.writing.insights).toEqual([]);
    expect(snapshot.writing.consistency.tracked_days).toBe(0);
    expect(snapshot.writing.monthly).toHaveLength(6);
    expect(snapshot.writing.top_weekday).toBeNull();
    expect(snapshot.history.weekly[11].words).toBe(0);
  });

  it('leva a constancia e o humor calculados localmente', () => {
    const snapshot = buildMetricsSnapshot(
      [
        base({ id: 'a', recordedAt: '2026-10-13T12:00:00.000Z', text: 'dia maravilhoso, adorei' }),
        base({ id: 'b', recordedAt: '2026-10-14T12:00:00.000Z', text: 'dia horrivel, muito triste' }),
      ],
      now,
    );
    expect(snapshot.writing.consistency.tracked_days).toBe(2);
    expect(snapshot.writing.consistency.written_days).toBe(2);
    expect(snapshot.writing.consistency.rate).toBe(1);
    expect(snapshot.writing.consistency.longest_run).toBe(2);
    expect(snapshot.writing.sentiment.analyzed).toBe(2);
    expect(snapshot.writing.sentiment.positive).toBe(1);
    expect(snapshot.writing.sentiment.negative).toBe(1);
  });
});
