/**
 * Instrumentacao de performance SO em desenvolvimento. Registra quantas vezes
 * cada componente renderiza e quanto tempo alguns marcos levam, e imprime um
 * resumo no console (visivel no Metro). Nada de conteudo nem rede: e so contagem
 * e tempo. Em producao (`__DEV__` falso) tudo vira no-op.
 */

import { useEffect } from 'react';

const renders = new Map<string, number>();
const durations = new Map<string, number[]>();

/**
 * Momento em que este bundle foi carregado no aparelho. Serve para confirmar
 * (pelo log do Metro) que o app esta rodando o codigo que acabamos de
 * escrever, e nao um bundle velho em cache.
 */
export const BUILD_STAMP = Date.now();

let started = false;

export function bumpRender(name: string): void {
  if (!__DEV__) return;
  renders.set(name, (renders.get(name) ?? 0) + 1);
}

/** Registra quanto tempo (ms) um marco levou. */
export function mark(name: string, ms: number): void {
  if (!__DEV__) return;
  const list = durations.get(name) ?? [];
  list.push(ms);
  durations.set(name, list);
}

/** Conta um render deste componente (chame no corpo, sem condicionais). */
export function useRenderCount(name: string): void {
  // Sem lista de dependencias de proposito: roda apos todo render.
  useEffect(() => {
    bumpRender(name);
  });
}

/** Comeca a imprimir o resumo a cada `intervalMs`. Idempotente. */
export function startPerfReport(intervalMs = 5000): void {
  if (!__DEV__ || started) return;
  started = true;
  setInterval(() => {
    const rows: [string, number][] = [];
    for (const [name, count] of renders) rows.push([name, count]);
    for (const [name, list] of durations) {
      const avg = list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);
      rows.push([`${name}#avg`, Math.round(avg)]);
    }
    renders.clear();
    durations.clear();
    if (rows.length === 0) return;
    rows.sort((a, b) => b[1] - a[1]);
    const text = rows
      .slice(0, 14)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ');
    console.log(`[perf] ${text}`);
  }, intervalMs);
}
