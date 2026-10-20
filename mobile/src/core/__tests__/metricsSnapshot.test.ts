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
  it('monta o documento versionado com as tres janelas e o historico', () => {
    const snapshot = buildMetricsSnapshot(
      [
        base({ id: 'a', text: 'escrevi bastante sobre o projeto hoje mesmo' }),
        base({ id: 'b', text: 'que dia maravilhoso', transcript: 'falei algumas palavras', filePath: 'file://a' }),
      ],
      now,
    );

    expect(snapshot.schema).toBe(METRICS_SCHEMA);
    expect(snapshot.generated_at).toBe(now.toISOString());
    expect(snapshot.streak.current).toBe(1);
    expect(snapshot.streak.wrote_today).toBe(true);

    const writing = snapshot.windows['30d'].writing;
    expect(writing.notes).toBe(2);
    expect(writing.with_text).toBe(2);
    expect(writing.with_audio).toBe(1);
    expect(writing.with_transcript).toBe(1);
    expect(writing.words).toBe(10);
    expect(writing.active_days).toBe(1);
    expect(writing.top_words.length).toBeGreaterThan(0);
    expect(writing.weekday_hour).toHaveLength(7);

    expect(snapshot.windows['7d'].writing.notes).toBe(2);
    expect(snapshot.windows['365d'].writing.notes).toBe(2);
    expect(snapshot.windows['30d'].voice.words).toBe(3);
    expect(snapshot.windows['30d'].summary.length).toBeGreaterThan(0);

    expect(snapshot.history.weekly).toHaveLength(12);
    expect(snapshot.history.calendar).toHaveLength(12);
    expect(snapshot.history.calendar[0]).toHaveLength(7);
  });

  it('usa as mesmas chaves do contrato (snake_case)', () => {
    const snapshot = buildMetricsSnapshot([base({ text: 'oi' })], now);
    const window = snapshot.windows['30d'];
    const writing = window.writing as unknown as Record<string, unknown>;
    for (const key of [
      'words',
      'unique_words',
      'lexical_richness',
      'average_words_per_note',
      'notes_per_week',
      'reading_minutes',
      'top_weekday',
      'weekday_hour',
      'consistency',
    ]) {
      expect(writing).toHaveProperty(key);
    }
    for (const key of ['voice', 'images', 'analysis', 'sentiment', 'topics', 'summary', 'from', 'to']) {
      expect(window).toHaveProperty(key);
    }
    const topics = window.topics as unknown as Record<string, unknown>;
    for (const key of ['themes', 'people', 'places']) {
      expect(topics).toHaveProperty(key);
    }
    const voice = window.voice as unknown as Record<string, unknown>;
    for (const key of [
      'audio_count',
      'audio_minutes',
      'transcribed_minutes',
      'coverage',
      'words_per_minute',
      'words_per_audio',
      'origin_local',
      'origin_server',
      'transcript_share',
    ]) {
      expect(voice).toHaveProperty(key);
    }
    const analysis = window.analysis as unknown as Record<string, unknown>;
    for (const key of [
      'notes_with_content',
      'notes_analyzed',
      'coverage',
      'stale',
      'simplified',
      'last_analyzed_at',
    ]) {
      expect(analysis).toHaveProperty(key);
    }
    const sentiment = window.sentiment as unknown as Record<string, unknown>;
    for (const key of ['source', 'emotions', 'series', 'granularity']) {
      expect(sentiment).toHaveProperty(key);
    }

    // Nada em camelCase escapando para o servidor.
    expect(writing.uniqueWords).toBeUndefined();
    expect(writing.averageWordsPerNote).toBeUndefined();
    expect(voice.audioCount).toBeUndefined();
  });

  it('devolve o retrato vazio sem notas, sem quebrar', () => {
    const snapshot = buildMetricsSnapshot([], now);
    const window = snapshot.windows['30d'];
    expect(window.writing.notes).toBe(0);
    expect(window.writing.words).toBe(0);
    expect(window.writing.consistency.tracked_days).toBe(0);
    expect(window.writing.top_weekday).toBeNull();
    expect(window.voice.audio_count).toBe(0);
    expect(window.sentiment.analyzed).toBe(0);
    expect(window.summary).toEqual([]);
    expect(snapshot.streak.current).toBe(0);
    expect(snapshot.history.weekly[11].words).toBe(0);
  });

  it('leva temas, pessoas, lugares e os bytes das imagens', () => {
    const snapshot = buildMetricsSnapshot(
      [
        base({ id: 'a', text: 'falei com Ana no trabalho ![x](local:x.jpg)' }),
        base({ id: 'b', text: 'outra nota' }),
      ],
      now,
      [
        {
          entryId: 'a',
          origin: 'server',
          sentiment: 0.2,
          themes: ['trabalho', 'família'],
          people: ['Ana'],
          places: ['escritório'],
        },
        {
          entryId: 'b',
          origin: 'server',
          sentiment: 0,
          themes: ['trabalho'],
          people: [],
          places: [],
        },
      ],
      { a: 2048 },
    );

    const window = snapshot.windows['30d'];
    expect(window.topics.themes).toEqual([
      { label: 'trabalho', count: 2 },
      { label: 'família', count: 1 },
    ]);
    expect(window.topics.people).toEqual([{ label: 'Ana', count: 1 }]);
    expect(window.topics.places).toEqual([{ label: 'escritório', count: 1 }]);
    expect(window.images.count).toBe(1);
    expect(window.images.bytes_total).toBe(2048);
  });

  it('usa a analise guardada no sentimento do documento', () => {
    const snapshot = buildMetricsSnapshot(
      [base({ id: 'a', text: 'dia triste' })],
      now,
      [
        {
          entryId: 'a',
          origin: 'local',
          model: 'qwen',
          sentiment: 0.8,
          sentimentLabel: 'positivo',
        },
      ],
    );
    const sentiment = snapshot.windows['30d'].sentiment;
    expect(sentiment.source).toBe('analysis');
    expect(sentiment.analyzed).toBe(1);
    expect(sentiment.positive).toBe(1);
    expect(sentiment.emotions).toEqual([]);
  });

  it('leva a constancia e o sentimento calculados localmente', () => {
    const snapshot = buildMetricsSnapshot(
      [
        base({ id: 'a', recordedAt: '2026-10-13T12:00:00.000Z', text: 'dia maravilhoso, adorei' }),
        base({ id: 'b', recordedAt: '2026-10-14T12:00:00.000Z', text: 'dia horrivel, muito triste' }),
      ],
      now,
    );
    const window = snapshot.windows['30d'];
    expect(window.writing.consistency.tracked_days).toBe(2);
    expect(window.writing.consistency.written_days).toBe(2);
    expect(window.writing.consistency.rate).toBe(1);
    expect(window.writing.consistency.longest_run).toBe(2);
    expect(window.sentiment.source).toBe('lexical');
    expect(window.sentiment.analyzed).toBe(2);
    expect(window.sentiment.positive).toBe(1);
    expect(window.sentiment.negative).toBe(1);
    expect(window.sentiment.emotions).toEqual([]);
    expect(snapshot.streak.current).toBe(2);
  });
});
