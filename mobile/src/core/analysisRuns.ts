/**
 * Diagnostico das execucoes de analise. Puro e testavel: recebe as linhas
 * guardadas no SQLite do aparelho e devolve os agregados de Configs > Avancado.
 * O servidor expoe o mesmo recorte em `/api/v1/analysis/runs/summary`.
 */

export type AnalysisRuntime = 'local' | 'server';

export type AnalysisOutcome = 'ok' | 'invalid_json' | 'error' | 'stopped' | 'fallback';

/** Uma tentativa de analise. Nunca guarda conteudo, so medidas e resultado. */
export interface AnalysisRun {
  id: string;
  entryId: string;
  analysisId?: string;
  attachmentId?: string;
  runtime: AnalysisRuntime;
  provider: string;
  model: string;
  /** 1-based para tentativas do modelo; 0 para a leitura simplificada. */
  attempt: number;
  outcome: AnalysisOutcome;
  errorClass?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputTextChars: number;
  inputTranscriptChars: number;
  inputImages: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond: number;
  threads?: number;
  batteryDeltaPct?: number;
}

export interface AnalysisRunModelSummary {
  runtime: AnalysisRuntime;
  provider: string;
  model: string;
  runs: number;
  ok: number;
  failed: number;
  fallback: number;
  successRate: number;
  simplifiedRate: number;
  avgDurationMs: number;
  tokensPerSecond: number;
}

export interface AnalysisRunSummary {
  runs: number;
  ok: number;
  failed: number;
  fallback: number;
  successRate: number;
  simplifiedRate: number;
  avgDurationMs: number;
  tokensPerSecond: number;
  /** Media do delta de bateria nas execucoes que mediram (0..100). */
  avgBatteryDeltaPct: number | null;
  models: AnalysisRunModelSummary[];
}

interface Bucket {
  runtime: AnalysisRuntime;
  provider: string;
  model: string;
  runs: number;
  ok: number;
  fallback: number;
  completionTokens: number;
  durationMs: number;
  batterySum: number;
  batteryCount: number;
}

function rate(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function add(bucket: Bucket, run: AnalysisRun): void {
  bucket.runs += 1;
  if (run.outcome === 'ok') {
    bucket.ok += 1;
    bucket.completionTokens += run.completionTokens;
    bucket.durationMs += run.durationMs;
  } else if (run.outcome === 'fallback') {
    bucket.fallback += 1;
  }
  if (typeof run.batteryDeltaPct === 'number' && Number.isFinite(run.batteryDeltaPct)) {
    bucket.batterySum += run.batteryDeltaPct;
    bucket.batteryCount += 1;
  }
}

function emptyBucket(runtime: AnalysisRuntime, provider: string, model: string): Bucket {
  return {
    runtime,
    provider,
    model,
    runs: 0,
    ok: 0,
    fallback: 0,
    completionTokens: 0,
    durationMs: 0,
    batterySum: 0,
    batteryCount: 0,
  };
}

function toModelSummary(bucket: Bucket): AnalysisRunModelSummary {
  return {
    runtime: bucket.runtime,
    provider: bucket.provider,
    model: bucket.model,
    runs: bucket.runs,
    ok: bucket.ok,
    failed: bucket.runs - bucket.ok - bucket.fallback,
    fallback: bucket.fallback,
    successRate: rate(bucket.ok, bucket.runs),
    simplifiedRate: rate(bucket.fallback, bucket.runs),
    avgDurationMs: rate(bucket.durationMs, bucket.ok),
    tokensPerSecond: bucket.durationMs > 0 ? (bucket.completionTokens * 1000) / bucket.durationMs : 0,
  };
}

/**
 * Agrega as execucoes por runtime/provider/model. `since` (epoch ms) recorta a
 * janela; sem ele, entra todo o historico local.
 */
export function summarizeAnalysisRuns(
  runs: AnalysisRun[],
  since?: number,
): AnalysisRunSummary {
  const buckets = new Map<string, Bucket>();

  for (const run of runs) {
    if (since !== undefined) {
      const started = Date.parse(run.startedAt);
      if (!Number.isFinite(started) || started < since) continue;
    }
    const key = `${run.runtime}\u0000${run.provider}\u0000${run.model}`;
    const bucket = buckets.get(key) ?? emptyBucket(run.runtime, run.provider, run.model);
    add(bucket, run);
    buckets.set(key, bucket);
  }

  const models = [...buckets.values()]
    .map(toModelSummary)
    .sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model));

  let ok = 0;
  let fallback = 0;
  let total = 0;
  let completionTokens = 0;
  let durationMs = 0;
  let batterySum = 0;
  let batteryCount = 0;
  for (const bucket of buckets.values()) {
    total += bucket.runs;
    ok += bucket.ok;
    fallback += bucket.fallback;
    completionTokens += bucket.completionTokens;
    durationMs += bucket.durationMs;
    batterySum += bucket.batterySum;
    batteryCount += bucket.batteryCount;
  }

  return {
    runs: total,
    ok,
    failed: total - ok - fallback,
    fallback,
    successRate: rate(ok, total),
    simplifiedRate: rate(fallback, total),
    avgDurationMs: rate(durationMs, ok),
    tokensPerSecond: durationMs > 0 ? (completionTokens * 1000) / durationMs : 0,
    avgBatteryDeltaPct: batteryCount > 0 ? batterySum / batteryCount : null,
    models,
  };
}
