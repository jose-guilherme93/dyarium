import { formatBytes, formatDuration } from '../format';

describe('formatBytes', () => {
  it('formata bytes, KB, MB e GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 5)).toBe('5.0 MB');
    expect(formatBytes(1024 ** 3 * 2)).toBe('2.0 GB');
  });

  it('nao quebra com valores invalidos', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('formata mm:ss e h:mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_661_000)).toBe('1:01:01');
  });

  it('nao quebra com valores invalidos', () => {
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(NaN)).toBe('00:00');
  });
});
