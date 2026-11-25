import { formatSummary, hudSummary, summarize } from '../frameStats';

describe('medidor de quadro', () => {
  it('resume p50, p95, pior quadro e quantos passaram do orcamento', () => {
    const deltas = [16, 16, 16, 17, 33, 50, 120];
    const summary = summarize(deltas);
    expect(summary.n).toBe(7);
    expect(summary.p50).toBe(17);
    expect(summary.p95).toBe(120);
    expect(summary.max).toBe(120);
    expect(summary.over).toBe(4);
  });

  it('nao divide por zero com janela vazia', () => {
    expect(summarize([])).toEqual({ n: 0, p50: 0, p95: 0, max: 0, over: 0 });
  });

  it('mostra a versao curta no canto da tela', () => {
    const text = hudSummary(summarize([16, 32]));
    expect(text).toBe('p50 16.0  p95 32.0  max 32');
  });

  it('formata para o log do Metro', () => {
    const text = formatSummary('grafo', summarize([16, 32]));
    expect(text).toContain('[frame] grafo');
    expect(text).toContain('n=2');
    expect(text).toContain('p50=16.0');
    expect(text).toContain('max=32.0');
  });
});
