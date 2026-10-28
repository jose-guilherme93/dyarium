import type { ServerAnalysis, ServerEntry } from '../api';
import { summarize, toAnalysisInsights } from '../dashboard';

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

describe('toAnalysisInsights', () => {
  const source = (over: Partial<Parameters<typeof toAnalysisInsights>[0][number]>) => ({
    entryId: 'e1',
    title: 'Nota',
    recordedAt: '2026-01-01T00:00:00Z',
    analysis: analysis({ summary: 'resumo' }),
    ...over,
  });

  it('lista da nota mais recente para a mais antiga e limita', () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      source({
        entryId: `e${index}`,
        title: `nota ${index}`,
        recordedAt: `2026-01-0${index + 1}T00:00:00Z`,
      }),
    );
    const insights = toAnalysisInsights(items, 6);
    expect(insights).toHaveLength(6);
    expect(insights[0].entryId).toBe('e7');
    expect(insights[5].entryId).toBe('e2');
  });

  it('extrai os temas e ignora analise sem resumo nem tema', () => {
    const insights = toAnalysisInsights([
      source({
        entryId: 'a',
        title: 'Com tema',
        analysis: analysis({
          summary: '',
          themes: [{ name: 'familia', confidence: 0.9 }],
        }),
      }),
      source({ entryId: 'b', title: 'Vazia', analysis: analysis({ summary: '   ' }) }),
    ]);
    expect(insights).toHaveLength(1);
    expect(insights[0].themes).toEqual(['familia']);
  });

  it('usa um titulo de reserva quando a nota nao tem nome', () => {
    const [insight] = toAnalysisInsights([source({ title: '   ' })]);
    expect(insight.title).toBe('Nota');
  });
});
