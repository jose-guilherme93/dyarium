import { formatTitle, toRecordedAt } from '../title';

describe('formatTitle', () => {
  it('formata data e hora locais como dd/MM/yyyy HH:mm', () => {
    const d = new Date(2026, 9, 10, 21, 5, 3); // 10/out/2026 21:05 local
    expect(formatTitle(d)).toBe('10/10/2026 21:05');
  });

  it('preenche com zero a esquerda', () => {
    const d = new Date(2026, 0, 3, 9, 7);
    expect(formatTitle(d)).toBe('03/01/2026 09:07');
  });

  it('gera recorded_at em ISO UTC', () => {
    const d = new Date('2026-10-10T21:05:03.000Z');
    expect(toRecordedAt(d)).toBe('2026-10-10T21:05:03.000Z');
  });
});
