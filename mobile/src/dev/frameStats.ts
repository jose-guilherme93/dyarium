/**
 * Contas do medidor de quadro, sem import nativo: o teste roda em Jest puro.
 */

export interface FrameSummary {
  n: number;
  p50: number;
  p95: number;
  max: number;
  /** Quadros acima de um orcamento de 16,7 ms (60 fps). */
  over: number;
}

export function summarize(deltas: number[], budget = 16.7): FrameSummary {
  if (deltas.length === 0) return { n: 0, p50: 0, p95: 0, max: 0, over: 0 };
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
  let over = 0;
  for (const delta of deltas) if (delta > budget) over += 1;
  return {
    n: deltas.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
    over,
  };
}

export function formatSummary(label: string, summary: FrameSummary): string {
  return (
    `[frame] ${label} n=${summary.n}` +
    ` p50=${summary.p50.toFixed(1)}` +
    ` p95=${summary.p95.toFixed(1)}` +
    ` max=${summary.max.toFixed(1)}` +
    ` >16=${summary.over}`
  );
}

/** Versao curta para o canto da tela em desenvolvimento. */
export function hudSummary(summary: FrameSummary): string {
  return `p50 ${summary.p50.toFixed(1)}  p95 ${summary.p95.toFixed(1)}  max ${summary.max.toFixed(0)}`;
}
