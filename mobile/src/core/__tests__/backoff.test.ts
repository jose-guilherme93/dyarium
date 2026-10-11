import { MAX_DELAY_MS, nextAttemptDelayMs } from '../backoff';

describe('nextAttemptDelayMs', () => {
  it('cresce exponencialmente a partir da base', () => {
    expect(nextAttemptDelayMs(1)).toBe(2_000);
    expect(nextAttemptDelayMs(2)).toBe(4_000);
    expect(nextAttemptDelayMs(3)).toBe(8_000);
  });

  it('respeita o teto', () => {
    expect(nextAttemptDelayMs(100)).toBe(MAX_DELAY_MS);
  });

  it('trata tentativas invalidas como 1', () => {
    expect(nextAttemptDelayMs(0)).toBe(2_000);
    expect(nextAttemptDelayMs(-3)).toBe(2_000);
  });
});
