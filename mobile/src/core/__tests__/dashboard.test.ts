import type { ServerAnalysis, ServerEntry } from '../api';
import { summarize } from '../dashboard';

function entry(partial: Partial<ServerEntry>): ServerEntry {
  return {
    id: 'e1',
    title: 't',
    status: 'ready',
    source: 'upload',
    original_filename: 'a.m4a',
    content_type: 'audio/mp4',
    size_bytes: 100,
    duration_seconds: 60,
    recorded_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

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

describe('summarize', () => {
  it('conta totais, status, duracao e tamanho', () => {
    const entries = [
      entry({ id: 'a', status: 'ready', duration_seconds: 60, size_bytes: 1000 }),
      entry({ id: 'b', status: 'transcribed', duration_seconds: 30, size_bytes: 500 }),
      entry({ id: 'c', status: 'failed', duration_seconds: 10, size_bytes: 100 }),
      entry({ id: 'd', status: 'queued', duration_seconds: 0, size_bytes: 0 }),
    ];
    const summary = summarize(entries, []);
    expect(summary.total).toBe(4);
    expect(summary.transcribed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.totalDurationSeconds).toBe(100);
    expect(summary.totalSizeBytes).toBe(1600);
    expect(summary.statusCounts[0]).toEqual({ label: 'ready', value: 1 });
  });

  it('calcula o sentimento medio e ignora sem analise', () => {
    const summary = summarize([entry({})], [
      analysis({ sentiment: 0.5 }),
      analysis({ sentiment: -0.5 }),
      analysis({ sentiment: 0 }),
    ]);
    expect(summary.analyzed).toBe(3);
    expect(summary.averageSentiment).toBeCloseTo(0);
  });

  it('devolve sentimento nulo sem analises', () => {
    expect(summarize([entry({})], []).averageSentiment).toBeNull();
  });

  it('agrega emocoes, pessoas e lugares', () => {
    const analyses = [
      analysis({ emotions: { alegria: 0.8, calma: 0.2 }, people: ['Ana', 'Beto'], places: ['Casa'] }),
      analysis({ emotions: { alegria: 0.4 }, people: ['Ana'], places: ['Casa', 'Praia'] }),
    ];
    const summary = summarize([entry({})], analyses);
    expect(summary.emotions[0].label).toBe('alegria');
    expect(summary.emotions[0].value).toBeCloseTo(1.2);
    expect(summary.people).toEqual([
      { label: 'Ana', value: 2 },
      { label: 'Beto', value: 1 },
    ]);
    expect(summary.places[0]).toEqual({ label: 'Casa', value: 2 });
  });
});
