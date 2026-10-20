import { summarizeAnalysisRuns, type AnalysisRun } from '../analysisRuns';

function run(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'r1',
    entryId: 'e1',
    runtime: 'local',
    provider: 'llama.cpp',
    model: 'qwen',
    attempt: 1,
    outcome: 'ok',
    startedAt: '2026-10-19T12:00:00.000Z',
    finishedAt: '2026-10-19T12:00:01.000Z',
    durationMs: 1000,
    inputTextChars: 100,
    inputTranscriptChars: 50,
    inputImages: 0,
    promptTokens: 10,
    completionTokens: 20,
    tokensPerSecond: 20,
    ...overrides,
  };
}

describe('summarizeAnalysisRuns', () => {
  it('agrega por modelo e nao conta fallback como sucesso', () => {
    const summary = summarizeAnalysisRuns([
      run({ id: '1', model: 'm1', durationMs: 1000, completionTokens: 100, batteryDeltaPct: 2 }),
      run({ id: '2', model: 'm1', durationMs: 3000, completionTokens: 300 }),
      run({ id: '3', model: 'm1', outcome: 'fallback', attempt: 0, durationMs: 0 }),
      run({ id: '4', model: 'm1', outcome: 'error', durationMs: 500 }),
      run({
        id: '5',
        runtime: 'server',
        provider: 'openai',
        model: 'm2',
        durationMs: 2000,
        completionTokens: 50,
        batteryDeltaPct: 4,
      }),
    ]);

    expect(summary.runs).toBe(5);
    expect(summary.ok).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.fallback).toBe(1);
    expect(summary.successRate).toBeCloseTo(0.6);
    expect(summary.simplifiedRate).toBeCloseTo(0.2);
    expect(summary.avgDurationMs).toBeCloseTo(2000);
    expect(summary.tokensPerSecond).toBeCloseTo(75);
    expect(summary.avgBatteryDeltaPct).toBeCloseTo(3);
    expect(summary.models).toHaveLength(2);

    const m1 = summary.models.find((model) => model.model === 'm1');
    expect(m1).toMatchObject({ runs: 4, ok: 2, failed: 1, fallback: 1 });
    expect(m1?.successRate).toBeCloseTo(0.5);
    expect(m1?.simplifiedRate).toBeCloseTo(0.25);
    expect(m1?.avgDurationMs).toBeCloseTo(2000);
    expect(m1?.tokensPerSecond).toBeCloseTo(100);
  });

  it('recorta pela data de inicio quando a janela e informada', () => {
    const summary = summarizeAnalysisRuns(
      [
        run({ id: 'antiga', startedAt: '2026-10-01T12:00:00.000Z' }),
        run({ id: 'atual', startedAt: '2026-10-19T12:00:00.000Z' }),
      ],
      Date.parse('2026-10-10T00:00:00.000Z'),
    );
    expect(summary.runs).toBe(1);
    expect(summary.models[0].model).toBe('qwen');
  });

  it('lida com o historico vazio', () => {
    const summary = summarizeAnalysisRuns([]);
    expect(summary.runs).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.avgBatteryDeltaPct).toBeNull();
    expect(summary.models).toEqual([]);
  });
});
